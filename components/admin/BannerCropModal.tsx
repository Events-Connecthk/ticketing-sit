"use client";

import React, { useCallback, useState } from "react";
import Cropper, { Area } from "react-easy-crop";

type AspectOption = {
  id: string;
  label: string;
  value: number | undefined;
};

const ASPECTS: AspectOption[] = [
  { id: "21:9", label: "Wide banner 21:9", value: 21 / 9 },
  { id: "16:9", label: "16:9", value: 16 / 9 },
  { id: "3:2", label: "3:2", value: 3 / 2 },
  { id: "4:3", label: "4:3", value: 4 / 3 },
  { id: "1:1", label: "Square", value: 1 },
  { id: "free", label: "Free", value: undefined },
];

async function getCroppedBlob(
  imageSrc: string,
  crop: Area,
  mime = "image/jpeg",
  quality = 0.9
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");

  const maxW = 1920;
  let outW = Math.round(crop.width);
  let outH = Math.round(crop.height);
  if (outW > maxW) {
    const scale = maxW / outW;
    outW = maxW;
    outH = Math.round(outH * scale);
  }

  canvas.width = outW;
  canvas.height = outH;

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    outW,
    outH
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Crop failed"))),
      mime,
      quality
    );
  });
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", (e) => reject(e));
    img.setAttribute("crossOrigin", "anonymous");
    img.src = url;
  });
}

export interface BannerCropModalProps {
  imageSrc: string;
  fileName?: string;
  onCancel: () => void;
  onConfirm: (file: File) => void | Promise<void>;
}

export function BannerCropModal({
  imageSrc,
  fileName = "banner.jpg",
  onCancel,
  onConfirm,
}: BannerCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspectId, setAspectId] = useState("16:9");
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const aspect = ASPECTS.find((a) => a.id === aspectId)?.value;

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  async function handleSave() {
    if (!croppedAreaPixels) return;
    setBusy(true);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedAreaPixels);
      const base = fileName.replace(/\.[^.]+$/, "") || "banner";
      const file = new File([blob], `${base}-cropped.jpg`, {
        type: "image/jpeg",
      });
      await onConfirm(file);
    } catch (e) {
      console.error(e);
      alert("Could not crop image. Try another file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4">
      <div className="w-full max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[95vh]">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-lg">Adjust banner</h3>
            <p className="text-xs text-zinc-500">
              Drag to pan · use zoom · pick aspect ratio · then Apply crop
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-zinc-500 hover:text-black px-2 py-1"
            disabled={busy}
          >
            Cancel
          </button>
        </div>

        <div className="relative w-full h-[280px] sm:h-[360px] bg-zinc-900">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            objectFit="contain"
            showGrid
          />
        </div>

        <div className="p-4 space-y-4 border-t bg-zinc-50">
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1">
              Zoom
            </label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-2">
              Aspect ratio
            </label>
            <div className="flex flex-wrap gap-2">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAspectId(a.id)}
                  className={`text-xs px-3 py-1.5 rounded-full border ${
                    aspectId === a.id
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "bg-white text-zinc-700 hover:bg-zinc-100"
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-2.5 rounded-lg border text-sm hover:bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !croppedAreaPixels}
              className="btn-gold px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {busy ? "Saving…" : "Apply crop & upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
