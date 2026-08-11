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
import { formatMoney } from "@/lib/money";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
// Recommended:
// - FROM_EMAIL = no-reply@events.connecthk.org   (what buyers see as sender)
// - REPLY_TO   = atthepeak@connecthk.org         (where they can reply / ask questions)
const FROM_EMAIL = process.env.FROM_EMAIL || "no-reply@events.connecthk.org";
const REPLY_TO = process.env.REPLY_TO || "atthepeak@connecthk.org";
/** Admin gets order alerts here (comma-separated allowed). Falls back to REPLY_TO. */
const ADMIN_NOTIFY_EMAIL =
  process.env.ADMIN_NOTIFY_EMAIL ||
  process.env.ORDER_NOTIFY_EMAIL ||
  REPLY_TO;

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
        <p style="margin: 4px 0; font-size: 18px;"><strong>Total:</strong> ${
          totalAmount === 0 ? "Free" : `${currency} ${formatMoney(totalAmount)}`
        }</p>
      </div>

      <p style="color: #555;">
        ${
          downloadUrl
            ? `Your ticket(s) are ready. Click the button below to view and download each PDF. Every ticket has its own unique serial number for check-in.`
            : totalAmount === 0
              ? `Your free tickets have been confirmed. Open your confirmation page to download ticket PDFs.`
              : `Your official ticket PDF(s) are attached. Each ticket has its own unique serial number.`
        }
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

export interface AdminOrderNotifyParams {
  event: EventConfig;
  orderReference: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  ticketCount: number;
  totalAmount: number;
  currency: string;
  paymentMethod?: string;
  /** e.g. "Day 1 × 2, Full × 1" */
  ticketSummary?: string;
  donationAmount?: number;
  adminUrl?: string;
}

/** Admin changed or deleted a customer's ticket unit. */
export async function sendAdminTicketChangeNotification(params: {
  kind: "changed" | "deleted";
  eventName: string;
  eventSlug: string;
  orderReference: string;
  serial?: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  fromTypeName?: string;
  toTypeName?: string;
  note?: string;
}): Promise<EmailSendResult> {
  const recipients = String(ADMIN_NOTIFY_EMAIL || "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
  if (recipients.length === 0) {
    return { success: false, error: "No admin notify address" };
  }

  const {
    kind,
    eventName,
    eventSlug,
    orderReference,
    serial,
    buyerName,
    buyerEmail,
    buyerPhone,
    fromTypeName,
    toTypeName,
    note,
  } = params;

  const subject =
    kind === "deleted"
      ? `[Connect Events] Ticket deleted — ${orderReference}`
      : `[Connect Events] Ticket type changed — ${orderReference}`;

  const changeLine =
    kind === "deleted"
      ? `<p style="margin: 4px 0;"><strong>Action:</strong> Ticket deleted${
          fromTypeName ? ` (was: ${fromTypeName})` : ""
        }</p>`
      : `<p style="margin: 4px 0;"><strong>Action:</strong> Type changed from <strong>${
          fromTypeName || "?"
        }</strong> to <strong>${toTypeName || "?"}</strong></p>`;

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 18px; color: #111;">Admin ticket update</h1>
      <p style="color: #444;">An organizer changed a customer's ticket in the admin panel.</p>
      <div style="background: #f8f8f8; padding: 16px; border-radius: 8px; margin: 16px 0;">
        ${changeLine}
        <p style="margin: 4px 0;"><strong>Order:</strong> ${orderReference}</p>
        ${serial ? `<p style="margin: 4px 0;"><strong>Serial:</strong> ${serial}</p>` : ""}
        <p style="margin: 4px 0;"><strong>Event:</strong> ${eventName} (${eventSlug})</p>
        <p style="margin: 4px 0;"><strong>Buyer:</strong> ${buyerName}</p>
        <p style="margin: 4px 0;"><strong>Email:</strong> ${buyerEmail}</p>
        <p style="margin: 4px 0;"><strong>Phone:</strong> ${buyerPhone || "—"}</p>
        ${note ? `<p style="margin: 4px 0;"><strong>Note:</strong> ${note}</p>` : ""}
      </div>
      <p style="font-size: 12px; color: #888;">
        If the type was changed, the buyer's next PDF download will show the new ticket type.
      </p>
    </div>
  `;

  const client = getResendClient();
  if (!client) {
    console.log("[Email SIMULATED] Admin ticket change:", subject, recipients);
    return { success: true, messageId: "simulated-ticket-change" };
  }
  try {
    const result = await client.emails.send({
      from: `Connect Events <${FROM_EMAIL}>`,
      to: recipients,
      replyTo: REPLY_TO,
      subject,
      html,
    });
    if (result.error) {
      return { success: false, error: result.error.message };
    }
    return { success: true, messageId: result.data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Email failed",
    };
  }
}

/**
 * Notify organizers when someone buys or registers.
 * Uses ADMIN_NOTIFY_EMAIL (or ORDER_NOTIFY_EMAIL / REPLY_TO).
 * Supports multiple recipients: comma-separated list.
 */
export async function sendAdminOrderNotification(
  params: AdminOrderNotifyParams
): Promise<EmailSendResult> {
  const recipients = String(ADMIN_NOTIFY_EMAIL || "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));

  if (recipients.length === 0) {
    console.warn(
      "[Email] No ADMIN_NOTIFY_EMAIL / REPLY_TO configured — skip admin notify"
    );
    return { success: false, error: "No admin notify address" };
  }

  const {
    event,
    orderReference,
    buyerName,
    buyerEmail,
    buyerPhone,
    ticketCount,
    totalAmount,
    currency,
    paymentMethod,
    ticketSummary,
    donationAmount,
    adminUrl,
  } = params;

  const cur = currency === "FREE" ? "HKD" : currency || "HKD";
  const totalLabel =
    totalAmount <= 0 ? "Free" : `${cur} ${formatMoney(totalAmount)}`;
  const subject = `[Connect Events] New order ${orderReference} — ${event.name}`;

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #111; margin-bottom: 8px; font-size: 20px;">New ticket order</h1>
      <p style="color: #444; margin: 0 0 16px;">
        Someone registered / purchased tickets on <strong>${event.name}</strong>.
      </p>
      <div style="background: #f8f8f8; padding: 20px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Order:</strong> ${orderReference}</p>
        <p style="margin: 4px 0;"><strong>Event:</strong> ${event.name} <span style="color:#888">(${event.slug})</span></p>
        <p style="margin: 4px 0;"><strong>Buyer:</strong> ${buyerName}</p>
        <p style="margin: 4px 0;"><strong>Email:</strong> ${buyerEmail}</p>
        <p style="margin: 4px 0;"><strong>Phone:</strong> ${buyerPhone || "—"}</p>
        <p style="margin: 4px 0;"><strong>Tickets:</strong> ${ticketCount}${
          ticketSummary ? ` (${ticketSummary})` : ""
        }</p>
        ${
          donationAmount && donationAmount > 0
            ? `<p style="margin: 4px 0;"><strong>Donation:</strong> ${cur} ${formatMoney(donationAmount)}</p>`
            : ""
        }
        <p style="margin: 4px 0;"><strong>Total:</strong> ${totalLabel}</p>
        <p style="margin: 4px 0;"><strong>Payment:</strong> ${paymentMethod || "—"}</p>
      </div>
      ${
        adminUrl
          ? `<p style="margin: 16px 0;"><a href="${adminUrl}" style="color: #0f766e;">Open admin dashboard</a></p>`
          : ""
      }
      <p style="font-size: 12px; color: #888; margin-top: 24px;">
        Automated notice from Connect Events. Buyer also received their confirmation email.
      </p>
    </div>
  `;

  const client = getResendClient();
  if (!client) {
    console.log("[Email SIMULATED] Admin notify to:", recipients.join(", "));
    console.log("[Email SIMULATED] Subject:", subject);
    return { success: true, messageId: "simulated-admin-" + Date.now() };
  }

  try {
    const result = await client.emails.send({
      from: `Connect Events <${FROM_EMAIL}>`,
      to: recipients,
      replyTo: buyerEmail || REPLY_TO,
      subject,
      html,
    });
    if (result.error) {
      console.error("[Email] Admin notify Resend error:", result.error);
      return { success: false, error: result.error.message };
    }
    return { success: true, messageId: result.data?.id };
  } catch (err) {
    console.error("[Email] Admin notify exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Admin email failed",
    };
  }
}
