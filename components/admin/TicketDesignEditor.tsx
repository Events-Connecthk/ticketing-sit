"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TicketDesign,
  DesignElement,
  DynamicFieldKey,
  FIELD_CATALOG,
  PRESET_MM,
  PX_PER_MM_SCREEN,
  TicketPreset,
  TicketOrientation,
  applyPreset,
  clampElementsToCanvas,
  defaultTicketDesign,
  renderElementText,
  sampleTicketData,
  uid,
  warnLowResolution,
  BgFit,
} from "@/lib/tickets/ticket-design";
import { generatePdfFromDesign } from "@/lib/pdf/generate-from-design";
import { toast } from "sonner";

type Props = {
  value: TicketDesign | null;
  onChange: (d: TicketDesign) => void;
  /** Upload helper: returns public path or null */
  onUploadImage?: (file: File) => Promise<string | null>;
};

export function TicketDesignEditor({ value, onChange, onUploadImage }: Props) {
  const design = value || defaultTicketDesign();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [drag, setDrag] = useState<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sample = useMemo(() => sampleTicketData(), []);

  /** Fit canvas into stage while keeping true mm proportions (matches PDF aspect). */
  const [stageSize, setStageSize] = useState({ w: 640, h: 520 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setStageSize({
        w: Math.max(200, cr.width),
        h: Math.max(240, cr.height),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = 24;
  const fitScale = useMemo(() => {
    const wMm = Math.max(20, design.canvas.widthMm || 20);
    const hMm = Math.max(20, design.canvas.heightMm || 20);
    const availW = Math.max(120, stageSize.w - pad * 2);
    const availH = Math.max(160, stageSize.h - pad * 2);
    const s = Math.min(availW / wMm, availH / hMm);
    // Cap so tiny tickets aren't huge; floor so huge tickets still visible
    return Math.min(PX_PER_MM_SCREEN * 1.35, Math.max(0.9, s));
  }, [design.canvas.widthMm, design.canvas.heightMm, stageSize.w, stageSize.h]);

  const scale = fitScale;
  const cw = design.canvas.widthMm * scale;
  const ch = design.canvas.heightMm * scale;

  const setDesign = useCallback(
    (next: TicketDesign) => {
      onChange({ ...next, updatedAt: new Date().toISOString() });
    },
    [onChange]
  );

  const selected = design.elements.find((e) => e.id === selectedId) || null;

  function updateEl(id: string, patch: Partial<DesignElement>) {
    setDesign({
      ...design,
      elements: design.elements.map((e) =>
        e.id === id ? { ...e, ...patch } : e
      ),
    });
  }

  function addElement(partial: Partial<DesignElement> & { type: DesignElement["type"] }) {
    const maxZ = design.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
    const el: DesignElement = {
      id: uid("el"),
      x: 15,
      y: 20,
      width: partial.type === "qr" || partial.type === "barcode" ? 40 : 80,
      height: partial.type === "qr" || partial.type === "barcode" ? 40 : 12,
      rotation: 0,
      locked: false,
      zIndex: maxZ + 1,
      fontSize: 12,
      fontWeight: "normal",
      color: "#2C2520",
      align: "left",
      emptyMode: "blank",
      qrFg: "#000000",
      qrBg: "#FFFFFF",
      showCodeText: true,
      fill: "#E8D5B7",
      stroke: "#C5A26E",
      strokeWidth: 1,
      ...partial,
      type: partial.type,
    };
    setDesign({ ...design, elements: [...design.elements, el] });
    setSelectedId(el.id);
  }

  function removeSelected() {
    if (!selectedId) return;
    setDesign({
      ...design,
      elements: design.elements.filter((e) => e.id !== selectedId),
    });
    setSelectedId(null);
  }

  function duplicateSelected() {
    if (!selected) return;
    const copy = {
      ...selected,
      id: uid("el"),
      x: selected.x + 5,
      y: selected.y + 5,
      zIndex: selected.zIndex + 1,
      locked: false,
    };
    setDesign({ ...design, elements: [...design.elements, copy] });
    setSelectedId(copy.id);
  }

  function layer(delta: number) {
    if (!selected) return;
    updateEl(selected.id, { zIndex: selected.zIndex + delta });
  }

  function onCanvasPointerDown(e: React.PointerEvent, id: string, mode: "move" | "resize") {
    const el = design.elements.find((x) => x.id === id);
    if (!el || el.locked) return;
    e.stopPropagation();
    setSelectedId(id);
    setDrag({
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origX: el.x,
      origY: el.y,
      origW: el.width,
      origH: el.height,
    });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    if (drag.mode === "move") {
      updateEl(drag.id, {
        x: Math.max(0, drag.origX + dx),
        y: Math.max(0, drag.origY + dy),
      });
    } else {
      updateEl(drag.id, {
        width: Math.max(8, drag.origW + dx),
        height: Math.max(6, drag.origH + dy),
      });
    }
  }

  function onPointerUp() {
    if (drag) {
      setDesign(clampElementsToCanvas(design));
    }
    setDrag(null);
  }

  async function handleBgUpload(file: File) {
    if (!file.type.match(/^image\/(png|jpeg|jpg)$/i)) {
      toast.error("Use PNG or JPG only");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image max 8MB");
      return;
    }
    let path: string | null = null;
    if (onUploadImage) {
      path = await onUploadImage(file);
    } else {
      // data URL fallback
      path = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsDataURL(file);
      });
    }
    if (!path) {
      toast.error("Upload failed");
      return;
    }
    const img = new Image();
    img.onload = () => {
      const warn = warnLowResolution(
        img.naturalWidth,
        img.naturalHeight,
        design.canvas.widthMm,
        design.canvas.heightMm
      );
      if (warn) toast.warning(warn);
    };
    img.src = path;
    setDesign({
      ...design,
      background: { ...design.background, imageUrl: path },
    });
    toast.success("Background updated");
  }

  async function previewPdf() {
    try {
      const { generatePdfFromDesign } = await import(
        "@/lib/pdf/generate-from-design"
      );
      const res = await generatePdfFromDesign({
        design,
        data: sample,
        qrPayload: sample.ticket.number,
        filename: `preview-${design.name || "ticket"}.pdf`,
      });
      if (!res.success || !res.pdfBuffer) {
        toast.error(res.error || "PDF preview failed");
        return;
      }
      const blob = new Blob([res.pdfBuffer as BlobPart], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      toast.success("PDF preview opened");
    } catch (e) {
      console.error(e);
      toast.error("PDF preview error");
    }
  }

  const sorted = [...design.elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div className="border rounded-xl bg-zinc-50 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b bg-white">
        <input
          value={design.name}
          onChange={(e) => setDesign({ ...design, name: e.target.value })}
          className="border rounded-lg px-2 py-1 text-sm font-medium min-w-[10rem]"
          placeholder="Design name"
        />
        <select
          value={design.canvas.preset}
          onChange={(e) => {
            const preset = e.target.value as TicketPreset;
            setDesign(
              applyPreset(design, preset, design.canvas.orientation)
            );
          }}
          className="border rounded-lg px-2 py-1 text-sm"
        >
          <option value="A4">A4</option>
          <option value="A5">A5</option>
          <option value="A6">A6</option>
          <option value="Letter">US Letter</option>
          <option value="Custom">Custom</option>
        </select>
        <select
          value={design.canvas.orientation}
          onChange={(e) =>
            setDesign(
              applyPreset(
                design,
                design.canvas.preset,
                e.target.value as TicketOrientation
              )
            )
          }
          className="border rounded-lg px-2 py-1 text-sm"
        >
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
        <label className="text-xs text-zinc-500">
          W mm
          <input
            type="number"
            className="ml-1 w-16 border rounded px-1 py-0.5"
            value={Math.round(design.canvas.widthMm * 10) / 10}
            onChange={(e) =>
              setDesign({
                ...design,
                canvas: {
                  ...design.canvas,
                  preset: "Custom",
                  widthMm: Math.max(20, Number(e.target.value) || 20),
                },
              })
            }
          />
        </label>
        <label className="text-xs text-zinc-500">
          H mm
          <input
            type="number"
            className="ml-1 w-16 border rounded px-1 py-0.5"
            value={Math.round(design.canvas.heightMm * 10) / 10}
            onChange={(e) =>
              setDesign({
                ...design,
                canvas: {
                  ...design.canvas,
                  preset: "Custom",
                  heightMm: Math.max(20, Number(e.target.value) || 20),
                },
              })
            }
          />
        </label>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            design.status === "published"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-900"
          }`}
        >
          {design.status}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          className="text-xs border rounded-lg px-2 py-1 hover:bg-zinc-50"
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? "Edit mode" : "Preview"}
        </button>
        <button
          type="button"
          className="text-xs border rounded-lg px-2 py-1 hover:bg-zinc-50"
          onClick={() => void previewPdf()}
        >
          PDF preview
        </button>
        <button
          type="button"
          className="text-xs border rounded-lg px-2 py-1 hover:bg-zinc-50"
          onClick={() =>
            setDesign({ ...design, status: "draft" })
          }
        >
          Save draft
        </button>
        <button
          type="button"
          className="text-xs rounded-lg px-2 py-1 bg-emerald-700 text-white hover:bg-emerald-600"
          onClick={() => {
            setDesign({
              ...clampElementsToCanvas(design),
              status: "published",
            });
            toast.success("Design marked published (save the event to apply)");
          }}
        >
          Publish
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[420px]">
        {/* Palette */}
        <div className="lg:col-span-2 border-r bg-white p-2 space-y-1 text-xs overflow-y-auto max-h-[70vh]">
          <div className="font-medium text-zinc-700 mb-1">Add</div>
          <button
            type="button"
            className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-100"
            onClick={() =>
              addElement({ type: "text", content: "Static text" })
            }
          >
            + Static text
          </button>
          <div className="text-[10px] text-zinc-400 pt-1">Dynamic fields</div>
          {FIELD_CATALOG.map((f) => (
            <button
              key={f.key}
              type="button"
              className="w-full text-left px-2 py-1 rounded hover:bg-zinc-100 truncate"
              onClick={() =>
                addElement({
                  type: "field",
                  fieldKey: f.key as DynamicFieldKey,
                  label: f.label,
                })
              }
            >
              + {f.label}
            </button>
          ))}
          <button
            type="button"
            className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-100"
            onClick={() => addElement({ type: "qr" })}
          >
            + QR code
          </button>
          <button
            type="button"
            className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-100"
            onClick={() => addElement({ type: "barcode" })}
          >
            + Barcode (QR style)
          </button>
          <button
            type="button"
            className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-100"
            onClick={() => addElement({ type: "rect", width: 40, height: 20 })}
          >
            + Shape
          </button>
          <button
            type="button"
            className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-100"
            onClick={() =>
              addElement({ type: "line", width: 60, height: 2, strokeWidth: 1.5 })
            }
          >
            + Line
          </button>
          <button
            type="button"
            className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-100"
            onClick={() => addElement({ type: "image", width: 30, height: 30 })}
          >
            + Image / logo
          </button>
        </div>

        {/* Canvas stage — size changes update visible ticket proportions */}
        <div
          ref={stageRef}
          className="lg:col-span-7 overflow-auto p-4 bg-zinc-200/80 flex flex-col items-center min-h-[420px] h-[min(70vh,640px)]"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <div className="text-[10px] text-zinc-600 mb-2 tabular-nums shrink-0">
            {design.canvas.widthMm.toFixed(1)} × {design.canvas.heightMm.toFixed(1)}{" "}
            mm · {design.canvas.orientation} · {design.canvas.preset} · scale{" "}
            {scale.toFixed(2)} px/mm
          </div>
          <div
            ref={canvasRef}
            key={`canvas-${design.canvas.widthMm}-${design.canvas.heightMm}-${design.canvas.orientation}`}
            className="relative shadow-xl bg-white shrink-0"
            style={{
              width: cw,
              height: ch,
              maxWidth: "100%",
              aspectRatio: `${design.canvas.widthMm} / ${design.canvas.heightMm}`,
              backgroundColor: design.background.color,
              backgroundImage: design.background.imageUrl
                ? `url(${design.background.imageUrl})`
                : undefined,
              backgroundSize:
                design.background.fit === "stretch"
                  ? "100% 100%"
                  : design.background.fit === "contain"
                    ? "contain"
                    : design.background.fit === "original"
                      ? "auto"
                      : "cover",
              backgroundPosition: `${design.background.positionX}% ${design.background.positionY}%`,
              backgroundRepeat: "no-repeat",
              opacity: 1,
              transition: "width 0.15s ease, height 0.15s ease",
            }}
            onClick={() => setSelectedId(null)}
          >
            {/* bg opacity overlay simulation via pseudo - apply to image layer only hard; skip */}
            {sorted.map((el) => {
              const text = preview
                ? renderElementText(el, sample)
                : el.type === "field"
                  ? `{{${el.fieldKey}}}`
                  : el.content || el.type;
              if (preview && text === null) return null;
              const isSel = el.id === selectedId && !preview;
              return (
                <div
                  key={el.id}
                  className={`absolute box-border ${
                    isSel ? "ring-2 ring-violet-500" : "ring-1 ring-black/10"
                  } ${el.locked ? "cursor-not-allowed" : "cursor-move"}`}
                  style={{
                    left: el.x * scale,
                    top: el.y * scale,
                    width: el.width * scale,
                    height: el.height * scale,
                    zIndex: el.zIndex,
                    transform: el.rotation
                      ? `rotate(${el.rotation}deg)`
                      : undefined,
                    fontSize: (el.fontSize || 12) * (scale / 3.2) * 0.85,
                    fontWeight: el.fontWeight || "normal",
                    fontStyle: el.italic ? "italic" : "normal",
                    textDecoration: el.underline ? "underline" : "none",
                    color: el.color || "#111",
                    textAlign: el.align || "left",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent:
                      el.align === "center"
                        ? "center"
                        : el.align === "right"
                          ? "flex-end"
                          : "flex-start",
                    background:
                      el.type === "rect"
                        ? el.fill || "#ddd"
                        : el.type === "qr" || el.type === "barcode"
                          ? el.qrBg || "#fff"
                          : "transparent",
                    border:
                      el.type === "rect" || el.type === "line"
                        ? `${el.strokeWidth || 1}px solid ${el.stroke || "#999"}`
                        : undefined,
                    padding: 2,
                    userSelect: "none",
                  }}
                  onPointerDown={(e) =>
                    !preview && onCanvasPointerDown(e, el.id, "move")
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(el.id);
                  }}
                >
                  {(el.type === "qr" || el.type === "barcode") && (
                    <div className="w-full h-full flex flex-col items-center justify-center text-[9px] text-zinc-500 border border-dashed border-zinc-400">
                      <span className="font-mono">{el.type.toUpperCase()}</span>
                      {el.showCodeText && (
                        <span className="text-[8px] mt-0.5">
                          {sample.ticket.number}
                        </span>
                      )}
                    </div>
                  )}
                  {el.type === "image" && (
                    <div className="w-full h-full text-[9px] text-center text-zinc-500 border border-dashed flex items-center justify-center">
                      {el.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={el.imageUrl}
                          alt=""
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        "Image"
                      )}
                    </div>
                  )}
                  {(el.type === "text" || el.type === "field") && (
                    <span className="w-full break-words leading-tight">
                      {text}
                    </span>
                  )}
                  {isSel && !el.locked && (
                    <div
                      className="absolute right-0 bottom-0 w-3 h-3 bg-violet-600 cursor-se-resize"
                      onPointerDown={(e) =>
                        onCanvasPointerDown(e, el.id, "resize")
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Props */}
        <div className="lg:col-span-3 border-l bg-white p-3 text-xs space-y-3 overflow-y-auto max-h-[70vh]">
          <div className="font-medium text-zinc-700">Background</div>
          <label className="block">
            Color
            <input
              type="color"
              className="ml-2"
              value={design.background.color || "#ffffff"}
              onChange={(e) =>
                setDesign({
                  ...design,
                  background: { ...design.background, color: e.target.value },
                })
              }
            />
          </label>
          <label className="block">
            Image
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="block mt-1 w-full"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleBgUpload(f);
              }}
            />
          </label>
          {design.background.imageUrl && (
            <button
              type="button"
              className="text-red-600 underline"
              onClick={() =>
                setDesign({
                  ...design,
                  background: {
                    ...design.background,
                    imageUrl: undefined,
                  },
                })
              }
            >
              Remove image
            </button>
          )}
          <label className="block">
            Fit
            <select
              className="ml-1 border rounded"
              value={design.background.fit}
              onChange={(e) =>
                setDesign({
                  ...design,
                  background: {
                    ...design.background,
                    fit: e.target.value as BgFit,
                  },
                })
              }
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="stretch">Stretch</option>
              <option value="original">Original</option>
            </select>
          </label>
          <label className="block">
            Opacity {Math.round((design.background.opacity ?? 1) * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              className="w-full"
              value={design.background.opacity ?? 1}
              onChange={(e) =>
                setDesign({
                  ...design,
                  background: {
                    ...design.background,
                    opacity: Number(e.target.value),
                  },
                })
              }
            />
          </label>

          <div className="border-t pt-2 font-medium text-zinc-700">
            Selected element
          </div>
          {!selected && (
            <p className="text-zinc-400">Click an element on the canvas</p>
          )}
          {selected && (
            <div className="space-y-2">
              <div className="text-zinc-500">{selected.type}</div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="border px-1.5 py-0.5 rounded"
                  onClick={duplicateSelected}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="border px-1.5 py-0.5 rounded"
                  onClick={() =>
                    updateEl(selected.id, { locked: !selected.locked })
                  }
                >
                  {selected.locked ? "Unlock" : "Lock"}
                </button>
                <button
                  type="button"
                  className="border px-1.5 py-0.5 rounded"
                  onClick={() => layer(1)}
                >
                  Forward
                </button>
                <button
                  type="button"
                  className="border px-1.5 py-0.5 rounded"
                  onClick={() => layer(-1)}
                >
                  Backward
                </button>
                <button
                  type="button"
                  className="border px-1.5 py-0.5 rounded text-red-600"
                  onClick={removeSelected}
                >
                  Delete
                </button>
              </div>
              {(selected.type === "text" || selected.type === "field") && (
                <>
                  {selected.type === "text" && (
                    <textarea
                      className="w-full border rounded p-1"
                      rows={2}
                      value={selected.content || ""}
                      onChange={(e) =>
                        updateEl(selected.id, { content: e.target.value })
                      }
                    />
                  )}
                  <label className="block">
                    Size
                    <input
                      type="number"
                      className="ml-1 w-14 border rounded px-1"
                      value={selected.fontSize || 12}
                      onChange={(e) =>
                        updateEl(selected.id, {
                          fontSize: Number(e.target.value) || 12,
                        })
                      }
                    />
                  </label>
                  <label className="block">
                    Color
                    <input
                      type="color"
                      className="ml-1"
                      value={selected.color || "#000000"}
                      onChange={(e) =>
                        updateEl(selected.id, { color: e.target.value })
                      }
                    />
                  </label>
                  <label className="block">
                    Align
                    <select
                      className="ml-1 border rounded"
                      value={selected.align || "left"}
                      onChange={(e) =>
                        updateEl(selected.id, {
                          align: e.target.value as "left" | "center" | "right",
                        })
                      }
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={selected.fontWeight === "bold"}
                      onChange={(e) =>
                        updateEl(selected.id, {
                          fontWeight: e.target.checked ? "bold" : "normal",
                        })
                      }
                    />
                    Bold
                  </label>
                  {selected.type === "field" && (
                    <>
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={!!selected.showLabel}
                          onChange={(e) =>
                            updateEl(selected.id, {
                              showLabel: e.target.checked,
                            })
                          }
                        />
                        Show label
                      </label>
                      <label className="block">
                        Empty
                        <select
                          className="ml-1 border rounded"
                          value={selected.emptyMode || "blank"}
                          onChange={(e) =>
                            updateEl(selected.id, {
                              emptyMode: e.target.value as
                                | "hide"
                                | "blank"
                                | "fallback",
                            })
                          }
                        >
                          <option value="blank">Blank</option>
                          <option value="hide">Hide</option>
                          <option value="fallback">Fallback</option>
                        </select>
                      </label>
                      {selected.emptyMode === "fallback" && (
                        <input
                          className="w-full border rounded px-1"
                          placeholder="Fallback text"
                          value={selected.fallback || ""}
                          onChange={(e) =>
                            updateEl(selected.id, {
                              fallback: e.target.value,
                            })
                          }
                        />
                      )}
                      <label className="block">
                        Date format
                        <select
                          className="ml-1 border rounded"
                          value={selected.dateFormat || "long"}
                          onChange={(e) =>
                            updateEl(selected.id, {
                              dateFormat: e.target.value,
                            })
                          }
                        >
                          <option value="long">August 6, 2026</option>
                          <option value="short">06/08/2026</option>
                          <option value="us">08/06/2026</option>
                          <option value="12h">7:00 PM (time)</option>
                        </select>
                      </label>
                    </>
                  )}
                </>
              )}
              {(selected.type === "qr" || selected.type === "barcode") && (
                <>
                  <label className="block">
                    QR dark
                    <input
                      type="color"
                      className="ml-1"
                      value={selected.qrFg || "#000000"}
                      onChange={(e) =>
                        updateEl(selected.id, { qrFg: e.target.value })
                      }
                    />
                  </label>
                  <label className="block">
                    QR light
                    <input
                      type="color"
                      className="ml-1"
                      value={selected.qrBg || "#ffffff"}
                      onChange={(e) =>
                        updateEl(selected.id, { qrBg: e.target.value })
                      }
                    />
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!!selected.showCodeText}
                      onChange={(e) =>
                        updateEl(selected.id, {
                          showCodeText: e.target.checked,
                        })
                      }
                    />
                    Show ticket number under code
                  </label>
                  {selected.width < 25 && (
                    <p className="text-amber-700">
                      Warning: code may be too small to scan reliably.
                    </p>
                  )}
                </>
              )}
              {selected.type === "image" && (
                <label className="block">
                  Image file
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="block mt-1 w-full"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f || !onUploadImage) return;
                      const path = await onUploadImage(f);
                      if (path) updateEl(selected.id, { imageUrl: path });
                    }}
                  />
                </label>
              )}
              <div className="grid grid-cols-2 gap-1">
                <label>
                  X
                  <input
                    type="number"
                    className="w-full border rounded px-1"
                    value={Math.round(selected.x * 10) / 10}
                    onChange={(e) =>
                      updateEl(selected.id, {
                        x: Number(e.target.value) || 0,
                      })
                    }
                  />
                </label>
                <label>
                  Y
                  <input
                    type="number"
                    className="w-full border rounded px-1"
                    value={Math.round(selected.y * 10) / 10}
                    onChange={(e) =>
                      updateEl(selected.id, {
                        y: Number(e.target.value) || 0,
                      })
                    }
                  />
                </label>
                <label>
                  W
                  <input
                    type="number"
                    className="w-full border rounded px-1"
                    value={Math.round(selected.width * 10) / 10}
                    onChange={(e) =>
                      updateEl(selected.id, {
                        width: Number(e.target.value) || 8,
                      })
                    }
                  />
                </label>
                <label>
                  H
                  <input
                    type="number"
                    className="w-full border rounded px-1"
                    value={Math.round(selected.height * 10) / 10}
                    onChange={(e) =>
                      updateEl(selected.id, {
                        height: Number(e.target.value) || 6,
                      })
                    }
                  />
                </label>
              </div>
            </div>
          )}
          <p className="text-[10px] text-zinc-400 pt-2 border-t">
            Published designs drive live PDFs. Draft uses legacy layout until you
            publish. QR still encodes ticket serial for check-in.
          </p>
          <button
            type="button"
            className="text-xs underline text-zinc-600"
            onClick={() => {
              if (confirm("Reset to default layout?")) {
                setDesign(defaultTicketDesign(design.name));
                setSelectedId(null);
              }
            }}
          >
            Reset to default layout
          </button>
        </div>
      </div>
    </div>
  );
}
