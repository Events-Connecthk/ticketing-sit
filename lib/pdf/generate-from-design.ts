/**
 * Render a TicketDesign to PDF (pdf-lib).
 * Coordinates: design uses mm from top-left; pdf-lib uses pt from bottom-left.
 */
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import QRCode from "qrcode";
import {
  MM_TO_PT,
  TicketDesign,
  TicketDataContext,
  renderElementText,
  clampElementsToCanvas,
} from "@/lib/tickets/ticket-design";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = (hex || "#000000").replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

async function loadImageBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    if (typeof window === "undefined") {
      if (url.startsWith("http")) {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.arrayBuffer();
      }
      const fsMod = await import("fs");
      const pathMod = await import("path");
      const fs = fsMod.default || fsMod;
      const path = pathMod.default || pathMod;
      const p = path.join(process.cwd(), "public", url.replace(/^\//, ""));
      const buf = fs.readFileSync(p);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function generatePdfFromDesign(opts: {
  design: TicketDesign;
  data: TicketDataContext;
  /** Value encoded in QR / barcode - must stay scannable ticket serial */
  qrPayload: string;
  filename?: string;
}): Promise<{
  success: boolean;
  pdfBuffer?: Uint8Array;
  filename?: string;
  error?: string;
}> {
  try {
    const design = clampElementsToCanvas(opts.design);
    const pageW = design.canvas.widthMm * MM_TO_PT;
    const pageH = design.canvas.heightMm * MM_TO_PT;

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([pageW, pageH]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Background color
    const bg = hexToRgb(design.background.color || "#FFFFFF");
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageW,
      height: pageH,
      color: rgb(bg.r, bg.g, bg.b),
    });

    // Background image
    if (design.background.imageUrl) {
      const bytes = await loadImageBytes(design.background.imageUrl);
      if (bytes) {
        let img;
        try {
          img = await pdfDoc.embedPng(bytes);
        } catch {
          img = await pdfDoc.embedJpg(bytes);
        }
        const iw = img.width;
        const ih = img.height;
        const fit = design.background.fit || "cover";
        const op = Math.max(0, Math.min(1, design.background.opacity ?? 1));
        let dw = pageW;
        let dh = pageH;
        let dx = 0;
        let dy = 0;
        const scaleCover = Math.max(pageW / iw, pageH / ih);
        const scaleContain = Math.min(pageW / iw, pageH / ih);
        if (fit === "stretch") {
          dw = pageW;
          dh = pageH;
        } else if (fit === "original") {
          dw = iw;
          dh = ih;
          dx = (pageW - dw) / 2;
          dy = (pageH - dh) / 2;
        } else if (fit === "contain") {
          dw = iw * scaleContain;
          dh = ih * scaleContain;
          dx = (pageW - dw) / 2;
          dy = (pageH - dh) / 2;
        } else {
          // cover
          dw = iw * scaleCover;
          dh = ih * scaleCover;
          const px = (design.background.positionX ?? 50) / 100;
          const py = (design.background.positionY ?? 50) / 100;
          dx = (pageW - dw) * px;
          dy = (pageH - dh) * (1 - py);
        }
        page.drawImage(img, {
          x: dx,
          y: dy,
          width: dw,
          height: dh,
          opacity: op,
        });
      }
    }

    const sorted = [...design.elements].sort((a, b) => a.zIndex - b.zIndex);

    for (const el of sorted) {
      const x = el.x * MM_TO_PT;
      // convert top-left y to bottom-left
      const yTop = el.y * MM_TO_PT;
      const w = el.width * MM_TO_PT;
      const h = el.height * MM_TO_PT;
      const y = pageH - yTop - h;

      if (el.type === "rect") {
        const fill = hexToRgb(el.fill || "#000000");
        const stroke = hexToRgb(el.stroke || "#000000");
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          color: rgb(fill.r, fill.g, fill.b),
          borderColor: el.stroke ? rgb(stroke.r, stroke.g, stroke.b) : undefined,
          borderWidth: el.strokeWidth || 0,
          opacity: 1,
        });
        continue;
      }

      if (el.type === "line") {
        const stroke = hexToRgb(el.stroke || el.color || "#000000");
        page.drawLine({
          start: { x, y: y + h / 2 },
          end: { x: x + w, y: y + h / 2 },
          thickness: el.strokeWidth || 1,
          color: rgb(stroke.r, stroke.g, stroke.b),
        });
        continue;
      }

      if (el.type === "image" && el.imageUrl) {
        const bytes = await loadImageBytes(el.imageUrl);
        if (bytes) {
          let img;
          try {
            img = await pdfDoc.embedPng(bytes);
          } catch {
            img = await pdfDoc.embedJpg(bytes);
          }
          page.drawImage(img, { x, y, width: w, height: h });
        }
        continue;
      }

      if (el.type === "qr" || el.type === "barcode") {
        const fg = el.qrFg || "#000000";
        const bgC = el.qrBg || "#FFFFFF";
        // pdf-lib QR via png from qrcode lib
        const dataUrl = await QRCode.toDataURL(opts.qrPayload || "TICKET", {
          errorCorrectionLevel: "M",
          margin: 1,
          color: { dark: fg, light: bgC },
          width: 512,
        });
        const b64 = dataUrl.split(",")[1];
        const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const qrImg = await pdfDoc.embedPng(raw);
        const size = Math.min(w, h);
        const qx = x + (w - size) / 2;
        const qy = y + (el.showCodeText ? h * 0.12 : 0) + (h - size) / 2;
        page.drawImage(qrImg, { x: qx, y: qy, width: size, height: size });
        if (el.showCodeText) {
          const code = opts.data.ticket.number || opts.qrPayload;
          const sizePt = Math.min(9, h * 0.12);
          const tw = font.widthOfTextAtSize(code, sizePt);
          page.drawText(code, {
            x: x + (w - tw) / 2,
            y: y + 2,
            size: sizePt,
            font,
            color: rgb(0.2, 0.2, 0.2),
          });
        }
        // warn size: skip in PDF; editor handles warning
        continue;
      }

      if (el.type === "text" || el.type === "field") {
        const text = renderElementText(el, opts.data);
        if (text === null) continue;
        const sizePt = el.fontSize || 12;
        const f = el.fontWeight === "bold" ? fontBold : font;
        const col = hexToRgb(el.color || "#000000");
        const lines = String(text).split(/\n/);
        const maxLines = el.maxLines || 8;
        const lh = (el.lineHeight || 1.2) * sizePt;
        let lineIndex = 0;
        for (const line of lines.slice(0, maxLines)) {
          let draw = line;
          // simple truncate
          while (f.widthOfTextAtSize(draw, sizePt) > w && draw.length > 1) {
            draw = draw.slice(0, -2) + "…";
          }
          let tx = x;
          const tw = f.widthOfTextAtSize(draw, sizePt);
          if (el.align === "center") tx = x + (w - tw) / 2;
          if (el.align === "right") tx = x + w - tw;
          const ty = y + h - sizePt - lineIndex * lh;
          if (ty < y - sizePt) break;
          page.drawText(draw, {
            x: Math.max(0, tx),
            y: Math.max(0, ty),
            size: sizePt,
            font: f,
            color: rgb(col.r, col.g, col.b),
            rotate: el.rotation ? degrees(el.rotation) : undefined,
          });
          lineIndex++;
        }
      }
    }

    const pdfBuffer = await pdfDoc.save();
    return {
      success: true,
      pdfBuffer,
      filename:
        opts.filename ||
        `ticket-design-${opts.data.ticket.number || "preview"}.pdf`,
    };
  } catch (e) {
    console.error("[generatePdfFromDesign]", e);
    return {
      success: false,
      error: e instanceof Error ? e.message : "Design PDF failed",
    };
  }
}
