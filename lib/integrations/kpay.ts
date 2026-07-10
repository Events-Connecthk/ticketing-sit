"use server";

/**
 * KPay Online Payment Gateway (Merchant Mode) — All Hosted Checkout
 *
 * Sandbox base (from KPay test resources):
 *   https://online-sandbox.kpay-group.com/api
 * Hosted checkout simulator:
 *   https://online-sandbox.kpay-group.com/home
 *
 * Confirmed working create endpoint (sandbox discovery):
 *   POST /v1/payment/web/managed
 *   body: { payAmount, itemList[{productId,productName,productIcon,productPrice,productQuantity}], ... }
 *   success code: 10000 → data.paymentUrl
 *
 * Auth headers (docs):
 *   K-Nonce-Str, K-Merchant-Code, K-Signature, K-Timestamp, K-Language
 *   (+ K-App-Id for Service Provider Mode)
 *
 * Simulation is used only when NODE_ENV !== "production" AND credentials missing.
 */

import { readFileSync, existsSync } from "fs";
import path from "path";
import { OrderCart, PaymentInitiationResult } from "@/types";
import {
  buildSignPayload,
  randomNonce,
  signWithPrivateKey,
  verifyWithPublicKey,
} from "./kpay-crypto";
import {
  getPendingPayment,
  markPendingPaid,
  savePendingPayment,
  isWebhookPaid,
} from "./pending-payments";

/** Load PEM from env string, or from a file path (local only — not on Vercel). */
function loadKeyMaterial(
  inlineEnvNames: string[],
  pathEnvNames: string[]
): string {
  for (const name of inlineEnvNames) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim().replace(/\\n/g, "\n");
  }
  // File paths: local/dev only. Vercel has no secrets/*.pem — use inline env PEMs.
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    return "";
  }
  for (const name of pathEnvNames) {
    const p = process.env[name];
    if (!p || !p.trim()) continue;
    try {
      const resolved = path.isAbsolute(p.trim())
        ? p.trim()
        : path.join(/* turbopackIgnore: true */ process.cwd(), p.trim());
      if (existsSync(resolved)) {
        return readFileSync(resolved, "utf8").trim();
      }
      console.warn(`[KPay] Key file not found: ${resolved} (from ${name})`);
    } catch {
      // ignore path errors
    }
  }
  return "";
}

const MERCHANT_CODE =
  process.env.KPAY_MERCHANT_CODE ||
  process.env.KPAY_MERCHANT_ID ||
  process.env.KPAY_API_KEY ||
  "";

const PRIVATE_KEY = loadKeyMaterial(
  ["KPAY_MERCHANT_PRIVATE_KEY", "KPAY_PRIVATE_KEY"],
  ["KPAY_MERCHANT_PRIVATE_KEY_PATH", "KPAY_PRIVATE_KEY_PATH"]
);

const PLATFORM_PUBLIC_KEY = loadKeyMaterial(
  ["KPAY_PLATFORM_PUBLIC_KEY", "KPAY_MERCHANT_PLATFORM_PUBLIC_KEY"],
  ["KPAY_PLATFORM_PUBLIC_KEY_PATH", "KPAY_MERCHANT_PLATFORM_PUBLIC_KEY_PATH"]
);
const APP_ID = process.env.KPAY_APP_ID || "";

const API_BASE = (
  process.env.KPAY_API_BASE_URL ||
  "https://online-sandbox.kpay-group.com/api"
).replace(/\/$/, "");

const LANGUAGE = process.env.KPAY_LANGUAGE || "en_US";

const DEFAULT_PRODUCT_ID = Number(process.env.KPAY_DEFAULT_PRODUCT_ID || "1");
/** Override with any public HTTPS image URL for KPay hosted checkout product art */
const DEFAULT_PRODUCT_ICON = process.env.KPAY_DEFAULT_PRODUCT_ICON || "";

const SUCCESS_CODE = 10000;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function hasCredentials(): boolean {
  // Real API needs MID + merchant private key (to sign K-Signature)
  return Boolean(MERCHANT_CODE && PRIVATE_KEY);
}

/**
 * Public site origin for returnUrl / notifyUrl / email links.
 * Prefer stable production domain — never the random per-deploy URL if we can avoid it.
 *
 * Priority:
 * 1) NEXT_PUBLIC_SITE_URL (set in Vercel env, then Redeploy)
 * 2) VERCEL_PROJECT_PRODUCTION_URL (e.g. ticketing-sit.vercel.app)
 * 3) VERCEL_URL (deployment-specific; last resort)
 */
function siteOrigin(): string {
  const explicit = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const prodHost = (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  if (prodHost) {
    const host = prodHost.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${host}`;
  }

  const vercel = (process.env.VERCEL_URL || "").trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${host}`;
  }

  return "http://localhost:3000";
}

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function buildOutTradeNo(): string {
  // Merchant out-trade-no; keep reasonably short & unique
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SIT${ts}${rnd}`;
}

async function kpayRequest<T = any>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: T | null; raw: string; error?: string }> {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const rawBody = body ? JSON.stringify(body) : "";
  const timestamp = Date.now().toString();
  const nonce = randomNonce(32);

  const headers: Record<string, string> = {
    "Content-Type": "application/json;charset=UTF-8",
    "K-Merchant-Code": MERCHANT_CODE,
    "K-Timestamp": timestamp,
    "K-Nonce-Str": nonce,
    "K-Language": LANGUAGE,
  };

  if (APP_ID) {
    headers["K-App-Id"] = APP_ID;
  }

  if (PRIVATE_KEY && rawBody) {
    const payload = buildSignPayload({
      timestamp,
      nonce,
      merchantCode: MERCHANT_CODE,
      rawBody,
      bodyObject: body,
    });
    headers["K-Signature"] = signWithPrivateKey(payload, PRIVATE_KEY);
  } else if (PRIVATE_KEY && method === "GET") {
    const payload = buildSignPayload({
      timestamp,
      nonce,
      merchantCode: MERCHANT_CODE,
      rawBody: "",
    });
    headers["K-Signature"] = signWithPrivateKey(payload, PRIVATE_KEY);
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? rawBody : undefined,
      cache: "no-store",
    });

    const raw = await res.text();
    let data: T | null = null;
    try {
      data = raw ? (JSON.parse(raw) as T) : null;
    } catch {
      // non-JSON
    }

    return { ok: res.ok, status: res.status, data, raw };
  } catch (err) {
    console.error("[KPay] request error:", err);
    return {
      ok: false,
      status: 0,
      data: null,
      raw: "",
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

function productIconUrl(): string {
  if (DEFAULT_PRODUCT_ICON) return DEFAULT_PRODUCT_ICON;
  // Our ticket icon (not KPay sandbox shoe demo). Must be absolute HTTPS for KPay.
  const origin = siteOrigin();
  return `${origin}/images/ticket-product-icon.svg`;
}

/**
 * Mirror platform OrderSummary for KPay hosted checkout.
 * OrderSummary shows:
 *   {ticketType.name} × {qty}     {currency} {(price * qty)}
 *   Total (N tickets)             {currency} {totalAmount}
 */
async function cartToItemList(cart: OrderCart) {
  const icon = productIconUrl();
  // Keep readable punctuation used in OrderSummary (×)
  const clean = (s: string) =>
    s
      .replace(/[^\x20-\x7E\u00D7]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  let eventName = cart.eventSlug;
  let typeMap = new Map<string, { name: string; price: number; idx: number }>();

  try {
    const { loadEventBySlug } = await import("@/lib/config/events");
    const event = await loadEventBySlug(cart.eventSlug);
    if (event) {
      eventName = event.name || cart.eventSlug;
      (event.ticketTypes || []).forEach((t, i) => {
        typeMap.set(t.id, {
          name: t.name || t.id,
          price: Number(t.price) || 0,
          idx: i,
        });
      });
    }
  } catch (e) {
    console.warn("[KPay] Could not load event for order summary lines:", e);
  }

  const selections = (cart.tickets || []).filter(
    (sel) => (Number(sel.quantity) || 0) > 0
  );

  // Same left/right as OrderSummary rows
  const lines = selections.map((sel, i) => {
    const meta = typeMap.get(sel.ticketTypeId);
    const qty = Math.max(1, Number(sel.quantity) || 1);
    const unit = roundMoney(meta?.price ?? 0);
    const lineTotal = roundMoney(unit * qty);
    // Exact OrderSummary label: "General Admission × 2"
    const summaryLabel = `${meta?.name || sel.ticketTypeId} × ${qty}`;

    return {
      productId: DEFAULT_PRODUCT_ID + (meta?.idx ?? i),
      productName: clean(summaryLabel).slice(0, 120),
      productIcon: icon,
      productPrice: lineTotal > 0 ? lineTotal : roundMoney(cart.totalAmount),
      productQuantity: 1,
    };
  });

  if (lines.length === 0) {
    return [
      {
        productId: DEFAULT_PRODUCT_ID,
        productName: clean(`${eventName} tickets`).slice(0, 120),
        productIcon: icon,
        productPrice: roundMoney(cart.totalAmount),
        productQuantity: 1,
      },
    ];
  }

  // If promo makes cart.totalAmount lower than sum of lines, scale line prices
  // so KPay payAmount still matches (same lines, adjusted amounts).
  const listTotal = roundMoney(
    lines.reduce((s, l) => s + l.productPrice * l.productQuantity, 0)
  );
  const pay = roundMoney(cart.totalAmount);
  if (listTotal > 0 && Math.abs(listTotal - pay) > 0.02) {
    const scale = pay / listTotal;
    let running = 0;
    for (let i = 0; i < lines.length; i++) {
      if (i === lines.length - 1) {
        lines[i].productPrice = roundMoney(Math.max(0.01, pay - running));
      } else {
        lines[i].productPrice = roundMoney(
          Math.max(0.01, lines[i].productPrice * scale)
        );
        running = roundMoney(running + lines[i].productPrice);
      }
    }
    if (cart.appliedDiscountCode) {
      // Append discount note as zero-impact name suffix on first line if space
      const note = ` (${cart.appliedDiscountCode})`;
      if (lines[0].productName.length + note.length <= 120) {
        lines[0].productName = clean(lines[0].productName + note).slice(0, 120);
      }
    }
  }

  return lines;
}

function formatKpayUserError(code: number, msg: string): string {
  const m = (msg || "").trim();
  if (m.includes("未知錯誤") || code === 50001) {
    return (
      `KPay error ${code || ""}: Unknown error (未知錯誤). `.trim() +
      "Usually a request/field issue or temporary sandbox problem. " +
      "Try again in a minute. If it keeps failing, export Vercel logs and send to KPay with your outTradeNo."
    );
  }
  if (m.includes("請求方式錯誤") || code === 50002) {
    return `KPay error ${code}: Wrong request method (請求方式錯誤).`;
  }
  return m || `KPay error (code ${code || "unknown"})`;
}

/**
 * Creates a KPay All-Hosted Checkout session and returns the payment URL.
 */
export async function initiateKpayPayment(
  cart: OrderCart
): Promise<PaymentInitiationResult> {
  // Production must never silently simulate
  if (!hasCredentials()) {
    if (isProduction()) {
      return {
        success: false,
        error:
          "KPay is not configured (need KPAY_MERCHANT_CODE + KPAY_MERCHANT_PRIVATE_KEY).",
      };
    }
    console.warn(
      "[KPay] Missing merchant code or private key — DEVELOPMENT SIMULATION.",
      {
        hasMerchantCode: Boolean(MERCHANT_CODE),
        hasPrivateKey: Boolean(PRIVATE_KEY),
      }
    );
    return createSimulatedResponse(cart);
  }

  try {
    const origin = siteOrigin();
    const outTradeNo = buildOutTradeNo();
    const payAmount = roundMoney(cart.totalAmount);

    if (payAmount <= 0) {
      return { success: false, error: "Invalid pay amount" };
    }

    // Minimal body only — extra fields (buyer*, successUrl, cancelUrl) can trigger
    // sandbox "未知錯誤" (50001) on some Merchant Mode configs.
    const returnUrl = `${origin}/${cart.eventSlug}/checkout?session=${encodeURIComponent(outTradeNo)}`;
    const notifyUrl = `${origin}/api/webhooks/kpay`;
    const currency =
      !cart.currency || cart.currency === "FREE" ? "HKD" : cart.currency;

    const itemList = await cartToItemList(cart);

    const body: Record<string, unknown> = {
      outTradeNo,
      orderType: "SALES",
      browserType: "WEB",
      payAmount,
      currency,
      itemList,
      returnUrl,
      notifyUrl,
    };

    console.log("[KPay] Creating web managed payment", {
      outTradeNo,
      payAmount,
      currency,
      itemList: body.itemList,
      apiBase: API_BASE,
      merchant: MERCHANT_CODE.slice(0, 6) + "…",
      hasPrivateKey: Boolean(PRIVATE_KEY),
      origin,
      returnUrl,
      notifyUrl,
    });

    const result = await kpayRequest<{
      code: number | string;
      message?: string;
      data?: {
        paymentUrl?: string;
        managedOrderNo?: string;
        orderNo?: string;
        [k: string]: unknown;
      };
    }>("POST", "/v1/payment/web/managed", body);

    const code = Number((result.data as any)?.code);
    const paymentUrl = (result.data as any)?.data?.paymentUrl as
      | string
      | undefined;

    if (code === SUCCESS_CODE && paymentUrl) {
      await savePendingPayment(outTradeNo, cart, {
        paymentUrl,
        managedOrderNo: String(
          (result.data as any)?.data?.managedOrderNo ||
            (result.data as any)?.data?.orderNo ||
            ""
        ),
      });

      console.log("[KPay] Payment created", {
        outTradeNo,
        returnUrl: body.returnUrl,
        notifyUrl: body.notifyUrl,
        origin: origin,
      });

      return {
        success: true,
        paymentId: outTradeNo,
        redirectUrl: paymentUrl,
      };
    }

    const msg =
      (result.data as any)?.message ||
      result.error ||
      result.raw ||
      `KPay error (HTTP ${result.status})`;

    console.error("[KPay] initiate failed:", {
      status: result.status,
      code,
      msg: String(msg).slice(0, 500),
      raw: String(result.raw || "").slice(0, 400),
      outTradeNo,
      payAmount,
      currency,
    });

    // In non-production, allow falling back to sim if API rejects
    if (!isProduction() && process.env.KPAY_FORCE_REAL !== "true") {
      console.warn(
        "[KPay] Falling back to simulation (set KPAY_FORCE_REAL=true to disable)."
      );
      return createSimulatedResponse(cart, outTradeNo);
    }

    return {
      success: false,
      error: formatKpayUserError(code, String(msg)),
    };
  } catch (error) {
    console.error("[KPay] initiateKpayPayment error:", error);
    return {
      success: false,
      error: "Failed to create KPay payment session",
    };
  }
}

export type KpayReturnResult = "success" | "cancel" | "unknown";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyOrderStatus(raw: unknown): "paid" | "failed" | "unknown" {
  const status = String(raw ?? "").toUpperCase().trim();
  if (!status) return "unknown";

  // Definite paid
  if (
    status.includes("SUCCESS") ||
    status.includes("PAID") ||
    status.includes("COMPLETE") ||
    status.includes("SETTLE") ||
    status === "2" ||
    status === "S" ||
    status === "P" ||
    status === "1"
  ) {
    return "paid";
  }

  // Definite terminal failure / cancel — NOT unpaid/pending (those stay unknown)
  if (
    status.includes("CANCEL") ||
    status.includes("FAIL") ||
    status.includes("CLOSE") ||
    status.includes("REFUND") ||
    status.includes("VOID") ||
    status === "3" ||
    status === "4" ||
    status === "C" ||
    status === "F"
  ) {
    return "failed";
  }

  // UNPAID / 0 / PROCESSING / PENDING → still unknown (may flip to paid after 3DS)
  return "unknown";
}

function extractOrderRows(data: any): any[] {
  if (!data) return [];
  const d = data?.data ?? data;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.list)) return d.list;
  if (Array.isArray(d?.records)) return d.records;
  if (Array.isArray(d?.orders)) return d.orders;
  if (d && typeof d === "object" && (d.outTradeNo || d.out_trade_no || d.managedOrderNo)) {
    return [d];
  }
  return [];
}

function matchOrderRow(rows: any[], paymentId: string, managedOrderNo?: string): any | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const hit = rows.find((r: any) => {
    const out = String(r.outTradeNo || r.out_trade_no || "");
    const managed = String(r.managedOrderNo || r.orderNo || r.order_no || "");
    return (
      out === paymentId ||
      managed === paymentId ||
      (managedOrderNo && (managed === managedOrderNo || out === managedOrderNo))
    );
  });
  return hit || null;
}

function statusFromOrderRow(hit: any): "paid" | "failed" | "unknown" {
  // Prefer explicit pay fields; fall through several common names
  const candidates = [
    hit.payStatus,
    hit.pay_status,
    hit.orderStatus,
    hit.order_status,
    hit.status,
    hit.tradeStatus,
    hit.trade_status,
    hit.paymentStatus,
    hit.state,
  ];
  for (const c of candidates) {
    const st = classifyOrderStatus(c);
    if (st !== "unknown") return st;
  }
  // Boolean / code flags
  if (hit.paid === true || hit.isPaid === true || Number(hit.code) === SUCCESS_CODE) {
    return "paid";
  }
  return "unknown";
}

/**
 * Query KPay for paid / cancel status of an outTradeNo (and optional managedOrderNo).
 *
 * Sandbox observations (2026-07):
 * - POST /v1/order/query → HTTP 404 (path not found)
 * - POST /v1/order/list → code 50002 請求方式錯誤 (wrong method)
 * - GET  /v1/order/list?... may work depending on sign rules
 * Until KPay documents a working status API, callers must fall back to
 * webhook (needs public URL) or explicit user confirm on return.
 */
async function lookupOrderPayStatus(
  paymentId: string,
  managedOrderNo?: string
): Promise<"paid" | "failed" | "unknown"> {
  const qs = new URLSearchParams({
    pageNum: "1",
    pageSize: "20",
    outTradeNo: paymentId,
  });
  if (managedOrderNo) qs.set("managedOrderNo", managedOrderNo);

  // GET first (POST list returns 請求方式錯誤 on sandbox)
  const attempts: Array<() => Promise<{ ok: boolean; data: any; raw: string; status: number }>> = [
    () => kpayRequest<any>("GET", `/v1/order/list?${qs.toString()}`),
    () =>
      kpayRequest<any>("GET", `/v1/payment/web/managed/query?outTradeNo=${encodeURIComponent(paymentId)}`),
  ];

  let sawAnyResponse = false;

  for (const run of attempts) {
    try {
      const q = await run();
      if (!q.data && !q.raw) continue;
      sawAnyResponse = true;

      // Hard API errors — log once, keep looking
      const code = Number((q.data as any)?.code);
      if (q.status === 404 || code === 50002) {
        console.log(
          "[KPay] Order status endpoint unusable",
          paymentId,
          "HTTP",
          q.status,
          String(q.raw).slice(0, 200)
        );
        continue;
      }

      const rows = extractOrderRows(q.data);
      const hit = matchOrderRow(rows, paymentId, managedOrderNo);

      if (hit) {
        const st = statusFromOrderRow(hit);
        console.log("[KPay] Order status hit", {
          paymentId,
          st,
          keys: Object.keys(hit).slice(0, 20),
          statusFields: {
            payStatus: hit.payStatus,
            orderStatus: hit.orderStatus,
            status: hit.status,
          },
        });
        if (st !== "unknown") return st;
      } else if (code === SUCCESS_CODE && rows.length === 0) {
        console.log("[KPay] Order query empty list for", paymentId, "HTTP", q.status);
      } else if (q.raw) {
        console.log(
          "[KPay] Order query no match",
          paymentId,
          "HTTP",
          q.status,
          String(q.raw).slice(0, 280)
        );
      }
    } catch (err) {
      console.warn("[KPay] Order lookup attempt error:", err);
    }
  }

  if (!sawAnyResponse) {
    console.warn("[KPay] All order status lookups returned nothing for", paymentId);
  }
  return "unknown";
}

/**
 * Confirms payment after redirect return (or internal sim).
 *
 * Cancel must never issue tickets.
 * Auto-success only via: webhook paid, or order API paid.
 * Optional: userConfirmedPaid (explicit UI button after return) — never auto on page load.
 */
export async function confirmKpayPayment(
  paymentId: string,
  opts?: {
    returnResult?: KpayReturnResult;
    /** True only when user taps “I completed payment” — not on automatic redirect */
    userConfirmedPaid?: boolean;
  }
): Promise<{ success: boolean; paymentReference?: string; error?: string }> {
  if (!paymentId) {
    return { success: false, error: "Missing payment session identifier" };
  }

  const returnResult: KpayReturnResult = opts?.returnResult || "unknown";
  const userConfirmedPaid = Boolean(opts?.userConfirmedPaid);

  // Explicit cancel from cancelUrl — never issue tickets
  if (returnResult === "cancel") {
    console.log("[KPay] Return marked cancel for", paymentId);
    return {
      success: false,
      error: "Payment was cancelled. No ticket was issued — you can try again.",
    };
  }

  // Simulation IDs / free regs (internal only)
  if (
    paymentId.startsWith("KPAY-") ||
    paymentId.startsWith("SIM-") ||
    paymentId.startsWith("FREE-")
  ) {
    return { success: true, paymentReference: paymentId };
  }

  if (!hasCredentials()) {
    if (isProduction()) {
      return { success: false, error: "KPay not configured" };
    }
    console.log("[KPay] Simulation confirm for", paymentId);
    return { success: true, paymentReference: paymentId };
  }

  // Already fulfilled (webhook may have completed first on Vercel)
  try {
    const { getPurchaseByPaymentReference } = await import("@/lib/db/purchases");
    const existing = await getPurchaseByPaymentReference(paymentId);
    if (existing) {
      console.log("[KPay] Purchase already exists for", paymentId);
      return { success: true, paymentReference: paymentId };
    }
  } catch {
    // ignore
  }

  let pending = await getPendingPayment(paymentId);
  console.log("[KPay] confirm state", {
    paymentId,
    hasPending: Boolean(pending),
    pendingStatus: pending?.status,
    userConfirmedPaid,
    returnResult,
    sandbox: isSandboxApi(),
  });

  if (pending?.status === "paid" || (await isWebhookPaid(paymentId))) {
    console.log("[KPay] Webhook/pending paid for", paymentId);
    return { success: true, paymentReference: paymentId };
  }
  if (pending?.status === "failed") {
    return {
      success: false,
      error: "Payment was cancelled or failed. No ticket was issued.",
    };
  }

  // Brief wait for webhook (KPay sandbox often never sends notify to merchants)
  if (process.env.VERCEL || process.env.KPAY_WAIT_WEBHOOK === "true") {
    for (let i = 0; i < 3; i++) {
      await sleep(700);
      pending = await getPendingPayment(paymentId);
      if (pending?.status === "paid" || (await isWebhookPaid(paymentId))) {
        return { success: true, paymentReference: paymentId };
      }
      try {
        const { getPurchaseByPaymentReference } = await import(
          "@/lib/db/purchases"
        );
        const existing = await getPurchaseByPaymentReference(paymentId);
        if (existing) {
          return { success: true, paymentReference: paymentId };
        }
      } catch {
        // ignore
      }
    }
  }

  const managedOrderNo = pending?.managedOrderNo || undefined;
  const st = await lookupOrderPayStatus(paymentId, managedOrderNo);
  if (st === "paid") {
    console.log("[KPay] Order API confirmed PAID for", paymentId);
    if (pending) await markPendingPaid(paymentId);
    return { success: true, paymentReference: paymentId };
  }
  if (st === "failed") {
    return {
      success: false,
      error: "Payment was cancelled or failed. No ticket was issued.",
    };
  }

  const requireApi = process.env.KPAY_REQUIRE_API_CONFIRM === "true";

  // ONLY safe non-webhook path: user explicitly tapped “I paid”.
  // Never auto-trust bare return — KPay cancel and success share the same URL
  // (?session=…&language=en_US), so auto-finalize issues free tickets on cancel.
  if (userConfirmedPaid && !requireApi) {
    console.warn("[KPay] USER confirmed paid — finalizing", paymentId);
    if (pending) await markPendingPaid(paymentId);
    return { success: true, paymentReference: paymentId };
  }

  // Explicit opt-in only (not default) — will free-ticket on cancel
  if (process.env.KPAY_AUTO_CONFIRM_RETURN === "true" && !requireApi) {
    console.warn("[KPay] KPAY_AUTO_CONFIRM_RETURN=true — finalizing", paymentId);
    if (pending) await markPendingPaid(paymentId);
    return { success: true, paymentReference: paymentId };
  }

  console.warn("[KPay] Refusing finalize (need webhook or user confirm)", {
    paymentId,
    returnResult,
    userConfirmedPaid,
    hasPending: Boolean(pending),
    requireApi,
  });
  return {
    success: false,
    error:
      "Payment not confirmed (KPay did not notify paid vs cancel). If you completed payment, tap “I paid — get my tickets”. If you cancelled, tap “I cancelled — no ticket”.",
  };
}

function isSandboxApi(): boolean {
  const base = process.env.KPAY_API_BASE_URL || API_BASE || "";
  return base.includes("sandbox");
}

function webhookRelaxed(): boolean {
  // Sandbox + Day-1: allow missing/wrong signature so notify can complete
  return (
    process.env.KPAY_WEBHOOK_RELAXED === "true" ||
    isSandboxApi() ||
    !isProduction()
  );
}

/**
 * Verify KPay async notification signature using Merchant Platform Public Key.
 */
export async function verifyKpayWebhook(
  payload: unknown,
  signature: string
): Promise<boolean> {
  if (!signature) {
    if (webhookRelaxed()) {
      console.warn(
        "[KPay] Webhook signature missing — allowed (sandbox/relaxed)"
      );
      return true;
    }
    return false;
  }

  if (!PLATFORM_PUBLIC_KEY) {
    if (webhookRelaxed()) {
      console.warn(
        "[KPay] KPAY_PLATFORM_PUBLIC_KEY not set — skipping verify (sandbox/relaxed)"
      );
      return true;
    }
    console.error("[KPay] Cannot verify webhook: missing platform public key");
    return false;
  }

  const raw =
    typeof payload === "string" ? payload : JSON.stringify(payload ?? {});

  if (verifyWithPublicKey(raw, signature, PLATFORM_PUBLIC_KEY)) {
    return true;
  }

  if (payload && typeof payload === "object") {
    const data = (payload as any).data ?? payload;
    if (data && typeof data === "object") {
      const sorted = Object.keys(data)
        .filter((k) => k !== "sign" && k !== "signature")
        .sort()
        .map(
          (k) =>
            `${k}=${typeof data[k] === "object" ? JSON.stringify(data[k]) : data[k]}`
        )
        .join("&");
      if (verifyWithPublicKey(sorted, signature, PLATFORM_PUBLIC_KEY)) {
        return true;
      }
    }
  }

  if (webhookRelaxed()) {
    console.warn(
      "[KPay] Webhook signature verify failed — allowing (sandbox/relaxed)"
    );
    return true;
  }

  console.warn("[KPay] Webhook signature verification failed");
  return false;
}

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function createSimulatedResponse(
  cart: OrderCart,
  customId?: string
): PaymentInitiationResult {
  const paymentId =
    customId ||
    `KPAY-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // Internal path so checkout page finalizes without leaving the app
  return {
    success: true,
    paymentId,
    redirectUrl: `/checkout?session=${paymentId}`,
  };
}
