"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OrderSummary } from "@/components/ticketing";
import { OrderCart } from "@/types";
import { loadEventBySlug } from "@/lib/config/events";
import { startCheckoutFlow, finalizeAfterPayment } from "@/lib/integrations/order.service";
import { ArrowLeft, CreditCard } from "lucide-react";

/**
 * Checkout Page
 * 
 * Current state:
 * - Reads cart from sessionStorage (set by event page)
 * - Shows clean order summary
 * - Has a "Pay with Wonder" button that currently simulates success
 * 
 * When payment integration is built:
 * - startCheckoutFlow will return a real redirectUrl
 * - User will be redirected to Wonder
 * - On return / webhook, finalizeAfterPayment will be called
 */

interface CheckoutPageProps {
  params: Promise<{ eventSlug: string }>;
}

export default function CheckoutPage({ params }: CheckoutPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [eventSlug, setEventSlug] = useState<string | null>(null);

  const [cart, setCart] = useState<OrderCart | null>(null);
  const [event, setEvent] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read slug
  useEffect(() => {
    params.then((p) => setEventSlug(p.eventSlug));
  }, [params]);

  // Load cart from storage
  useEffect(() => {
    if (!eventSlug) return;

    const stored = sessionStorage.getItem("pendingCart");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as OrderCart;
        if (parsed.eventSlug === eventSlug) {
          setCart(parsed);
          return;
        }
      } catch {
        // ignore
      }
    }
    // If no valid cart, send user back
    router.replace(`/${eventSlug}`);
  }, [eventSlug, router]);

  // Load event (async from DB or fallback)
  useEffect(() => {
    if (!eventSlug) return;
    loadEventBySlug(eventSlug).then(setEvent);
  }, [eventSlug]);

  // Handle the case where user returns from simulated Wonder redirect with a session param
  useEffect(() => {
    const session = searchParams.get("session");
    if (session && cart && !isProcessing) {
      // Auto-finalize simulation
      handlePaymentSuccess(session);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, cart]);

  if (!eventSlug || !event || !cart) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        Loading checkout...
      </div>
    );
  }

  // After this guard, cart is guaranteed to be non-null.
  // We assign to a const with explicit type so all handlers and JSX below
  // have a clean non-nullable reference (avoids TS narrowing issues with state).
  const currentCart: OrderCart = cart;

  async function handlePaymentSuccess(paymentReference?: string) {
    setIsProcessing(true);
    setError(null);

    try {
      console.log("[Checkout] Starting payment finalization for", paymentReference);
      // In real flow this would be called after Wonder redirects back + verifies
      const result = await finalizeAfterPayment(paymentReference || "SIM-" + Date.now(), currentCart);

      // Clean up temp cart
      sessionStorage.removeItem("pendingCart");

      console.log("[Checkout] Finalize result:", result);

      if (result.success) {
        // Pass minimal data to success page
        const successParams = new URLSearchParams({
          ref: result.orderReference || paymentReference || "",
          amount: currentCart.totalAmount.toString(),
        });
        console.log("[Checkout] Redirecting to success");
        router.push(`/${currentCart.eventSlug}/success?${successParams.toString()}`);
      } else {
        setError(result.error || "Payment processing failed");
      }
    } catch (e) {
      console.error("[Checkout] Error in payment success handling:", e);
      setError("An unexpected error occurred.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handlePayWithWonder() {
    setIsProcessing(true);
    setError(null);

    console.log("[Checkout] Starting simulated payment");
    const result = await startCheckoutFlow(currentCart);

    if (!result.success || !result.sessionId) {
      setError(result.error || "Could not start payment");
      setIsProcessing(false);
      return;
    }

    // For current development:
    // We simulate the Wonder flow by redirecting within the same app to the same page with a session param.
    // When real integration exists, use result.checkoutUrl instead.
    const checkoutUrl = `/${currentCart.eventSlug}/checkout?session=${result.sessionId}`;
    console.log("[Checkout] Redirecting to simulation with session", result.sessionId);
    router.push(checkoutUrl);
  }

  return (
    <div className="min-h-screen py-10" style={{ background: '#FAF8F5' }}>
      <div className="max-w-2xl mx-auto px-6">
        <button
          onClick={() => router.back()}
          className="mb-8 flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900"
        >
          <ArrowLeft size={16} /> Back to ticket selection
        </button>

        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Checkout</h1>
          <p className="text-zinc-600 mt-1">Review your order and complete payment.</p>
        </div>

        <div className="grid gap-6">
          <OrderSummary cart={currentCart} event={event} />

          <div className="rounded-2xl border bg-white p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center">
                <CreditCard className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <div className="font-medium">Pay with Wonder</div>
                <div className="text-xs" style={{ color: '#6B5E50' }}>Secure payment processing</div>
              </div>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              onClick={handlePayWithWonder}
              disabled={isProcessing}
              className="btn-gold w-full rounded-xl py-4 font-medium text-lg disabled:opacity-60"
            >
              {isProcessing ? "Processing payment..." : `Pay ${currentCart.currency} ${currentCart.totalAmount} with Wonder`}
            </button>

            <p className="text-center text-xs text-zinc-500 mt-3">
              This is a simulated checkout. Real Wonder integration can be enabled on request.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
