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

/**
 * Official notify payload (docs):
 *   managedOutTradeNo, managedOrderNo, outTradeNo, orderNo
 *   transactionState: 1 Pending, 2 Success, 3 Failed, 4 Refunded, 5 Cancelled
 */
function extractPaymentFields(body: any): {
  outTradeNo?: string;
  paymentId?: string;
  status?: string;
  success: boolean;
  failed: boolean;
} {
  const data = body?.data ?? body ?? {};

  // Prefer merchant managed out-trade-no (our SIT… session id)
  const outTradeNo =
    String(
      data.managedOutTradeNo ||
        body?.managedOutTradeNo ||
        data.outTradeNo ||
        body?.outTradeNo ||
        ""
    ).trim() || undefined;

  const paymentId =
    String(
      data.managedOrderNo ||
        body?.managedOrderNo ||
        data.orderNo ||
        body?.orderNo ||
        outTradeNo ||
        ""
    ).trim() || undefined;

  const txState = Number(
    data.transactionState ?? body?.transactionState ?? data.result ?? NaN
  );
  const status = String(
    data.transactionStateDesc ||
      data.status ||
      body?.eventType ||
      body?.type ||
      txState ||
      ""
  );

  // Docs: 2 = Successfully Processed
  const success = txState === 2;
  // Docs: 3 Failed, 5 Cancelled (and 4 Refunded is not a new paid)
  const failed = txState === 3 || txState === 5 || txState === 4;

  return {
    outTradeNo,
    paymentId,
    status,
    success: success && !failed,
    failed,
  };
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
