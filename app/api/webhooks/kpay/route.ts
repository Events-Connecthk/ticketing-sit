import { NextRequest, NextResponse } from "next/server";
import { verifyKpayWebhook } from "@/lib/integrations/kpay";
import { processSuccessfulPurchase } from "@/lib/integrations/order.service";
import {
  getPendingPayment,
  markPendingPaid,
  deletePendingPayment,
  recordWebhookPaid,
} from "@/lib/integrations/pending-payments";
import { getPurchaseByPaymentReference } from "@/lib/db/purchases";

/**
 * KPay async notification (webhook)
 * notifyUrl: https://ticketing-sit.vercel.app/api/webhooks/kpay
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractSignature(request: NextRequest, body: any): string {
  return (
    request.headers.get("x-kpay-signature") ||
    request.headers.get("K-Signature") ||
    request.headers.get("k-signature") ||
    request.headers.get("x-signature") ||
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
  failed: boolean;
} {
  const data = body?.data ?? body ?? {};
  const outTradeNo = String(
    data.outTradeNo ||
      data.out_trade_no ||
      body?.outTradeNo ||
      body?.out_trade_no ||
      data.merchantOrderNo ||
      data.merchant_order_no ||
      ""
  ).trim() || undefined;

  const paymentId = String(
    data.managedOrderNo ||
      data.orderNo ||
      data.order_no ||
      data.paymentId ||
      data.transactionId ||
      data.tradeNo ||
      outTradeNo ||
      ""
  ).trim() || undefined;

  const status = String(
    data.status ||
      data.orderStatus ||
      data.payStatus ||
      data.tradeStatus ||
      body?.status ||
      body?.type ||
      body?.event ||
      ""
  ).toUpperCase();

  const type = String(body?.type || body?.event || body?.notifyType || "").toLowerCase();
  const code = Number(body?.code ?? data?.code);

  const failed =
    type.includes("fail") ||
    type.includes("cancel") ||
    status.includes("FAIL") ||
    status.includes("CANCEL") ||
    status.includes("CLOSE") ||
    status.includes("VOID") ||
    status.includes("REFUND");

  // KPay usually only POSTs notify on success; accept broad success signals
  const success =
    !failed &&
    (type.includes("success") ||
      type.includes("paid") ||
      type.includes("complete") ||
      type.includes("notify") ||
      status.includes("SUCCESS") ||
      status.includes("PAID") ||
      status.includes("COMPLETE") ||
      status.includes("SETTLE") ||
      status === "2" ||
      status === "S" ||
      status === "1" ||
      code === 10000 ||
      data.success === true ||
      body?.success === true ||
      // Notify with an order id and no fail flag → treat as paid
      Boolean(outTradeNo || paymentId));

  return { outTradeNo, paymentId, status, success, failed };
}

export async function POST(request: NextRequest) {
  try {
    const rawText = await request.text();
    let body: any = {};
    try {
      body = rawText ? JSON.parse(rawText) : {};
    } catch {
      body = { raw: rawText?.slice(0, 2000) };
    }

    const signature = extractSignature(request, body);
    console.log("[KPay Webhook] Received", {
      hasSignature: Boolean(signature),
      type: body?.type,
      code: body?.code,
      keys: Object.keys(body || {}),
      dataKeys:
        body?.data && typeof body.data === "object"
          ? Object.keys(body.data)
          : [],
      rawPreview: rawText?.slice(0, 400),
    });

    const valid = await verifyKpayWebhook(body, signature);
    if (!valid) {
      console.warn("[KPay Webhook] Invalid signature — rejecting");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const { outTradeNo, paymentId, success, failed, status } =
      extractPaymentFields(body);

    console.log("[KPay Webhook] Parsed", {
      outTradeNo,
      paymentId,
      success,
      failed,
      status,
    });

    if (failed || !success) {
      console.log("[KPay Webhook] Non-success notification — acknowledged");
      return NextResponse.json({
        received: true,
        processed: false,
        reason: failed ? "failed_status" : "not_success",
        code: 10000,
      });
    }

    const ref = outTradeNo || paymentId;
    if (!ref) {
      console.warn("[KPay Webhook] Missing outTradeNo/paymentId", {
        bodyPreview: JSON.stringify(body).slice(0, 500),
      });
      // Still 200 so KPay stops retrying unusable payloads
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "missing_ref",
        code: 10000,
      });
    }

    // Always stamp paid so browser return can finalize even if cart row was lost
    await recordWebhookPaid(ref);
    if (outTradeNo && paymentId && outTradeNo !== paymentId) {
      await recordWebhookPaid(outTradeNo);
    }

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
    const cart = pending?.cart;
    const hasRealCart = Boolean(
      cart && cart.eventSlug && cart.buyer?.email && (cart.tickets?.length || 0) > 0
    );

    if (!hasRealCart) {
      // Paid flag stored; checkout return will issue tickets with session cart
      console.log(
        "[KPay Webhook] Paid recorded; waiting for browser return with cart",
        ref
      );
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "paid_awaiting_return",
        code: 10000,
      });
    }

    await markPendingPaid(ref);

    const result = await processSuccessfulPurchase(
      cart!,
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
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || null,
    hasServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}
