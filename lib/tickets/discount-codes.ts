/**
 * Discount / promo code helpers: usage counting, bulk generate, apply checks.
 */

import type { DiscountCode, PurchaseRecord } from "@/types";
import { isDiscountCodeActive } from "@/lib/tickets/validity";

export function normalizePromoCode(code: string): string {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Count purchases that used this code (case-insensitive). */
export function countDiscountCodeUsage(
  purchases: Array<Pick<PurchaseRecord, "applied_discount_code" | "event_slug">>,
  code: string,
  eventSlug?: string
): number {
  const c = normalizePromoCode(code);
  if (!c) return 0;
  return (purchases || []).filter((p) => {
    if (eventSlug && p.event_slug !== eventSlug) return false;
    return normalizePromoCode(p.applied_discount_code || "") === c;
  }).length;
}

export function usageByCode(
  purchases: Array<Pick<PurchaseRecord, "applied_discount_code" | "event_slug">>,
  eventSlug: string
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of purchases || []) {
    if (p.event_slug !== eventSlug) continue;
    const c = normalizePromoCode(p.applied_discount_code || "");
    if (!c) continue;
    out[c] = (out[c] || 0) + 1;
  }
  return out;
}

export type DiscountApplyResult =
  | { ok: true; code: DiscountCode; uses: number }
  | { ok: false; reason: string };

/** Validate code for checkout: exists, enabled, date window, maxUses. */
export function canApplyDiscountCode(
  codes: DiscountCode[] | undefined,
  inputCode: string,
  purchases: Array<Pick<PurchaseRecord, "applied_discount_code" | "event_slug">>,
  eventSlug: string
): DiscountApplyResult {
  const raw = normalizePromoCode(inputCode);
  if (!raw) return { ok: false, reason: "Enter a discount code." };

  const match = (codes || []).find(
    (dc) => normalizePromoCode(dc.code) === raw
  );
  if (!match) return { ok: false, reason: "Invalid discount code." };
  if (match.enabled === false) {
    return { ok: false, reason: "This discount code is no longer available." };
  }

  const active = isDiscountCodeActive(match);
  if (!active.ok) {
    return { ok: false, reason: active.reason || "This discount isn’t available." };
  }

  const uses = countDiscountCodeUsage(purchases, match.code, eventSlug);
  if (
    match.maxUses != null &&
    !Number.isNaN(Number(match.maxUses)) &&
    uses >= Number(match.maxUses)
  ) {
    return {
      ok: false,
      reason: `This code has reached its usage limit (${match.maxUses}).`,
    };
  }

  return { ok: true, code: match, uses };
}

function randomSuffix(len = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

/**
 * Generate unique personalized codes for an event (e.g. influencer batch).
 */
export function generateBulkDiscountCodes(opts: {
  existing: DiscountCode[];
  count: number;
  percent: number;
  maxUses?: number;
  prefix?: string;
  label?: string;
  validFrom?: string;
  validUntil?: string;
  stackable?: boolean;
}): { codes: DiscountCode[]; batchId: string } {
  const count = Math.max(1, Math.min(500, Math.floor(opts.count) || 1));
  const percent = Math.max(0, Math.min(100, Number(opts.percent) || 0));
  const prefix = (opts.prefix || "PROMO")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12) || "PROMO";
  const batchId = `batch_${Date.now().toString(36)}`;
  const used = new Set(
    (opts.existing || []).map((c) => normalizePromoCode(c.code))
  );
  const created: DiscountCode[] = [];

  let guard = 0;
  while (created.length < count && guard < count * 20) {
    guard++;
    const code = `${prefix}-${randomSuffix(6)}`;
    if (used.has(code)) continue;
    used.add(code);
    created.push({
      id: `dc_${Date.now().toString(36)}_${created.length}_${randomSuffix(3)}`,
      code,
      percent,
      maxUses:
        opts.maxUses != null && !Number.isNaN(Number(opts.maxUses))
          ? Math.max(1, Math.floor(Number(opts.maxUses)))
          : 1,
      description: opts.label
        ? `Bulk: ${opts.label}`
        : `Bulk batch ${batchId}`,
      label: opts.label || undefined,
      batchId,
      validFrom: opts.validFrom || undefined,
      validUntil: opts.validUntil || undefined,
      enabled: true,
      stackable: opts.stackable === true,
    });
  }

  return { codes: created, batchId };
}
