/**
 * KPay SHA256-RSA helpers (Merchant Mode).
 *
 * Spec (from KPay docs email):
 * - REST + JSON
 * - SHA256-RSA asymmetric digital signature
 * - Headers: K-Nonce-Str, K-Merchant-Code, K-Signature, K-Timestamp, K-Language
 * - Keys provided in PKCS#8 format
 *
 * String-to-sign (configurable):
 *   default = `${timestamp}\n${nonce}\n${rawBody}`
 * Adjust KPAY_SIGN_PAYLOAD if KPay support gives a different rule.
 */

import crypto from "crypto";

export function normalizePem(key: string, type: "PRIVATE KEY" | "PUBLIC KEY"): string {
  const trimmed = key.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("BEGIN")) return trimmed;

  // Bare base64 — wrap as PKCS#8 PEM
  const body = trimmed.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----`;
}

export function randomNonce(length = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

/**
 * Build the payload that is RSA-SHA256 signed.
 * Modes (KPay docs vary; we try several on create if needed):
 *  - timestamp_nonce_body (default): timestamp\\nnonce\\nbody
 *  - timestamp_nonce_body_crlf: same with \\r\\n
 *  - body_only: raw JSON body
 *  - concat: timestamp + nonce + body (no separators)
 *  - merchant_timestamp_nonce_body: MID\\ntimestamp\\nnonce\\nbody
 *  - sorted_params: sorted k=v of headers + body fields
 */
export function buildSignPayload(opts: {
  mode?: string;
  timestamp: string;
  nonce: string;
  merchantCode: string;
  rawBody: string;
  bodyObject?: Record<string, unknown>;
}): string {
  const mode = (opts.mode || process.env.KPAY_SIGN_PAYLOAD || "timestamp_nonce_body").toLowerCase();

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

  if (mode === "sorted_params") {
    const map: Record<string, string> = {
      "K-Merchant-Code": opts.merchantCode,
      "K-Nonce-Str": opts.nonce,
      "K-Timestamp": opts.timestamp,
    };
    if (opts.bodyObject) {
      for (const [k, v] of Object.entries(opts.bodyObject)) {
        if (v === undefined || v === null || k === "sign" || k === "signature") continue;
        map[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
      }
    }
    return Object.keys(map)
      .sort()
      .map((k) => `${k}=${map[k]}`)
      .join("&");
  }

  // default: timestamp\nnonce\nbody
  return `${opts.timestamp}\n${opts.nonce}\n${opts.rawBody}`;
}

/** Modes to try when create returns Invalid signature */
export const KPAY_SIGN_MODES = [
  "timestamp_nonce_body",
  "body_only",
  "concat",
  "timestamp_nonce_body_crlf",
  "merchant_timestamp_nonce_body",
  "sorted_params",
] as const;

export function signWithPrivateKey(payload: string, privateKeyPem: string): string {
  const key = normalizePem(privateKeyPem, "PRIVATE KEY");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(payload);
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
    verifier.update(payload);
    verifier.end();
    return verifier.verify(key, signatureBase64, "base64");
  } catch (err) {
    console.error("[KPay Crypto] verify failed:", err);
    return false;
  }
}
