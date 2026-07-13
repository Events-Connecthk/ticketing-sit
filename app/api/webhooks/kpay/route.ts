import { NextRequest, NextResponse } from "next/server";
import { verifyKpayWebhook } from "@/lib/integrations/kpay";
import { processSuccessfulPurchase } from "@/lib/integrations/order.service";
import {
  getPendingPayment,
  getPendingByManagedOrderNo,
  markPendingPaid,
  deletePendingPayment,
  recordWebhookPaid,
} from "@/lib/integrations/pending-payments";
import { getPurchaseByPaymentReference } from "@/lib/db/purchases";

/**
 * KPay async notification (webhook)
 * notifyUrl: https://ticketing-sit.connecthk.org/api/webhooks/kpay
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractSignature(request: NextRequest, body: any): string {
  return (
    request.headers.get("K-Signature") ||
    request.headers.get("k-signature") ||
    request.headers.get("x-kpay-signature") ||
    request.headers.get("x-signature") ||
    body?.signature ||
    body?.sign ||
    body?.data?.signature ||
    ""
  );
}

function pickStr(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return undefined;
}

/**
 * Official notify fields (All Hosted):
 *   managedOutTradeNo — merchant session (our SIT…)
 *   managedOrderNo    — KPay hosted order no
 *   outTradeNo        — merchant payment order no (may differ)
 *   orderNo           — KPay payment order no
 *   transactionState  — 2 success, 5 cancel, …
 */
function extractPaymentFields(body: any): {
  managedOutTradeNo?: string;
  managedOrderNo?: string;
  outTradeNo?: string;
  orderNo?: string;
  status?: string;
  success: boolean;
  failed: boolean;
} {
  const data =
    body?.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? body.data
      : {};
  const root = body && typeof body === "object" ? body : {};

  // KPay package note: callback may use managedMerchantOrderNo (= create managedOutTradeNo)
  const managedOutTradeNo = pickStr(
    data.managedOutTradeNo,
    root.managedOutTradeNo,
    data.managedMerchantOrderNo,
    root.managedMerchantOrderNo,
    data.managed_out_trade_no,
    root.managed_out_trade_no,
    data.managed_merchant_order_no,
    root.managed_merchant_order_no
  );
  const managedOrderNo = pickStr(
    data.managedOrderNo,
    root.managedOrderNo,
    data.managed_order_no,
    root.managed_order_no
  );
  const outTradeNo = pickStr(
    data.outTradeNo,
    root.outTradeNo,
    data.out_trade_no,
    root.out_trade_no
  );
  const orderNo = pickStr(
    data.orderNo,
    root.orderNo,
    data.order_no,
    root.order_no
  );

  const txState = Number(
    data.transactionState ??
      root.transactionState ??
      data.result ??
      root.result ??
      NaN
  );
  const status = String(
    data.transactionStateDesc ||
      root.transactionStateDesc ||
      data.status ||
      root.eventType ||
      root.type ||
      txState ||
      ""
  );

  const success = txState === 2;
  const failed = txState === 3 || txState === 5 || txState === 4;

  return {
    managedOutTradeNo,
    managedOrderNo,
    outTradeNo,
    orderNo,
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
    const timestamp =
      request.headers.get("K-Timestamp") ||
      request.headers.get("k-timestamp") ||
      "";
    const nonce =
      request.headers.get("K-Nonce-Str") ||
      request.headers.get("k-nonce-str") ||
      "";
    const pathWithQuery =
      `${request.nextUrl?.pathname || "/api/webhooks/kpay"}${request.nextUrl?.search || ""}` ||
      "/api/webhooks/kpay";

    console.log("[KPay Webhook] Received", {
      hasSignature: Boolean(signature),
      type: body?.type || body?.eventType,
      keys: Object.keys(body || {}),
      dataKeys:
        body?.data && typeof body.data === "object"
          ? Object.keys(body.data)
          : [],
      pathWithQuery,
      hasTimestamp: Boolean(timestamp),
      hasNonce: Boolean(nonce),
      rawPreview: rawText?.slice(0, 400),
    });

    const valid = await verifyKpayWebhook(body, signature, {
      rawBody: rawText,
      method: "POST",
      pathWithQuery,
      timestamp,
      nonce,
      merchantCode: pickStr(body?.merchantCode, body?.data?.merchantCode),
    });
    if (!valid) {
      console.warn("[KPay Webhook] Invalid signature — rejecting");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const fields = extractPaymentFields(body);
    const {
      managedOutTradeNo,
      managedOrderNo,
      outTradeNo,
      orderNo,
      success,
      failed,
      status,
    } = fields;

    // Resolve our checkout session (SIT…) — never use KPay orderNo alone as cart key
    let pending =
      (managedOutTradeNo
        ? await getPendingPayment(managedOutTradeNo)
        : null) ||
      (outTradeNo ? await getPendingPayment(outTradeNo) : null) ||
      (managedOrderNo
        ? await getPendingByManagedOrderNo(managedOrderNo)
        : null);

    const sessionId =
      pending?.outTradeNo ||
      managedOutTradeNo ||
      (outTradeNo?.startsWith("SIT") ? outTradeNo : undefined) ||
      undefined;

    console.log("[KPay Webhook] Parsed", {
      managedOutTradeNo,
      managedOrderNo,
      outTradeNo,
      orderNo,
      sessionId: sessionId || null,
      hasPending: Boolean(pending),
      success,
      failed,
      status,
    });

    if (failed || !success) {
      console.log("[KPay Webhook] Non-success notification — acknowledged", {
        status,
        failed,
      });
      return NextResponse.json({
        received: true,
        processed: false,
        reason: failed ? "failed_status" : "not_success",
        code: 10000,
      });
    }

    if (!sessionId && !managedOrderNo && !orderNo) {
      console.warn("[KPay Webhook] Missing order identifiers", {
        bodyPreview: JSON.stringify(body).slice(0, 500),
      });
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "missing_ref",
        code: 10000,
      });
    }

    // Stamp paid on merchant session (and SIT aliases) so return URL can finalize
    if (sessionId) {
      await recordWebhookPaid(sessionId);
    }
    if (managedOutTradeNo && managedOutTradeNo !== sessionId) {
      await recordWebhookPaid(managedOutTradeNo);
    }
    // Also alias managedOrderNo → paid lookup only if we already know the SIT session
    // (avoid orphan paid flags under pure KPay numbers when cart is missing)

    const payRef = sessionId || managedOutTradeNo || outTradeNo || orderNo!;
    const existing = await getPurchaseByPaymentReference(payRef);
    if (existing) {
      console.log("[KPay Webhook] Already purchased", existing.order_reference);
      if (sessionId) await deletePendingPayment(sessionId);
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "already_purchased",
        code: 10000,
      });
    }

    if (!pending && sessionId) {
      pending = await getPendingPayment(sessionId);
    }

    const cart = pending?.cart;
    const hasRealCart = Boolean(
      cart &&
        cart.eventSlug &&
        cart.buyer?.email &&
        (cart.tickets?.length || 0) > 0
    );

    if (!hasRealCart) {
      console.log(
        "[KPay Webhook] Paid recorded; waiting for browser return with cart",
        {
          sessionId: sessionId || null,
          managedOrderNo: managedOrderNo || null,
          payRef,
        }
      );
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "paid_awaiting_return",
        code: 10000,
      });
    }

    if (sessionId) await markPendingPaid(sessionId);

    // Payment reference for DB/tickets: merchant session (SIT…), not KPay orderNo
    const result = await processSuccessfulPurchase(cart!, sessionId || payRef);

    if (result.success) {
      if (sessionId) await deletePendingPayment(sessionId);
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
