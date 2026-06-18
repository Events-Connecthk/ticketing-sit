/**
 * Order Service - Central Orchestration Layer
 *
 * This is the SINGLE most important abstraction for modularity and reusability.
 *
 * Responsibilities:
 * 1. Accept a clean "cart" object (event + buyer + tickets).
 * 2. Coordinate the full post-checkout flow:
 *    - Initiate / confirm payment (Wonder)
 *    - Create order in external WooCommerce
 *    - Persist record in our database
 *    - Generate PDF ticket
 *    - Send confirmation email
 *
 * Why this design?
 * - The rest of the app (pages/components) never talks directly to Woo, Wonder, DB, or Email.
 * - To support a completely different WordPress site, just swap the implementations in the called services.
 * - Easy to unit test each step in isolation.
 * - Future providers (Stripe instead of Wonder, different email, etc.) only require changing the injected services.
 *
 * Current implementation: Uses the lower-level services (wonder, woocommerce, db, email, pdf).
 * Payment step is intentionally stubbed per the task instructions.
 */

import { OrderCart, PurchaseRecord, OrderCreationResult } from "@/types";
import { createWooCommerceOrder } from "./woocommerce";
import { initiateWonderPayment, confirmWonderPayment } from "./wonder";
import { savePurchase } from "../db/purchases";
import { generateTicketPdf } from "../pdf/generate-ticket";
import { sendConfirmationEmail } from "./email";
import { loadEventBySlug } from "../config/events";

/**
 * Main entry point after a successful Wonder payment.
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

    // 2. Create order in WooCommerce (the external system of record for the WP site)
    const wooResult = await createWooCommerceOrder({
      cart,
      eventName: event.name,
      paymentReference,
    });

    if (!wooResult.success) {
      // Important: log and potentially retry or compensate.
      console.error("[OrderService] WooCommerce order creation failed", wooResult.error);
      // We still proceed in some flows to ensure buyer gets ticket (configurable).
    }

    // 3. Persist our own purchase record (for admin dashboard, reporting, exports)
    const purchaseRecord: Omit<PurchaseRecord, "id"> = {
      bought_at: new Date().toISOString(),
      name: cart.buyer.name,
      phone: cart.buyer.phone,
      email: cart.buyer.email,
      number_of_tickets: totalTickets,
      payment_method: "wonder",
      amount: cart.totalAmount,
      currency: cart.currency,
      event_slug: cart.eventSlug,
      ticket_breakdown: cart.tickets,
      order_reference: wooResult.orderReference,
      payment_reference: paymentReference,
    };

    console.log("[OrderService] Saving purchase to DB...");
    const savedRecord = await savePurchase(purchaseRecord);
    console.log("[OrderService] Purchase saved:", savedRecord.id);

    // 4. Generate beautiful PDF ticket
    console.log("[OrderService] Generating PDF ticket...");
    const pdfResult = await generateTicketPdf({
      event,
      buyer: cart.buyer,
      tickets: cart.tickets,
      orderReference: wooResult.orderReference || paymentReference,
      purchaseId: savedRecord.id?.toString(),
      amount: cart.totalAmount,
      currency: cart.currency,
    });
    console.log("[OrderService] PDF result:", pdfResult.success);

    // 5. Send confirmation email with PDF attached
    console.log("[OrderService] Sending confirmation email...");
    const emailResult = await sendConfirmationEmail({
      to: cart.buyer.email,
      buyerName: cart.buyer.name,
      event,
      orderReference: wooResult.orderReference || paymentReference,
      totalAmount: cart.totalAmount,
      currency: cart.currency,
      ticketCount: totalTickets,
      pdfBuffer: pdfResult.pdfBuffer,
      pdfFilename: pdfResult.filename,
    });
    console.log("[OrderService] Email result:", emailResult.success);

    if (!emailResult.success) {
      console.error("[OrderService] Email failed to send", emailResult.error);
      // Non-fatal for the purchase in most cases
    }

    return {
      success: true,
      orderId: wooResult.orderId,
      orderReference: wooResult.orderReference || paymentReference,
      metadata: {
        purchaseId: savedRecord.id,
        emailSent: emailResult.success,
        pdfGenerated: pdfResult.success,
      },
    };
  } catch (error) {
    console.error("[OrderService] Unexpected error during purchase processing", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown processing error",
    };
  }
}

/**
 * Initiates the payment flow using Wonder.app
 * This is intentionally a thin wrapper for now.
 * DO NOT implement the actual Wonder integration until explicitly asked.
 */
export async function startCheckoutFlow(cart: OrderCart): Promise<{
  success: boolean;
  checkoutUrl?: string;
  sessionId?: string;
  error?: string;
}> {
  // In a real implementation we would:
  // 1. Call Wonder to create a payment session / link
  // 2. Return a redirect URL that the client follows
  // For now we return a placeholder that the checkout page will use.

  const result = await initiateWonderPayment(cart);

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
  const confirmation = await confirmWonderPayment(sessionId);

  if (!confirmation.success || !confirmation.paymentReference) {
    return {
      success: false,
      error: confirmation.error || "Payment not confirmed",
    };
  }

  // This is the critical post-payment pipeline
  return processSuccessfulPurchase(cart, confirmation.paymentReference);
}
