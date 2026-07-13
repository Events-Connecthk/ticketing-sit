'use server';

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
import {
  savePurchase,
  getPurchaseByPaymentReference,
} from "../db/purchases";
import { generateTicketPdf } from "../pdf/generate-ticket";
import { sendConfirmationEmail } from "./email";
import { loadEventBySlug } from "../config/events";
import { expandTicketsWithSerials } from "../tickets/serials";

// Prevent double-fulfillment within a single serverless instance
const processedPaymentRefs = new Map<string, string>(); // paymentRef → orderReference

/**
 * Main entry point after a successful KPay payment.
 * Call this from the success callback / webhook handler.
 */
export async function processSuccessfulPurchase(
  cart: OrderCart,
  paymentReference: string
): Promise<OrderCreationResult> {
  console.log("[OrderService] Starting post-payment processing for", cart.eventSlug, paymentReference);

  if (paymentReference && processedPaymentRefs.has(paymentReference)) {
    const existing = processedPaymentRefs.get(paymentReference)!;
    console.log("[OrderService] Idempotent hit for", paymentReference, "→", existing);
    return {
      success: true,
      orderReference: existing,
      metadata: { duplicate: true },
    };
  }

  // Durable idempotency across Vercel instances (webhook + browser return race)
  if (paymentReference) {
    const already = await getPurchaseByPaymentReference(paymentReference);
    if (already?.order_reference) {
      processedPaymentRefs.set(paymentReference, already.order_reference);
      console.log(
        "[OrderService] DB idempotent hit for",
        paymentReference,
        "→",
        already.order_reference
      );
      return {
        success: true,
        orderReference: already.order_reference,
        metadata: { duplicate: true },
      };
    }
  }

  const event = await loadEventBySlug(cart.eventSlug);
  if (!event) {
    return { success: false, error: "Invalid event" };
  }

  try {
    // 1. Calculate total tickets
    const totalTickets = cart.tickets.reduce((sum, t) => sum + t.quantity, 0);

    // 2. Persist our own purchase record (for admin dashboard, reporting, exports)
    const orderReference = `KPY-${Date.now()}`;
    if (paymentReference) {
      processedPaymentRefs.set(paymentReference, orderReference);
    }

    // One order row; many scannable serials KPY-…-001, -002, …
    const ticketUnits = expandTicketsWithSerials(orderReference, cart.tickets);

    const purchaseRecord: Omit<PurchaseRecord, "id"> = {
      bought_at: new Date().toISOString(),
      name: cart.buyer.name,
      phone: cart.buyer.phone,
      email: cart.buyer.email,
      number_of_tickets: ticketUnits.length || totalTickets,
      payment_method: paymentReference.startsWith("FREE") ? "free" : "kpay",
      amount: cart.totalAmount,
      currency: cart.currency,
      event_slug: cart.eventSlug,
      ticket_breakdown: ticketUnits,
      order_reference: orderReference,
      payment_reference: paymentReference,
      applied_discount_code: cart.appliedDiscountCode,
      discount_amount: cart.discountAmount,
    };

    console.log("[OrderService] Saving purchase to DB...");
    const savedRecord = await savePurchase(purchaseRecord);
    // Prefer DB order ref if insert was a race/duplicate (23505 → existing row)
    const finalOrderRef =
      savedRecord.order_reference || orderReference;
    if (paymentReference) {
      processedPaymentRefs.set(paymentReference, finalOrderRef);
    }
    console.log(
      "[OrderService] Purchase saved:",
      savedRecord.id,
      finalOrderRef
    );

    // Return success immediately so checkout can redirect to success page
    const successResult = {
      success: true,
      orderReference: finalOrderRef,
      metadata: {
        purchaseId: savedRecord.id,
        emailSent: false,
        pdfGenerated: false,
        duplicate:
          Boolean(savedRecord.order_reference) &&
          savedRecord.order_reference !== orderReference,
      },
    };

    // Fire and forget PDF/email only for first insert (not webhook/return race)
    if (!successResult.metadata.duplicate) {
      (async () => {
        try {
          const baseUrl = (
            process.env.NEXT_PUBLIC_SITE_URL ||
            (process.env.VERCEL_PROJECT_PRODUCTION_URL
              ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/^https?:\/\//, "")}`
              : "") ||
            "http://localhost:3000"
          ).replace(/\/$/, "");
          const downloadUrl =
            cart.totalAmount > 0
              ? `${baseUrl}/${event.slug}/success?ref=${finalOrderRef}&amount=${cart.totalAmount}`
              : undefined;

          console.log(
            "[OrderService] Sending confirmation email (background)..."
          );
          const emailResult = await sendConfirmationEmail({
            to: cart.buyer.email,
            buyerName: cart.buyer.name,
            event,
            orderReference: finalOrderRef,
            totalAmount: cart.totalAmount,
            currency: cart.currency,
            ticketCount: ticketUnits.length || totalTickets,
            downloadUrl,
          });
          console.log(
            "[OrderService] Email result (background):",
            emailResult.success
          );
        } catch (bgError) {
          console.error(
            "[OrderService] Background email error (non-blocking):",
            bgError
          );
        }
      })();
    } else {
      console.log(
        "[OrderService] Skip duplicate email — purchase already existed",
        finalOrderRef
      );
    }

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
 * When KPAY_MERCHANT_CODE (or aliases) is set, returns the real hosted checkout URL.
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
 * Recover cart after KPay return when sessionStorage is empty
 * (new tab, cleared storage, or mobile browser). Uses durable pending row.
 */
export async function getPendingCartForSession(
  sessionId: string
): Promise<OrderCart | null> {
  if (!sessionId) return null;
  const { getPendingPayment } = await import("./pending-payments");
  const pending = await getPendingPayment(sessionId);
  if (!pending?.cart?.eventSlug) return null;
  return pending.cart;
}

/** Debug: pending / webhook / purchase state for a session (admin troubleshooting). */
export async function getKpaySessionDebug(sessionId: string): Promise<{
  sessionId: string;
  hasPending: boolean;
  pendingStatus?: string;
  hasCart: boolean;
  hasPurchase: boolean;
  orderReference?: string;
  siteUrl?: string;
}> {
  const { getPendingPayment } = await import("./pending-payments");
  const { getPurchaseByPaymentReference } = await import("../db/purchases");
  const pending = sessionId ? await getPendingPayment(sessionId) : null;
  const purchase = sessionId
    ? await getPurchaseByPaymentReference(sessionId)
    : null;
  return {
    sessionId,
    hasPending: Boolean(pending),
    pendingStatus: pending?.status,
    hasCart: Boolean(pending?.cart?.eventSlug),
    hasPurchase: Boolean(purchase),
    orderReference: purchase?.order_reference,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  };
}

/**
 * Helper used after redirect from KPay (or webhook).
 * Calls confirmKpayPayment then runs the full success pipeline (save purchase, email, PDF).
 */
export async function finalizeAfterPayment(
  sessionId: string,
  cart: OrderCart,
  opts?: {
    returnResult?: "success" | "cancel" | "unknown";
    userConfirmedPaid?: boolean;
  }
): Promise<OrderCreationResult> {
  const confirmation = await confirmKpayPayment(sessionId, {
    returnResult: opts?.returnResult,
    userConfirmedPaid: opts?.userConfirmedPaid,
  });

  if (!confirmation.success || !confirmation.paymentReference) {
    // Webhook may have finished; purchase exists even if confirm path refused
    const already = await getPurchaseByPaymentReference(sessionId);
    if (already?.order_reference) {
      return {
        success: true,
        orderReference: already.order_reference,
        metadata: { via: "existing_purchase", outcome: "paid" },
      };
    }
    return {
      success: false,
      error: confirmation.error || "Payment not confirmed",
      metadata: {
        outcome: confirmation.outcome || "unknown",
      },
    };
  }

  // This is the critical post-payment pipeline (DB + email + PDF generation)
  const done = await processSuccessfulPurchase(
    cart,
    confirmation.paymentReference
  );
  return {
    ...done,
    metadata: { ...done.metadata, outcome: "paid" },
  };
}
