/**
 * Check-in staff session (separate from full admin).
 * Cookie path covers /check-in only via path preference; server still validates.
 */
import { cookies } from "next/headers";
import crypto from "crypto";
import { safeEqual } from "./admin-session";

export const CHECKIN_COOKIE = "sit_checkin_session";
const MAX_AGE_SEC = 60 * 60 * 12; // 12 hours door shift

function sessionSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.ADMIN_PASSWORD ||
    "dev-only-checkin-session-secret"
  );
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

export type CheckinSession = {
  staffId: string;
  username: string;
  displayName: string;
};

/** Encode display name / username safely in cookie payload */
function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function fromB64url(s: string): string {
  try {
    return Buffer.from(s, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

export async function createCheckinSession(staff: {
  id: string;
  username: string;
  displayName: string;
}): Promise<void> {
  const exp = Date.now() + MAX_AGE_SEC * 1000;
  const payload = [
    "v1",
    staff.id,
    b64url(staff.username),
    b64url(staff.displayName),
    String(exp),
  ].join(".");
  const token = `${payload}.${sign(payload)}`;
  const jar = await cookies();
  jar.set(CHECKIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export async function clearCheckinSession(): Promise<void> {
  const jar = await cookies();
  jar.set(CHECKIN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getCheckinSession(): Promise<CheckinSession | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(CHECKIN_COOKIE)?.value;
    if (!raw) return null;
    const parts = raw.split(".");
    // v1.id.userB64.nameB64.exp.sig  → at least 6 segments if name has no dots in b64
    if (parts.length < 6) return null;
    const version = parts[0];
    const staffId = parts[1];
    const userB64 = parts[2];
    const nameB64 = parts[3];
    const expStr = parts[4];
    const sig = parts.slice(5).join(".");
    if (version !== "v1" || !staffId) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return null;
    const payload = parts.slice(0, 5).join(".");
    if (!safeEqual(sig, sign(payload))) return null;
    return {
      staffId,
      username: fromB64url(userB64),
      displayName: fromB64url(nameB64) || fromB64url(userB64) || "Staff",
    };
  } catch {
    return null;
  }
}

export async function requireCheckinStaff(): Promise<CheckinSession> {
  const s = await getCheckinSession();
  if (!s) throw new Error("UNAUTHORIZED_CHECKIN");
  return s;
}

export function hashCheckinPassword(password: string, salt?: string): string {
  const s =
    salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, s, 32).toString("hex");
  return `${s}:${hash}`;
}

export function verifyCheckinPassword(
  password: string,
  stored: string
): boolean {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const next = crypto.scryptSync(password, salt, 32).toString("hex");
  try {
    return safeEqual(hash, next);
  } catch {
    return false;
  }
}
