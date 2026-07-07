/**
 * Order Service - Central Orchestration Layer
 *
 * This is the SINGLE most important abstraction for modularity and reusability.
 *
 * Responsibilities:
 * 1. Accept a clean "cart" object (event + buyer + tickets).
 * 2. Coordinate the full post-checkout flow:
 *    - Initiate / confirm payment (KPay)
 *    - Persist record in our database
 *    - Generate PDF ticket
 *    - Send confirmation email
 *
 * Why this design?
 * - The rest of the app never talks directly to the payment provider, DB, or Email.
 * - Easy to swap payment providers (KPay, Stripe, etc.).
 * - Easy to unit test each step in isolation.
 *
 * Current implementation uses abstraction layers for payment, database, email, and PDF.
 */

import { OrderCart, PurchaseRecord, OrderCreationResult } from "@/types";
import { initiateKpayPayment, confirmKpayPayment } from "./kpay";
import { savePurchase } from "../db/purchases";
import { generateTicketPdf } from "../pdf/generate-ticket";
import { sendConfirmationEmail } from "./email";
import { loadEventBySlug } from "../config/events";

/**
 * Main entry point after a successful KPay payment.
 * Call this from the success callback / webhook handler.
 */
export async function processSuccessfulPurchase(
  cart: OrderCart,
  paymentReference: string
): Promise<OrderCreationResult> {
  console.log("[OrderService] Starting post-payment processing for", cart.eventSlug, paymentReference);

  const event = await loadEventBySlug(cart.eventSlug);
  if (!event) {
    return { success: false, error: "Invalid event" };
  }

  try {
    // 1. Calculate total tickets
    const totalTickets = cart.tickets.reduce((sum, t) => sum + t.quantity, 0);

    // 2. Persist our own purchase record (for admin dashboard, reporting, exports)
    const orderReference = `KPY-${Date.now()}`;

    const purchaseRecord: Omit<PurchaseRecord, "id"> = {
      bought_at: new Date().toISOString(),
      name: cart.buyer.name,
      phone: cart.buyer.phone,
      email: cart.buyer.email,
      number_of_tickets: totalTickets,
      payment_method: paymentReference.startsWith("FREE") ? "free" : "kpay",
      amount: cart.totalAmount,
      currency: cart.currency,
      event_slug: cart.eventSlug,
      ticket_breakdown: cart.tickets,
      order_reference: orderReference,
      payment_reference: paymentReference,
      applied_discount_code: cart.appliedDiscountCode,
      discount_amount: cart.discountAmount,
    };

    console.log("[OrderService] Saving purchase to DB...");
    const savedRecord = await savePurchase(purchaseRecord);
    console.log("[OrderService] Purchase saved:", savedRecord.id);

    // Return success immediately so checkout can redirect to success page
    const successResult = {
      success: true,
      orderReference,
      metadata: {
        purchaseId: savedRecord.id,
        emailSent: false,
        pdfGenerated: false,
      },
    };

    // Fire and forget the heavy parts (PDF + email) so redirect isn't blocked
    (async () => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://connecthk.org';
        const downloadUrl = cart.totalAmount > 0 ? `${baseUrl}/${event.slug}/success?ref=${orderReference}` : undefined;

        console.log("[OrderService] Sending confirmation email (background)...");
        const emailResult = await sendConfirmationEmail({
          to: cart.buyer.email,
          buyerName: cart.buyer.name,
          event,
          orderReference: paymentReference,
          totalAmount: cart.totalAmount,
          currency: cart.currency,
          ticketCount: totalTickets,
          downloadUrl,
        });
        console.log("[OrderService] Email result (background):", emailResult.success);
      } catch (bgError) {
        console.error("[OrderService] Background email error (non-blocking):", bgError);
      }
    })();

    return successResult;
  } catch (error) {
    console.error("[OrderService] Unexpected error during purchase processing", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown processing error",
    };
  }
}

/**
 * Initiates the payment flow using KPay.
 */
export async function startCheckoutFlow(cart: OrderCart): Promise<{
  success: boolean;
  checkoutUrl?: string;
  sessionId?: string;
  error?: string;
}> {
  const result = await initiateKpayPayment(cart);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    checkoutUrl: result.redirectUrl,
    sessionId: result.paymentId,
  };
}

/**
 * Helper used on success page / webhook to verify and finalize.
 */
export async function finalizeAfterPayment(
  sessionId: string,
  cart: OrderCart
): Promise<OrderCreationResult> {
  const confirmation = await confirmKpayPayment(sessionId);

  if (!confirmation.success || !confirmation.paymentReference) {
    return {
      success: false,
      error: confirmation.error || "Payment not confirmed",
    };
  }

  // This is the critical post-payment pipeline
  return processSuccessfulPurchase(cart, confirmation.paymentReference);
}
