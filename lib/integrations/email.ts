/**
 * Email Service
 *
 * Sends transactional confirmation emails.
 * Uses Resend (https://resend.com).
 *
 * Recommended for buyers:
 * - They receive mail from no-reply@connecthk.org
 * - Replies/contact go to events@connecthk.org (via Reply-To header)
 *
 * Setup:
 * - Create a dedicated API key in Resend for this project.
 * - Verify connecthk.org (you can use no-reply@ and events@ on the same verified domain).
 * - Set in .env:
 *     RESEND_API_KEY=...
 *     FROM_EMAIL=no-reply@connecthk.org
 *     REPLY_TO=events@connecthk.org
 * - Add any required DNS records (SPF/DKIM) from Resend.
 */

import { Resend } from "resend";
import { EventConfig, EmailSendResult } from "@/types";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
// Recommended:
// - FROM_EMAIL = no-reply@events.connecthk.org   (what buyers see as sender)
// - REPLY_TO   = atthepeak@connecthk.org         (where they can reply / ask questions)
const FROM_EMAIL = process.env.FROM_EMAIL || "no-reply@events.connecthk.org";
const REPLY_TO = process.env.REPLY_TO || "atthepeak@connecthk.org";

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!RESEND_API_KEY) {
    console.warn("[Email] RESEND_API_KEY not set. Emails will be simulated.");
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(RESEND_API_KEY);
  }
  return resendClient;
}

interface SendConfirmationParams {
  to: string;
  buyerName: string;
  event: EventConfig;
  orderReference: string;
  totalAmount: number;
  currency: string;
  ticketCount: number;
  // Link to the tickets page (recommended - shows table with individual downloads)
  downloadUrl?: string;
  // Support multiple PDFs (one per ticket) - kept for backward compat if needed
  pdfs?: Array<{ buffer: Uint8Array | Buffer; filename: string }>;
  // Backward compat for single PDF
  pdfBuffer?: Uint8Array | Buffer;
  pdfFilename?: string;
}

export async function sendConfirmationEmail(
  params: SendConfirmationParams
): Promise<EmailSendResult> {
  const { to, buyerName, event, orderReference, totalAmount, currency, ticketCount, downloadUrl, pdfs, pdfBuffer, pdfFilename } = params;

  const client = getResendClient();

  const subject = `Your ${event.name} Ticket Confirmation - #${orderReference}`;

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #111; margin-bottom: 8px;">Thank you, ${buyerName.split(" ")[0]}!</h1>
      <p style="font-size: 16px; color: #444;">
        Your purchase for <strong>${event.name}</strong> has been confirmed.
      </p>

      <div style="background: #f8f8f8; padding: 20px; border-radius: 8px; margin: 24px 0;">
        <p style="margin: 4px 0;"><strong>Order Reference:</strong> ${orderReference}</p>
        <p style="margin: 4px 0;"><strong>Event:</strong> ${event.name}</p>
        <p style="margin: 4px 0;"><strong>Date:</strong> ${event.date} ${event.time ? `• ${event.time}` : ""}</p>
        <p style="margin: 4px 0;"><strong>Location:</strong> ${event.location}</p>
        <p style="margin: 4px 0;"><strong>Tickets:</strong> ${ticketCount}</p>
        <p style="margin: 4px 0; font-size: 18px;"><strong>Total Paid:</strong> ${currency} ${totalAmount}</p>
      </div>

      <p style="color: #555;">
        ${totalAmount === 0 
          ? `Your registration has been confirmed. Thank you for registering!` 
          : downloadUrl 
            ? `Click the button below to view and download your ticket(s). Each ticket has its own unique serial number.` 
            : `Your official ticket PDF(s) are attached. Each ticket has its own unique serial number.`}
      </p>

      ${downloadUrl ? `
      <div style="text-align: center; margin: 24px 0;">
        <a href="${downloadUrl}" style="background: #C5A26E; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
          View & Download Your Tickets
        </a>
      </div>
      ` : ''}

      <p style="margin-top: 32px; font-size: 13px; color: #888;">
        This email was sent from no-reply@events.connecthk.org. Please contact atthepeak@connecthk.org for any questions.
      </p>
    </div>
  `;

  // Build attachments from array (preferred for multi-ticket) or single for backward compat
  let attachments: any[] | undefined = undefined;

  if (pdfs && pdfs.length > 0) {
    attachments = pdfs.map(p => ({
      filename: p.filename,
      content: Buffer.from(p.buffer as Uint8Array),
    }));
  } else if (pdfBuffer && pdfFilename) {
    attachments = [
      {
        filename: pdfFilename,
        content: Buffer.from(pdfBuffer as Uint8Array),
      },
    ];
  }

  if (!client) {
    // Development / simulation mode
    console.log("[Email SIMULATED] From:", `ConnectHK Events <${FROM_EMAIL}>`);
    console.log("[Email SIMULATED] Reply-To:", REPLY_TO);
    console.log("[Email SIMULATED] To:", to);
    console.log("[Email SIMULATED] Subject:", subject);
    if (downloadUrl) {
      console.log("[Email SIMULATED] Would include link:", downloadUrl);
    } else {
      const attachNames = attachments ? attachments.map(a => a.filename).join(", ") : "no-pdf";
      console.log("[Email SIMULATED] Would attach:", attachNames);
    }
    return { success: true, messageId: "simulated-" + Date.now() };
  }

  try {
    const result = await client.emails.send({
      from: `ConnectHK Events <${FROM_EMAIL}>`,
      to,
      replyTo: REPLY_TO,
      subject,
      html,
      attachments,
    });

    if (result.error) {
      console.error("[Email] Resend error:", result.error);
      return { success: false, error: result.error.message };
    }

    return { success: true, messageId: result.data?.id };
  } catch (err) {
    console.error("[Email] Exception sending email:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Email delivery failed",
    };
  }
}
