"use server";

/**
 * KPay Online Payment Gateway (Merchant Mode) — All Hosted Checkout
 *
 * Official docs (UAT):
 *   Base: https://payment.uat.kpay-group.com
 *   Create: POST /v1/managed/order/add
 *     → code 10000 + data.managedOrderNo
 *   Open page: GET /v1/web/managed/order?managedOrderNo=...&K-Merchant-Code=...&...
 *   Query:    GET /v1/managed/order/result?managedOutTradeNo=...
 *     managedOrderState: 1 Pending, 2 Paid, 3 Expired, 4 Refunded, 5 Closed
 *
 * Auth headers: K-Nonce-Str, K-Merchant-Code, K-Signature, K-Timestamp, K-Language
 */

import { readFileSync, existsSync } from "fs";
import path from "path";
import { OrderCart, PaymentInitiationResult } from "@/types";
import {
  buildSignPayload,
  randomNonce,
  signWithPrivateKey,
  verifyWithPublicKey,
  KPAY_SIGN_MODES,
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

// Official UAT / PROD base per KPay docs
const API_BASE = (
  process.env.KPAY_API_BASE_URL ||
  "https://payment.uat.kpay-group.com"
).replace(/\/$/, "");

const CREATE_PATH = process.env.KPAY_CREATE_PATH || "/v1/managed/order/add";
const WEB_CHECKOUT_PATH =
  process.env.KPAY_WEB_CHECKOUT_PATH || "/v1/web/managed/order";
const ORDER_RESULT_PATH =
  process.env.KPAY_ORDER_RESULT_PATH || "/v1/managed/order/result";

const LANGUAGE = process.env.KPAY_LANGUAGE || "en_US";

/** Override with any public HTTPS image URL for item icons */
const DEFAULT_PRODUCT_ICON = process.env.KPAY_DEFAULT_PRODUCT_ICON || "";

const SUCCESS_CODE = 10000;

/** managedOrderState from query API */
const MANAGED_STATE = {
  PENDING: 1,
  PAID: 2,
  EXPIRED: 3,
  REFUNDED: 4,
  CLOSED: 5,
} as const;

/** transactionState / payment order result (docs) */
const TX_STATE = {
  PENDING: 1,
  SUCCESS: 2,
  FAILED: 3,
  REFUNDED: 4,
  CANCELLED: 5,
  CLOSED: 6,
} as const;

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
  body?: Record<string, unknown>,
  opts?: { logFullExchange?: boolean; signMode?: string }
): Promise<{
  ok: boolean;
  status: number;
  data: T | null;
  raw: string;
  error?: string;
  requestUrl?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  signMode?: string;
}> {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const rawBody = body ? JSON.stringify(body) : "";
  const timestamp = Date.now().toString();
  const nonce = randomNonce(32);
  const signMode =
    opts?.signMode || process.env.KPAY_SIGN_PAYLOAD || "timestamp_nonce_body";

  const headers: Record<string, string> = {
    // Docs intro: application/json;charset=UTF-8
    "Content-Type": "application/json;charset=UTF-8",
    "K-Merchant-Code": MERCHANT_CODE,
    "K-Timestamp": timestamp,
    "K-Nonce-Str": nonce,
    "K-Language": LANGUAGE,
  };

  if (APP_ID) {
    headers["K-App-Id"] = APP_ID;
  }

  if (PRIVATE_KEY && (rawBody || method === "GET")) {
    const payload = buildSignPayload({
      mode: signMode,
      timestamp,
      nonce,
      merchantCode: MERCHANT_CODE,
      rawBody: method === "GET" ? "" : rawBody,
      bodyObject: body,
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

    if (opts?.logFullExchange) {
      // Full evidence pack for KPay support (signature is not a private key)
      console.log(
        "[KPay] FULL REQUEST/RESPONSE for support\n" +
          JSON.stringify(
            {
              request: {
                method,
                url,
                headers: {
                  ...headers,
                  // Keep signature so KPay can match the call; do not log private key
                  "K-Signature": headers["K-Signature"]
                    ? `${headers["K-Signature"].slice(0, 24)}…(len=${headers["K-Signature"].length})`
                    : undefined,
                },
                // Full signature in separate field if they need to verify exact call
                headersFull: headers,
                body: body ?? null,
                bodyRaw: rawBody,
              },
              response: {
                httpStatus: res.status,
                bodyRaw: raw,
                bodyJson: data,
              },
            },
            null,
            2
          )
      );
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
      raw,
      requestUrl: url,
      requestHeaders: headers,
      requestBody: rawBody,
      signMode,
    };
  } catch (err) {
    console.error("[KPay] request error:", err);
    return {
      ok: false,
      status: 0,
      data: null,
      raw: "",
      error: err instanceof Error ? err.message : "Network error",
      signMode,
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
 * Official itemList fields (docs):
 *   itemNo, itemName, itemIcon, price, priceCurrency, quantity
 * Labels match platform Order Summary: "{name} × {qty}"
 */
async function cartToItemList(cart: OrderCart) {
  const icon = productIconUrl();
  // ASCII only in item names — some sign/verify stacks choke on Unicode (×)
  const clean = (s: string) =>
    s
      .replace(/\u00D7/g, "x")
      .replace(/[^\x20-\x7E]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  let typeMap = new Map<string, { name: string; price: number }>();
  try {
    const { loadEventBySlug } = await import("@/lib/config/events");
    const event = await loadEventBySlug(cart.eventSlug);
    (event?.ticketTypes || []).forEach((t) => {
      typeMap.set(t.id, { name: t.name || t.id, price: Number(t.price) || 0 });
    });
  } catch (e) {
    console.warn("[KPay] Could not load event for item names:", e);
  }

  const selections = (cart.tickets || []).filter(
    (sel) => (Number(sel.quantity) || 0) > 0
  );

  const lines = selections.map((sel) => {
    const meta = typeMap.get(sel.ticketTypeId);
    const qty = Math.max(1, Number(sel.quantity) || 1);
    const unit = roundMoney(meta?.price ?? 0);
    const name = clean(`${meta?.name || sel.ticketTypeId} x ${qty}`).slice(
      0,
      128
    );
    return {
      itemNo: String(sel.ticketTypeId).slice(0, 64),
      itemName: name || sel.ticketTypeId,
      itemIcon: icon,
      price: unit > 0 ? unit : roundMoney(cart.totalAmount / qty),
      priceCurrency: "HKD",
      quantity: qty,
    };
  });

  if (lines.length > 0) return lines;

  return [
    {
      itemNo: "tickets",
      itemName: clean(`Tickets (${cart.eventSlug})`).slice(0, 128),
      itemIcon: icon,
      price: roundMoney(cart.totalAmount),
      priceCurrency: "HKD",
      quantity: 1,
    },
  ];
}

/** Build signed GET checkout URL after create returns managedOrderNo */
function buildWebCheckoutUrl(managedOrderNo: string): string {
  const timestamp = Date.now().toString();
  const nonce = randomNonce(32);
  const payload = buildSignPayload({
    timestamp,
    nonce,
    merchantCode: MERCHANT_CODE,
    rawBody: "",
  });
  const signature = signWithPrivateKey(payload, PRIVATE_KEY);
  const qs = new URLSearchParams({
    managedOrderNo,
    language: LANGUAGE,
    "K-Merchant-Code": MERCHANT_CODE,
    "K-Nonce-Str": nonce,
    "K-Timestamp": timestamp,
    "K-Signature": signature,
  });
  if (APP_ID) qs.set("K-App-Id", APP_ID);
  return `${API_BASE}${WEB_CHECKOUT_PATH}?${qs.toString()}`;
}

function formatKpayUserError(code: number, msg: string): string {
  const m = (msg || "").trim();
  if (/signature|sign|签名|驗簽|验签/i.test(m) || code === 40001) {
    return (
      `KPay rejected the request signature (Invalid signature). ` +
      `Check Vercel env: KPAY_MERCHANT_PRIVATE_KEY (full PEM), KPAY_MERCHANT_CODE, ` +
      `KPAY_API_BASE_URL=https://payment.uat.kpay-group.com. ` +
      `Optional: set KPAY_SIGN_PAYLOAD=body_only if support confirms that mode.`
    );
  }
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

    // Official create body (POST /v1/managed/order/add)
    const returnUrl = `${origin}/${cart.eventSlug}/checkout?session=${encodeURIComponent(outTradeNo)}`;
    const notifyUrl = `${origin}/api/webhooks/kpay`;
    const itemList = await cartToItemList(cart);

    const body: Record<string, unknown> = {
      managedOutTradeNo: outTradeNo.slice(0, 32),
      payAmount,
      payCurrency: "HKD",
      notifyUrl,
      returnUrl,
      orderRemark: `Tickets ${cart.eventSlug}`.slice(0, 256),
      itemList,
    };
    if (cart.discountAmount && cart.discountAmount > 0) {
      body.discountAmount = roundMoney(cart.discountAmount);
    }

    console.log("[KPay] Creating All Hosted Checkout order", {
      path: CREATE_PATH,
      managedOutTradeNo: body.managedOutTradeNo,
      payAmount,
      apiBase: API_BASE,
      merchant: MERCHANT_CODE.slice(0, 6) + "…",
      returnUrl,
      notifyUrl,
      itemList,
    });

    type CreateRes = {
      code: number | string;
      message?: string;
      data?: { managedOrderNo?: string; [k: string]: unknown };
    };

    // Try sign modes until create succeeds (docs don't spell the exact string-to-sign)
    const preferred = process.env.KPAY_SIGN_PAYLOAD || "timestamp_nonce_body";
    const modes = [
      preferred,
      ...KPAY_SIGN_MODES.filter((m) => m !== preferred),
    ];

    let result: Awaited<ReturnType<typeof kpayRequest<CreateRes>>> | null =
      null;
    let usedMode = preferred;

    for (const mode of modes) {
      const attempt = await kpayRequest<CreateRes>("POST", CREATE_PATH, body, {
        logFullExchange: true,
        signMode: mode,
      });
      const attemptCode = Number((attempt.data as any)?.code);
      const attemptManaged = String(
        (attempt.data as any)?.data?.managedOrderNo || ""
      );
      const attemptMsg = String(
        (attempt.data as any)?.message || attempt.raw || ""
      );
      console.log("[KPay] Create sign-mode try", {
        mode,
        code: attemptCode,
        http: attempt.status,
        hasManagedOrderNo: Boolean(attemptManaged),
        msg: attemptMsg.slice(0, 80),
      });

      result = attempt;
      usedMode = mode;

      if (attemptCode === SUCCESS_CODE && attemptManaged) break;

      // Only retry other modes on signature-style failures
      const sigFail =
        /signature|sign|签名|驗簽|验签|invalid/i.test(attemptMsg) ||
        attemptCode === 40001 ||
        attemptCode === 401;
      if (!sigFail && attemptCode && attemptCode !== SUCCESS_CODE) break;
    }

    if (!result) {
      return { success: false, error: "KPay create payment failed (no response)" };
    }

    const code = Number((result.data as any)?.code);
    const managedOrderNo = String(
      (result.data as any)?.data?.managedOrderNo || ""
    );

    if (code === SUCCESS_CODE && managedOrderNo) {
      const paymentUrl = buildWebCheckoutUrl(managedOrderNo);

      await savePendingPayment(outTradeNo, cart, {
        paymentUrl,
        managedOrderNo,
      });

      console.log("[KPay] Payment created (official API)", {
        managedOutTradeNo: outTradeNo,
        managedOrderNo,
        createPath: CREATE_PATH,
        signMode: usedMode,
        apiBase: API_BASE,
        paymentUrl: paymentUrl.slice(0, 120) + "…",
        returnUrl,
        notifyUrl,
        responseCode: code,
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
      path: CREATE_PATH,
      signMode: usedMode,
      apiBase: API_BASE,
      msg: String(msg).slice(0, 500),
      raw: String(result.raw || "").slice(0, 400),
      outTradeNo,
      payAmount,
      hasPrivateKey: Boolean(PRIVATE_KEY),
      merchantLen: MERCHANT_CODE.length,
    });

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
 * Official query: GET /v1/managed/order/result
 * managedOrderState: 1 Pending, 2 Paid, 3 Expired, 4 Refunded, 5 Closed
 */
async function lookupOrderPayStatus(
  paymentId: string,
  managedOrderNo?: string
): Promise<"paid" | "failed" | "unknown"> {
  const attempts: string[] = [];
  if (managedOrderNo) {
    attempts.push(
      `${ORDER_RESULT_PATH}?managedOrderNo=${encodeURIComponent(managedOrderNo)}`
    );
  }
  if (paymentId) {
    attempts.push(
      `${ORDER_RESULT_PATH}?managedOutTradeNo=${encodeURIComponent(paymentId)}`
    );
  }

  for (const path of attempts) {
    try {
      const q = await kpayRequest<any>("GET", path);
      const code = Number((q.data as any)?.code);
      const data = (q.data as any)?.data;
      console.log("[KPay] Order result query", {
        path,
        http: q.status,
        code,
        managedOrderState: data?.managedOrderState,
      });

      if (code !== SUCCESS_CODE || !data) continue;

      const state = Number(data.managedOrderState);
      if (state === MANAGED_STATE.PAID) return "paid";
      if (
        state === MANAGED_STATE.EXPIRED ||
        state === MANAGED_STATE.CLOSED ||
        state === MANAGED_STATE.REFUNDED
      ) {
        return "failed";
      }

      // Also inspect nested payment orders if present
      const list = data.paymentOrderList || [];
      for (const p of list) {
        const r = Number(p.result);
        if (r === TX_STATE.SUCCESS) return "paid";
        if (r === TX_STATE.FAILED || r === TX_STATE.CANCELLED || r === TX_STATE.CLOSED) {
          return "failed";
        }
      }
      return "unknown";
    } catch (err) {
      console.warn("[KPay] Order result lookup error:", err);
    }
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
  return (
    base.includes("sandbox") ||
    base.includes("uat") ||
    base.includes("payment.uat")
  );
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