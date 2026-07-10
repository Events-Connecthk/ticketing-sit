import { NextRequest, NextResponse } from "next/server";
import { verifyKpayWebhook } from "@/lib/integrations/kpay";
import { processSuccessfulPurchase } from "@/lib/integrations/order.service";
import {
  getPendingPayment,
  markPendingPaid,
  deletePendingPayment,
} from "@/lib/integrations/pending-payments";
import { getPurchaseByPaymentReference } from "@/lib/db/purchases";

/**
 * KPay async notification (webhook)
 *
 * Production (Vercel):
 *   NEXT_PUBLIC_SITE_URL=https://your-app.vercel.app
 *   notifyUrl → https://your-app.vercel.app/api/webhooks/kpay
 *
 * Requires durable pending cart (Supabase pending_kpay_payments + service role).
 * Always return 200 quickly after handling so KPay does not retry aggressively.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractSignature(request: NextRequest, body: any): string {
  return (
    request.headers.get("x-kpay-signature") ||
    request.headers.get("K-Signature") ||
    request.headers.get("k-signature") ||
    body?.signature ||
    body?.sign ||
    body?.data?.signature ||
    ""
  );
}

function extractPaymentFields(body: any): {
  outTradeNo?: string;
  paymentId?: string;
  status?: string;
  success: boolean;
} {
  const data = body?.data ?? body ?? {};
  const outTradeNo =
    data.outTradeNo ||
    data.out_trade_no ||
    body?.outTradeNo ||
    body?.out_trade_no;

  const paymentId =
    data.managedOrderNo ||
    data.orderNo ||
    data.paymentId ||
    data.transactionId ||
    outTradeNo;

  const status = String(
    data.status ||
      data.orderStatus ||
      data.payStatus ||
      body?.status ||
      body?.type ||
      ""
  ).toUpperCase();

  const type = String(body?.type || body?.event || "").toLowerCase();

  const success =
    type.includes("success") ||
    type.includes("paid") ||
    status.includes("SUCCESS") ||
    status.includes("PAID") ||
    status === "2" ||
    status === "S" ||
    Number(body?.code) === 10000 ||
    data.success === true;

  return { outTradeNo, paymentId, status, success };
}

export async function POST(request: NextRequest) {
  try {
    const rawText = await request.text();
    let body: any = {};
    try {
      body = rawText ? JSON.parse(rawText) : {};
    } catch {
      body = { raw: rawText };
    }

    const signature = extractSignature(request, body);
    console.log("[KPay Webhook] Received", {
      hasSignature: Boolean(signature),
      type: body?.type,
      keys: Object.keys(body || {}),
    });

    const valid = await verifyKpayWebhook(body, signature);
    if (!valid) {
      console.warn("[KPay Webhook] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const { outTradeNo, paymentId, success } = extractPaymentFields(body);

    if (!success) {
      console.log("[KPay Webhook] Non-success notification — acknowledged");
      return NextResponse.json({ received: true, processed: false });
    }

    const ref = outTradeNo || paymentId;
    if (!ref) {
      console.warn("[KPay Webhook] Missing outTradeNo/paymentId");
      return NextResponse.json({ received: true, processed: false });
    }

    // Already fulfilled (redirect won the race)
    const existing = await getPurchaseByPaymentReference(ref);
    if (existing) {
      console.log("[KPay Webhook] Already purchased", existing.order_reference);
      await deletePendingPayment(ref);
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "already_purchased",
        code: 10000,
      });
    }

    const pending = await getPendingPayment(ref);
    if (!pending) {
      console.warn(
        "[KPay Webhook] No pending cart for",
        ref,
        "— ensure pending_kpay_payments table + service role on Vercel"
      );
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "no_pending",
      });
    }

    if (pending.status === "paid") {
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "already_paid",
        code: 10000,
      });
    }

    await markPendingPaid(ref);

    const result = await processSuccessfulPurchase(
      pending.cart,
      paymentId || ref
    );

    if (result.success) {
      await deletePendingPayment(ref);
      console.log("[KPay Webhook] Purchase processed", result.orderReference);
    } else {
      console.error(
        "[KPay Webhook] processSuccessfulPurchase failed:",
        result.error
      );
    }

    return NextResponse.json({
      received: true,
      processed: result.success,
      orderReference: result.orderReference,
      code: 10000,
    });
  } catch (error) {
    console.error("[KPay Webhook] Error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "kpay-webhook",
    hint: "KPay POSTs payment notifications here",
  });
}
