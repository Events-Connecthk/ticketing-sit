/**
 * KPay SHA256-RSA helpers (Merchant Mode) — All Hosted Checkout
 *
 * Official string-to-sign (from KPay minimal module examples):
 *
 *   METHOD\n
 *   URI_WITH_QUERY\n
 *   K-Timestamp\n
 *   K-Nonce-Str\n
 *   K-Merchant-Code\n
 *   [K-App-Id\n]   // only if app id is used (service provider)
 *   BODY\n         // empty string for GET, but trailing newline always kept
 *
 * RSA-SHA256, PKCS#1 v1.5, Base64. K-Signature is never part of the signed text.
 */

import crypto from "crypto";

export function normalizePem(key: string, type: "PRIVATE KEY" | "PUBLIC KEY"): string {
  const trimmed = key.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("BEGIN")) return trimmed;

  // Bare base64 — wrap as PKCS#8 / SPKI PEM
  const body = trimmed.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----`;
}

export function randomNonce(length = 32): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

/**
 * Official KPay signature text (merchant mode).
 * Matches Python `build_signature_text` in KPay examples.
 */
export function buildOfficialSignatureText(opts: {
  method: string;
  /** Path + optional query only (no scheme/host), e.g. /v1/managed/order/add */
  uriWithQuery: string;
  timestamp: string;
  nonce: string;
  merchantCode: string;
  /** Raw body string for POST; empty string for GET */
  body: string;
  appId?: string;
}): string {
  const method = (opts.method || "POST").toUpperCase();
  const lines = [
    method,
    opts.uriWithQuery,
    opts.timestamp,
    opts.nonce,
    opts.merchantCode,
  ];
  if (opts.appId) {
    lines.push(opts.appId);
  }
  lines.push(opts.body ?? "");
  return lines.join("\n") + "\n";
}

/**
 * @deprecated Prefer buildOfficialSignatureText. Kept for env override only.
 */
export function buildSignPayload(opts: {
  mode?: string;
  timestamp: string;
  nonce: string;
  merchantCode: string;
  rawBody: string;
  bodyObject?: Record<string, unknown>;
  method?: string;
  path?: string;
  appId?: string;
}): string {
  const mode = (
    opts.mode ||
    process.env.KPAY_SIGN_PAYLOAD ||
    "official"
  ).toLowerCase();

  // Official KPay format (default)
  if (
    mode === "official" ||
    mode === "method_uri_timestamp_nonce_merchant_body" ||
    mode === "kpay_official"
  ) {
    return buildOfficialSignatureText({
      method: opts.method || "POST",
      uriWithQuery: opts.path || "",
      timestamp: opts.timestamp,
      nonce: opts.nonce,
      merchantCode: opts.merchantCode,
      body: opts.rawBody ?? "",
      appId: opts.appId,
    });
  }

  // Legacy guesses (only if KPAY_SIGN_PAYLOAD is set explicitly)
  if (mode === "body_only") {
    return opts.rawBody;
  }
  if (mode === "concat" || mode === "timestamp_nonce_body_nosep") {
    return `${opts.timestamp}${opts.nonce}${opts.rawBody}`;
  }
  if (mode === "timestamp_nonce_body_crlf") {
    return `${opts.timestamp}\r\n${opts.nonce}\r\n${opts.rawBody}`;
  }
  if (mode === "merchant_timestamp_nonce_body") {
    return `${opts.merchantCode}\n${opts.timestamp}\n${opts.nonce}\n${opts.rawBody}`;
  }
  if (mode === "timestamp_nonce_body") {
    return `${opts.timestamp}\n${opts.nonce}\n${opts.rawBody}`;
  }
  if (mode === "timestamp_nonce_only") {
    return `${opts.timestamp}\n${opts.nonce}\n`;
  }

  // Default to official
  return buildOfficialSignatureText({
    method: opts.method || "POST",
    uriWithQuery: opts.path || "",
    timestamp: opts.timestamp,
    nonce: opts.nonce,
    merchantCode: opts.merchantCode,
    body: opts.rawBody ?? "",
    appId: opts.appId,
  });
}

/** Prefer official only; legacy list only if explicitly needed */
export const KPAY_SIGN_MODES = [
  "official",
  "timestamp_nonce_body",
  "body_only",
  "merchant_timestamp_nonce_body",
] as const;

export function signWithPrivateKey(
  payload: string,
  privateKeyPem: string
): string {
  const key = normalizePem(privateKeyPem, "PRIVATE KEY");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(payload, "utf8");
  signer.end();
  return signer.sign(key, "base64");
}

export function verifyWithPublicKey(
  payload: string,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  try {
    const key = normalizePem(publicKeyPem, "PUBLIC KEY");
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(payload, "utf8");
    verifier.end();
    return verifier.verify(key, signatureBase64, "base64");
  } catch (err) {
    console.error("[KPay Crypto] verify failed:", err);
    return false;
  }
}
