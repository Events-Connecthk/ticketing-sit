/**
 * KPay Payment Integration (STUB / ABSTRACTION)
 *
 * This file defines the payment provider abstraction used by order.service.ts.
 *
 * Environment variables expected:
 *   KPAY_API_KEY or KPAY_MERCHANT_ID
 *   KPAY_WEBHOOK_SECRET (for verifying webhooks later)
 */

import { OrderCart, PaymentInitiationResult } from "@/types";

const KPAY_API_KEY = process.env.KPAY_API_KEY || process.env.KPAY_MERCHANT_ID || "";

/**
 * Create a payment session / link with KPay.
 * Currently returns a fake session for UI development / simulation.
 */
export async function initiateKpayPayment(
  cart: OrderCart
): Promise<PaymentInitiationResult> {
  if (!KPAY_API_KEY) {
    console.warn("[KPay] No API key configured. Using development simulation.");
  }

  // Simulated payment session
  const simulatedPaymentId = `KPAY-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    success: true,
    paymentId: simulatedPaymentId,
    // The caller (checkout) will construct the proper redirect URL using the current event slug
    redirectUrl: `/checkout?session=${simulatedPaymentId}`,
  };
}

/**
 * Verify that payment completed successfully with KPay.
 * For now always returns success (simulation).
 */
export async function confirmKpayPayment(
  paymentId: string
): Promise<{ success: boolean; paymentReference?: string; error?: string }> {
  if (!paymentId) {
    return { success: false, error: "Missing payment session identifier" };
  }

  // Simulate success - in real implementation this would call KPay API or verify webhook
  return {
    success: true,
    paymentReference: paymentId,
  };
}

/**
 * Placeholder webhook verification helper.
 */
export function verifyKpayWebhook(payload: unknown, signature: string): boolean {
  // Real implementation would validate signature using shared secret
  void payload;
  void signature;
  return true; // Always accept in dev
}
