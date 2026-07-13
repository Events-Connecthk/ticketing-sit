"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OrderSummary } from "@/components/ticketing";
import { OrderCart } from "@/types";
import { loadEventBySlug } from "@/lib/config/events";
import {
  startCheckoutFlow,
  finalizeAfterPayment,
  getPendingCartForSession,
  getKpaySessionDebug,
} from "@/lib/integrations/order.service";
import { ArrowLeft, CreditCard } from "lucide-react";

/**
 * Checkout Page
 *
 * Flow:
 * - Reads cart from sessionStorage (pendingCart)
 * - Calls startCheckoutFlow → initiateKpayPayment
 * - Real KPay → external paymentUrl
 * - On return (?session=<outTradeNo>) → poll status; never auto-issue on bare return
 *   (KPay may reuse returnUrl for cancel). User confirms pay only if needed.
 */

interface CheckoutPageProps {
  params: Promise<{ eventSlug: string }>;
}

type ReturnKind = "success" | "cancel" | "unknown";

function detectReturnKind(searchParams: URLSearchParams): {
  session: string | null;
  kind: ReturnKind;
  rawResult: string;
  fullQuery: string;
} {
  const session =
    searchParams.get("session") ||
    searchParams.get("outTradeNo") ||
    searchParams.get("out_trade_no") ||
    searchParams.get("managedOrderNo") ||
    searchParams.get("orderNo");

  const rawResult = (
    searchParams.get("kpay_result") ||
    searchParams.get("result") ||
    searchParams.get("status") ||
    searchParams.get("payStatus") ||
    searchParams.get("pay_status") ||
    ""
  ).toLowerCase();

  const isCancel = ["cancel", "cancelled", "fail", "failed", "error", "close", "closed"].some(
    (s) => rawResult === s || rawResult.includes(s)
  );
  const isSuccess = ["success", "paid", "ok", "complete", "completed", "successful"].some(
    (s) => rawResult === s || rawResult.includes(s)
  );

  let kind: ReturnKind = "unknown";
  if (isCancel) kind = "cancel";
  else if (isSuccess) kind = "success";
  // Bare return (no status) stays "unknown" — do NOT treat as success

  return {
    session,
    kind,
    rawResult,
    fullQuery: typeof window !== "undefined" ? window.location.search : "",
  };
}

export default function CheckoutPage({ params }: CheckoutPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [eventSlug, setEventSlug] = useState<string | null>(null);

  const [cart, setCart] = useState<OrderCart | null>(null);
  const [event, setEvent] = useState<any>(null);
  const [cartLoadState, setCartLoadState] = useState<"loading" | "ready" | "missing">(
    "loading"
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** After return from KPay when status is unknown — show confirm/cancel buttons */
  const [needsManualConfirm, setNeedsManualConfirm] = useState(false);
  const [returnDebug, setReturnDebug] = useState<string>("");
  /** Prevents re-running finalize when isProcessing flips false while ?session= is still in the URL */
  const finalizedSessionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    params.then((p) => setEventSlug(p.eventSlug));
  }, [params]);

  // Load cart: sessionStorage first, then durable server pending (Vercel return)
  useEffect(() => {
    if (!eventSlug) return;

    let cancelled = false;

    async function loadCart() {
      const session =
        searchParams.get("session") ||
        searchParams.get("outTradeNo") ||
        searchParams.get("out_trade_no");

      const candidates = [
        session ? sessionStorage.getItem(`kpay_cart_${session}`) : null,
        sessionStorage.getItem("pendingCart"),
      ];

      for (const stored of candidates) {
        if (!stored) continue;
        try {
          const parsed = JSON.parse(stored) as OrderCart;
          if (parsed.eventSlug === eventSlug) {
            if (!cancelled) {
              setCart(parsed);
              setCartLoadState("ready");
            }
            return;
          }
        } catch {
          // ignore
        }
      }

      // Returning from KPay with session but storage empty → recover from Supabase pending
      if (session) {
        try {
          const recovered = await getPendingCartForSession(session);
          if (cancelled) return;
          if (recovered && recovered.eventSlug === eventSlug) {
            setCart(recovered);
            setCartLoadState("ready");
            try {
              sessionStorage.setItem(`kpay_cart_${session}`, JSON.stringify(recovered));
              sessionStorage.setItem("pendingCart", JSON.stringify(recovered));
            } catch {
              /* ignore */
            }
            return;
          }
        } catch (e) {
          console.warn("[Checkout] Server cart recover failed:", e);
        }
        if (!cancelled) setCartLoadState("missing");
        return;
      }

      // Fresh visit, no cart → back to event
      if (!cancelled) {
        setCartLoadState("missing");
        router.replace(`/${eventSlug}`);
      }
    }

    void loadCart();
    return () => {
      cancelled = true;
    };
  }, [eventSlug, router, searchParams]);

  const [eventLoadFailed, setEventLoadFailed] = useState(false);

  useEffect(() => {
    if (!eventSlug) return;
    setEventLoadFailed(false);
    loadEventBySlug(eventSlug)
      .then((ev) => {
        if (ev) setEvent(ev);
        else setEventLoadFailed(true);
      })
      .catch((e) => {
        console.error("[Checkout] loadEvent failed:", e);
        setEventLoadFailed(true);
      });
  }, [eventSlug]);

  // Handle return from KPay
  // IMPORTANT: do not depend on isProcessing — that caused an infinite finalize loop.
  useEffect(() => {
    if (!cart) return;

    const { session, kind, rawResult, fullQuery } = detectReturnKind(searchParams);
    if (!session) return;

    setReturnDebug(
      `session=${session} kind=${kind} rawResult=${rawResult || "(empty)"} query=${fullQuery}`
    );
    console.log("[Checkout] Return from KPay", { session, kind, rawResult, fullQuery });

    const isInternalSim =
      session.startsWith("KPAY-") ||
      session.startsWith("SIM-") ||
      session.startsWith("FREE-");

    // Explicit cancel marker (our cancelUrl)
    if (kind === "cancel") {
      if (finalizedSessionsRef.current.has(`cancel:${session}`)) return;
      finalizedSessionsRef.current.add(`cancel:${session}`);
      setNeedsManualConfirm(false);
      setError("Payment was cancelled. No ticket was issued — you can try again.");
      setIsProcessing(false);
      try {
        sessionStorage.removeItem(`kpay_cart_${session}`);
      } catch {
        /* ignore */
      }
      return;
    }

    if (finalizedSessionsRef.current.has(session)) return;
    finalizedSessionsRef.current.add(session);

    // Internal sim always finalizes as success
    if (isInternalSim) {
      void handlePaymentSuccess(session, cart, "success");
      return;
    }

    // Real KPay: ALWAYS poll with "unknown" first — never auto-trust bare return.
    // If paid (API/webhook) → tickets. If not → show manual confirm buttons.
    // (KPay often lands cancel on the same URL as success without kpay_result=cancel.)
    void handlePaymentReturnPoll(session, cart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, cart]);

  if (eventSlug && (cartLoadState === "missing" || eventLoadFailed)) {
    const session =
      searchParams.get("session") || searchParams.get("outTradeNo") || "";
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-2xl border bg-white p-6 space-y-4 text-center">
          <h1 className="text-xl font-semibold">
            {eventLoadFailed ? "Event not found" : "Payment returned"}
          </h1>
          <p className="text-sm text-zinc-600">
            {eventLoadFailed
              ? `Could not load event “${eventSlug}”. Check the URL or admin events.`
              : session
                ? "We could not restore your cart for this session. If you cancelled, no ticket was issued. If you paid, check your email or try again from the event page."
                : "No cart found for checkout."}
          </p>
          {session && (
            <p className="text-xs font-mono text-zinc-400 break-all">session={session}</p>
          )}
          <button
            type="button"
            className="btn-gold w-full rounded-xl py-3 font-medium"
            onClick={() => router.replace(eventLoadFailed ? "/events" : `/${eventSlug}`)}
          >
            {eventLoadFailed ? "Browse events" : "Back to event"}
          </button>
        </div>
      </div>
    );
  }

  if (!eventSlug || !event || !cart || cartLoadState === "loading") {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-2 text-zinc-600">
        <p>Loading checkout...</p>
        <p className="text-xs text-zinc-400">
          {!eventSlug ? "slug…" : !event ? "event…" : "cart…"}
        </p>
      </div>
    );
  }

  const currentCart: OrderCart = cart;
  const isFreeEvent = !event.paymentEnabled;

  async function handlePaymentReturnPoll(paymentReference: string, usedCart: OrderCart) {
    setIsProcessing(true);
    setError(null);
    setNeedsManualConfirm(false);

    try {
      // Wait for webhook (only real paid proof). Cancel never gets a paid webhook → no tickets.
      // Intermediate page: wait for notifyUrl (KPay recommended flow)
      setError(null);
      console.log(
        "[Checkout] Waiting for transaction result / webhook for",
        paymentReference
      );
      try {
        const dbg = await getKpaySessionDebug(paymentReference);
        console.log("[Checkout] Session debug:", dbg);
      } catch (e) {
        console.warn("[Checkout] Session debug failed", e);
      }

      // Poll several times — do not treat return URL alone as paid
      let result = await finalizeAfterPayment(paymentReference, usedCart, {
        returnResult: "unknown",
      });
      for (let i = 0; i < 4 && !result.success; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        result = await finalizeAfterPayment(paymentReference, usedCart, {
          returnResult: "unknown",
        });
      }

      console.log("[Checkout] Finalize result:", JSON.stringify(result));

      if (result.success) {
        try {
          sessionStorage.removeItem("pendingCart");
          sessionStorage.removeItem(`kpay_cart_${paymentReference}`);
          sessionStorage.removeItem("pendingKpaySession");
        } catch {
          /* ignore */
        }
        const successParams = new URLSearchParams({
          ref: result.orderReference || paymentReference,
          amount: usedCart.totalAmount.toString(),
        });
        router.replace(
          `/${usedCart.eventSlug}/success?${successParams.toString()}`
        );
        return;
      }

      const outcome = String(result.metadata?.outcome || "");
      const errText = String(result.error || "");
      const looksCancelled =
        outcome === "cancelled" ||
        /cancell?ed|failed\. No ticket|not issued/i.test(errText);

      // Clear cancel: no dual-button confusion
      if (looksCancelled) {
        finalizedSessionsRef.current.add(`cancel:${paymentReference}`);
        try {
          sessionStorage.removeItem(`kpay_cart_${paymentReference}`);
          sessionStorage.removeItem("pendingKpaySession");
        } catch {
          /* ignore */
        }
        setNeedsManualConfirm(false);
        setError(
          result.error ||
            "Payment was cancelled. No ticket was issued — you can try again."
        );
        return;
      }

      // Still unknown (order pending / no webhook) — keep safety buttons
      finalizedSessionsRef.current.delete(paymentReference);
      setNeedsManualConfirm(true);
      setError(
        result.error ||
          "We could not tell yet if payment completed. If you paid, tap “I paid”. If you left without paying, tap “I cancelled”."
      );
    } catch (e) {
      console.error("[Checkout] Return finalize error:", e);
      finalizedSessionsRef.current.delete(paymentReference);
      setNeedsManualConfirm(true);
      setError("Could not verify payment. If you paid, tap “I paid”. If you cancelled, no ticket.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handlePaymentSuccess(
    paymentReference?: string,
    passedCart?: OrderCart,
    returnResult: ReturnKind = "unknown",
    userConfirmedPaid = false
  ) {
    const usedCart = passedCart || currentCart;
    const sessionKey = paymentReference || "SIM-" + Date.now();
    if (paymentReference) {
      finalizedSessionsRef.current.add(paymentReference);
    }

    setIsProcessing(true);
    setError(null);
    setNeedsManualConfirm(false);

    try {
      console.log(
        "[Checkout] Starting payment finalization for",
        paymentReference,
        returnResult,
        "userConfirmed=",
        userConfirmedPaid
      );
      const result = await finalizeAfterPayment(sessionKey, usedCart, {
        returnResult,
        userConfirmedPaid,
      });

      try {
        sessionStorage.removeItem("pendingCart");
        if (paymentReference) {
          sessionStorage.removeItem(`kpay_cart_${paymentReference}`);
        }
        sessionStorage.removeItem("pendingKpaySession");
      } catch {
        // ignore
      }

      console.log("[Checkout] Finalize result:", result);

      if (result.success) {
        const successParams = new URLSearchParams({
          ref: result.orderReference || paymentReference || "",
          amount: usedCart.totalAmount.toString(),
        });
        console.log("[Checkout] Redirecting to success");
        router.replace(`/${usedCart.eventSlug}/success?${successParams.toString()}`);
        return;
      } else {
        setError(result.error || "Payment processing failed");
        if (paymentReference) {
          finalizedSessionsRef.current.delete(paymentReference);
        }
        // Only show manual confirm if not an explicit cancel
        if (returnResult !== "cancel") {
          setNeedsManualConfirm(true);
        }
      }
    } catch (e) {
      console.error("[Checkout] Error in payment success handling:", e);
      setError("An unexpected error occurred.");
      if (paymentReference) {
        finalizedSessionsRef.current.delete(paymentReference);
      }
      setNeedsManualConfirm(true);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handlePayWithKpay() {
    setIsProcessing(true);
    setError(null);
    setNeedsManualConfirm(false);

    if (isFreeEvent) {
      console.log("[Checkout] Free registration");
      const freeCart = { ...currentCart, totalAmount: 0 };
      await handlePaymentSuccess("FREE-" + Date.now(), freeCart, "success");
      setIsProcessing(false);
      return;
    }

    console.log("[Checkout] Starting KPay payment flow");
    const result = await startCheckoutFlow(currentCart);

    if (!result.success || !result.sessionId) {
      setError(result.error || "Could not start payment");
      setIsProcessing(false);
      return;
    }

    try {
      sessionStorage.setItem(
        `kpay_cart_${result.sessionId}`,
        JSON.stringify(currentCart)
      );
      sessionStorage.setItem("pendingCart", JSON.stringify(currentCart));
      sessionStorage.setItem("pendingKpaySession", result.sessionId);
    } catch {
      // ignore quota errors
    }

    if (result.checkoutUrl && /^https?:\/\//i.test(result.checkoutUrl)) {
      console.log("[Checkout] Redirecting to KPay hosted checkout");
      window.location.href = result.checkoutUrl;
      return;
    }

    await handlePaymentSuccess(result.sessionId, currentCart, "success");
  }

  function handleManualPaid() {
    const s =
      searchParams.get("session") ||
      searchParams.get("outTradeNo") ||
      searchParams.get("out_trade_no") ||
      "";
    if (!s) {
      setError("Missing payment session. Start checkout again.");
      return;
    }
    // Explicit user action only — never auto on redirect (cancel-safe)
    finalizedSessionsRef.current.delete(s);
    void handlePaymentSuccess(s, currentCart, "success", true);
  }

  function handleManualCancel() {
    const s =
      searchParams.get("session") ||
      searchParams.get("outTradeNo") ||
      searchParams.get("out_trade_no") ||
      "";
    if (s) {
      finalizedSessionsRef.current.add(`cancel:${s}`);
      try {
        sessionStorage.removeItem(`kpay_cart_${s}`);
      } catch {
        /* ignore */
      }
    }
    setNeedsManualConfirm(false);
    setError("Payment was cancelled. No ticket was issued — you can try again.");
    setIsProcessing(false);
  }

  const hasReturnSession = Boolean(
    searchParams.get("session") || searchParams.get("outTradeNo")
  );

  return (
    <div className="min-h-screen py-10" style={{ background: "#FAF8F5" }}>
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
                <div className="font-medium">
                  {isFreeEvent ? "Free Registration" : "Pay with KPay"}
                </div>
                <div className="text-xs" style={{ color: "#6B5E50" }}>
                  {isFreeEvent ? "No payment required" : "Secure payment processing"}
                </div>
              </div>
            </div>

            {/* Shown when webhook has not confirmed paid (cancel OR pay still processing) */}
            {needsManualConfirm && hasReturnSession && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <div>
                  <p className="font-medium text-amber-950">
                    Did you finish payment?
                  </p>
                  <p className="text-sm text-amber-900/80 mt-1">
                    KPay sent you back without a clear paid/cancel flag (same return URL
                    for both). We checked the order status but it is still pending. Pick
                    what you did — no ticket is issued unless you confirm payment.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-600 text-white px-4 py-3 font-medium disabled:opacity-60"
                    disabled={isProcessing}
                    onClick={handleManualPaid}
                  >
                    I paid — get my tickets
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-zinc-300 bg-white text-zinc-800 px-4 py-3 font-medium disabled:opacity-60"
                    disabled={isProcessing}
                    onClick={handleManualCancel}
                  >
                    I cancelled — no ticket
                  </button>
                </div>
                {returnDebug && (
                  <p className="text-[10px] text-zinc-500 break-all font-mono">
                    {returnDebug}
                  </p>
                )}
              </div>
            )}

            {error && !needsManualConfirm && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 space-y-2">
                <p>{error}</p>
                {/cancell?ed|not issued/i.test(error) && (
                  <p className="text-xs text-red-600/80">
                    You can pay again with the button below when ready.
                  </p>
                )}
              </div>
            )}

            <button
              onClick={handlePayWithKpay}
              disabled={isProcessing}
              className="btn-gold w-full rounded-xl py-4 font-medium text-lg disabled:opacity-60"
            >
              {isProcessing
                ? isFreeEvent
                  ? "Registering..."
                  : hasReturnSession
                    ? "Checking payment..."
                    : "Processing payment..."
                : isFreeEvent
                  ? "Register for Free"
                  : `Pay ${currentCart.currency} ${currentCart.totalAmount} with KPay`}
            </button>

            <p className="text-center text-xs text-zinc-500 mt-3">
              {isFreeEvent
                ? "Free registration flow. No payment required."
                : "You will be redirected to KPay to complete payment securely."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
