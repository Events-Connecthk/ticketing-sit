/**
 * PDF Ticket Generator
 *
 * Uses pdf-lib to create tickets with optional full-page background
 * (uploaded image or PDF). Dynamic text + QR are overlaid at fixed positions.
 *
 * Supports:
 * - No template → plain white
 * - Image template → stretched as background
 * - PDF template → first page copied as background (best fidelity)
 */

import { EventConfig, BuyerInfo, TicketSelection } from "@/types";
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';

interface GenerateTicketParams {
  event: EventConfig;
  buyer: BuyerInfo;
  tickets: TicketSelection[];
  orderReference: string;
  purchaseId?: string;
  amount: number;
  currency: string;
  purchaseDate?: string; // ISO date for "Date of purchase"
  ticketSerial?: string; // unique per ticket, e.g. KPY-xxx-001
}

export async function generateTicketPdf(
  params: GenerateTicketParams
): Promise<{ success: boolean; pdfBuffer?: Uint8Array; filename?: string; error?: string }> {
  try {
    const idForFile = params.ticketSerial || params.orderReference;
    const filename = `ticket-${params.event.slug}-${idForFile}.pdf`;

    // Create page with white background (or custom image/PDF bg if provided)
    // Dynamic overlays (type, ID, QR, date) are drawn on top at fixed positions.
    let pdfDoc = await PDFDocument.create();
    let page;

    const templateFile = params.event.ticketTemplate;
    if (templateFile) {
      try {
        let templateBytes: ArrayBuffer | null = null;

        if (typeof window === 'undefined') {
          // Server
          const fsMod = await import('fs');
          const pathMod = await import('path');
          const fs = fsMod.default || fsMod;
          const path = pathMod.default || pathMod;
          const templatePath = path.join(process.cwd(), 'public', templateFile.replace(/^\//, ''));
          const buf = fs.readFileSync(templatePath);
          templateBytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        } else {
          // Browser
          const res = await fetch(templateFile);
          if (res.ok) {
            templateBytes = await res.arrayBuffer();
          }
        }

        if (templateBytes) {
          const isPdf = templateFile.toLowerCase().endsWith(".pdf");

          if (isPdf) {
            // Use uploaded PDF as the base page (preserves vector design)
            const templatePdf = await PDFDocument.load(templateBytes);
            const [copiedPage] = await pdfDoc.copyPages(templatePdf, [0]);
            // Standardize to our overlay coordinate system
            copiedPage.setSize(842, 1190);
            pdfDoc.addPage(copiedPage);
            page = copiedPage;
          } else {
            // Image background (stretch to fill like before)
            page = pdfDoc.addPage([842, 1190]);
            let bgImage;
            try {
              bgImage = await pdfDoc.embedPng(templateBytes);
            } catch {
              bgImage = await pdfDoc.embedJpg(templateBytes);
            }
            page.drawImage(bgImage, {
              x: 0,
              y: 0,
              width: 842,
              height: 1190,
            });
          }
        }
      } catch (e) {
        // fallback to plain white page
      }
    }

    // Ensure we have a page (plain white fallback)
    if (!page) {
      page = pdfDoc.addPage([842, 1190]);
    }

    // Generate QR code that links to the public ticket check page.
    // Public scan is now READ-ONLY (shows status only).
    // Actual redemption / check-in is done exclusively from /sit-admin → Ticket Scanner (admin password required).
    // For production, replace localhost with your actual domain.
    const refForQr = params.ticketSerial || params.orderReference || 'TICKET';
    const scanUrl = `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/scan?ref=${encodeURIComponent(refForQr)}`;
    const qrDataUrl = await QRCode.toDataURL(scanUrl, { width: 100 });
    const qrBytes = Uint8Array.from(atob(qrDataUrl.split(',')[1]), c => c.charCodeAt(0));
    const qrImage = await pdfDoc.embedPng(qrBytes);

    // Embed font for text (for the dynamic overlays)
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let boldFont;
    try {
      boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    } catch {
      boldFont = font; // fallback if bold not available
    }

    // =====================================================
    // DYNAMIC OVERLAYS — drawn on top of the uploaded template (image or PDF)
    // 
    // BEST APPROACH:
    // 1. Design/export your ticket background in Canva (or similar) as PDF or image.
    // 2. Recommended page size: 842 x 1190 points.
    // 3. Upload via /sit-admin → Event form (Ticket Template Background).
    // 4. We draw the live data (ticket type, ID/serial, QR, date) on top.
    //
    // White rectangles are drawn behind text for contrast.
    // Tweak the x/y numbers below to perfectly align with your Canva layout.
    // =====================================================

    const darkText = rgb(0.1, 0.1, 0.1);

    // Resolve the ticket type name(s) from the order
    const ticketNames = params.tickets.map(sel => {
      const t = params.event.ticketTypes?.find(tt => tt.id === sel.ticketTypeId);
      return t ? t.name : sel.ticketTypeId;
    });
    const ticketTypeDisplay = ticketNames.length > 1 
      ? ticketNames.join(' + ') 
      : (ticketNames[0] || 'General Admission');

    // =====================================================
    // DYNAMIC OVERLAYS on the template (or fallback)
    // - All value text is CENTERED on its own line (using getCenteredX)
    // - Larger sizes, tighter vertical spacing (congested), shifted a bit higher
    // - QR below ID text, above the date
    // - White rects cover any template placeholder text in the value areas
    // =====================================================

    const textSizeType = 48;  // h1 - way bigger
    const textSizeId   = 38;  // h2
    const textSizeDate = 22;  // subtitle

    // True center for 842pt wide page. Text will be centered around this.
    const textCenterX = 421;

    // Helper to center text on its line (approximate width for Helvetica)
    // IMPORTANT: only ONE definition. Cursor effectively starts at center of line.
    function getCenteredX(text: string, size: number, centerX: number) {
      const approxCharWidth = size * 0.5;
      const approxWidth = text.length * approxCharWidth;
      return centerX - approxWidth / 2;
    }

    // Ticket Type (h1) - a little lower
    page.drawRectangle({ x: 121, y: 588, width: 600, height: 52, color: rgb(1,1,1) });
    const typeX = getCenteredX(ticketTypeDisplay, textSizeType, textCenterX);
    page.drawText(ticketTypeDisplay, { 
      x: typeX, y: 600, size: textSizeType, font: boldFont, color: darkText 
    });

    // Ticket ID (h2) - a bit more gap from ticket type
    // Use ticketSerial for unique ID in multi-ticket orders
    const ticketId = params.ticketSerial || params.orderReference;
    page.drawRectangle({ x: 171, y: 537, width: 500, height: 44, color: rgb(1,1,1) });
    const idX = getCenteredX(ticketId, textSizeId, textCenterX);
    page.drawText(ticketId, { 
      x: idX, y: 548, size: textSizeId, font: boldFont, color: darkText 
    });

    // QR code - a bit bigger (position adjusted to keep reasonable gap after ID)
    const qrSize = 230;
    const qrCenterX = 421;
    const qrCenterY = 402;
    page.drawRectangle({ 
      x: qrCenterX - qrSize / 2 - 15, 
      y: qrCenterY - qrSize / 2 - 8, 
      width: qrSize + 30, 
      height: qrSize + 16, 
      color: rgb(1,1,1) 
    });
    page.drawImage(qrImage, { 
      x: qrCenterX - qrSize / 2, 
      y: qrCenterY - qrSize / 2, 
      width: qrSize, 
      height: qrSize 
    });

    // Date of purchase (subtitle) - below QR
    const purchaseDateStr = params.purchaseDate 
      ? new Date(params.purchaseDate).toLocaleDateString('en-GB', { 
          day: 'numeric', month: 'long', year: 'numeric' 
        }) 
      : new Date().toLocaleDateString('en-GB', { 
          day: 'numeric', month: 'long', year: 'numeric' 
        });
    page.drawRectangle({ x: 171, y: 268, width: 500, height: 34, color: rgb(1,1,1) });
    const dateX = getCenteredX(purchaseDateStr, textSizeDate, textCenterX);
    page.drawText(purchaseDateStr, { 
      x: dateX, y: 278, size: textSizeDate, font, color: darkText 
    });

    const pdfBytes = await pdfDoc.save();

    return {
      success: true,
      pdfBuffer: pdfBytes,
      filename,
    };
  } catch (error) {
    console.error("[PDF] Ticket generation failed", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "PDF generation error",
    };
  }
}
