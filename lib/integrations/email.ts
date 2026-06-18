/**
 * Email Service
 *
 * Sends transactional confirmation emails.
 * Currently uses Resend (https://resend.com) for excellent developer experience
 * and reliable deliverability.
 *
 * The service is abstracted so it can be swapped for Nodemailer, SendGrid, etc.
 */

import { Resend } from "resend";
import { EventConfig, EmailSendResult } from "@/types";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "tickets@example.com";

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
  pdfBuffer?: Buffer;
  pdfFilename?: string;
}

export async function sendConfirmationEmail(
  params: SendConfirmationParams
): Promise<EmailSendResult> {
  const { to, buyerName, event, orderReference, totalAmount, currency, ticketCount, pdfBuffer, pdfFilename } = params;

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
        Your official ticket PDF is attached to this email. Please present it (printed or on your phone) at the entrance.
      </p>

      <p style="margin-top: 32px; font-size: 13px; color: #888;">
        If you have any questions, please contact the event organizers.<br/>
        This is an automated message — please do not reply directly.
      </p>
    </div>
  `;

  const attachments = pdfBuffer && pdfFilename
    ? [
        {
          filename: pdfFilename,
          content: pdfBuffer,
        },
      ]
    : undefined;

  if (!client) {
    // Development / simulation mode
    console.log("[Email SIMULATED] To:", to);
    console.log("[Email SIMULATED] Subject:", subject);
    console.log("[Email SIMULATED] Would attach:", pdfFilename || "no-pdf");
    return { success: true, messageId: "simulated-" + Date.now() };
  }

  try {
    const result = await client.emails.send({
      from: FROM_EMAIL,
      to,
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
