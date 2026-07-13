/**
 * Lightweight signed admin session cookie (no NextAuth).
 * Rollback: revert this file + actions that call requireAdmin / loginAdminSession.
 */
import { cookies } from "next/headers";
import crypto from "crypto";

export const ADMIN_COOKIE = "sit_admin_session";
const MAX_AGE_SEC = 60 * 60 * 8; // 8 hours

function sessionSecret(): string {
  const s =
    process.env.ADMIN_SESSION_SECRET ||
    process.env.ADMIN_PASSWORD ||
    "";
  if (!s) {
    // Dev-only fallback; production requireAdmin will fail without ADMIN_PASSWORD
    return "dev-only-admin-session-secret";
  }
  return s;
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

export function getExpectedAdminPassword(): string | null {
  const pwd = (process.env.ADMIN_PASSWORD || "").trim();
  if (pwd) return pwd;
  // Never use NEXT_PUBLIC_* as the real secret
  if (process.env.NODE_ENV !== "production") {
    const dev = (process.env.ADMIN_PASSWORD_DEV || "sit-admin-2026").trim();
    return dev || null;
  }
  return null;
}

/** Constant-time string compare */
export function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) {
      // still do a compare to reduce timing signal on length
      crypto.timingSafeEqual(ba, ba);
      return false;
    }
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export async function createAdminSession(): Promise<void> {
  const exp = Date.now() + MAX_AGE_SEC * 1000;
  const payload = `v1.${exp}`;
  const token = `${payload}.${sign(payload)}`;
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export async function clearAdminSession(): Promise<void> {
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function isAdminSessionValid(): Promise<boolean> {
  try {
    const jar = await cookies();
    const raw = jar.get(ADMIN_COOKIE)?.value;
    if (!raw) return false;
    const parts = raw.split(".");
    // v1.<exp>.<sig>  → 3 parts after split by .
    if (parts.length < 3) return false;
    const version = parts[0];
    const expStr = parts[1];
    const sig = parts.slice(2).join(".");
    if (version !== "v1") return false;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const payload = `v1.${expStr}`;
    const expected = sign(payload);
    return safeEqual(sig, expected);
  } catch {
    return false;
  }
}

/**
 * Call at the start of every privileged admin server action.
 * Throws if not authenticated.
 */
export async function requireAdmin(): Promise<void> {
  const ok = await isAdminSessionValid();
  if (!ok) {
    throw new Error("UNAUTHORIZED_ADMIN");
  }
}
