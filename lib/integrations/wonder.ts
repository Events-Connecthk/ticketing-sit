/**
 * Wonder.app Payment Integration (STUB / ABSTRACTION)
 *
 * IMPORTANT: Per the project instructions, the actual Wonder.app payment
 * integration should NOT be implemented until the developer explicitly asks.
 *
 * This file exists to:
 * - Define the contract that order.service.ts expects
 * - Allow the rest of the UI and flow to be built and tested
 * - Make it trivial to wire up the real integration later
 *
 * Real implementation will likely involve:
 * - Creating a Payment Link or Payment Session via Wonder OpenAPI
 * - Redirecting user to Wonder hosted checkout
 * - Handling success redirect + webhook for final confirmation
 *
 * Environment variables expected:
 *   WONDER_API_KEY or WONDER_MERCHANT_ID
 *   WONDER_WEBHOOK_SECRET (for verifying webhooks later)
 */

import { OrderCart, PaymentInitiationResult } from "@/types";

const WONDER_API_KEY = process.env.WONDER_API_KEY || process.env.WONDER_MERCHANT_ID || "";

/**
 * Create a payment session / link with Wonder.
 * Currently returns a fake redirect for UI development.
 */
export async function initiateWonderPayment(
  cart: OrderCart
): Promise<PaymentInitiationResult> {
  // TODO: Replace this stub when ready.
  // Example real call (pseudocode):
  // const res = await fetch('https://api.wonder.app/v1/payments', {
  //   method: 'POST',
  //   headers: { 'Authorization': `Bearer ${WONDER_API_KEY}`, ... },
  //   body: JSON.stringify({ amount: cart.totalAmount, currency: cart.currency, ... })
  // })

  if (!WONDER_API_KEY) {
    console.warn("[Wonder] No API key configured. Using development simulation.");
  }

  // Return a simulated checkout URL that the UI can "pretend" to go through.
  // The checkout page will have a "Simulate Successful Payment" button.
  const simulatedPaymentId = `WONDER-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    success: true,
    paymentId: simulatedPaymentId,
    redirectUrl: `/at-the-peak/checkout?session=${simulatedPaymentId}`, // Will be used internally
  };
}

/**
 * Verify that payment completed successfully with Wonder.
 * For now always returns success with a fake reference.
 * Replace with real status check or webhook consumption.
 */
export async function confirmWonderPayment(
  paymentId: string
): Promise<{ success: boolean; paymentReference?: string; error?: string }> {
  // TODO: Implement actual verification using Wonder's API or webhook payload
  // For development we treat any non-empty paymentId as successful.

  if (!paymentId) {
    return { success: false, error: "Missing payment session identifier" };
  }

  // Simulate success
  return {
    success: true,
    paymentReference: paymentId,
  };
}

/**
 * Placeholder webhook verification helper (to be implemented later).
 */
export function verifyWonderWebhook(payload: unknown, signature: string): boolean {
  // Real implementation would use HMAC with shared secret
  void payload;
  void signature;
  return true; // Always accept in dev
}
