/**
 * Check-in / redemption records stored in ticket_breakdown[].redemptions
 * and order-level purchases.redemptions.
 *
 * Legacy: ISO string timestamps only.
 * New: { at, byId?, byName?, remark? }
 */

export type CheckInRecord = {
  at: string;
  byId?: string;
  byName?: string;
  remark?: string;
};

export type RedemptionEntry = string | CheckInRecord;

export function isCheckInRecord(x: unknown): x is CheckInRecord {
  return Boolean(x && typeof x === "object" && typeof (x as any).at === "string");
}

export function redemptionAt(entry: RedemptionEntry | null | undefined): string {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return entry.at || "";
}

export function redemptionByName(entry: RedemptionEntry | null | undefined): string {
  if (!entry || typeof entry === "string") return "";
  return (entry.byName || "").trim();
}

export function redemptionRemark(entry: RedemptionEntry | null | undefined): string {
  if (!entry || typeof entry === "string") return "";
  return (entry.remark || "").trim();
}

export function redemptionCount(
  redemptions: RedemptionEntry[] | null | undefined
): number {
  return Array.isArray(redemptions) ? redemptions.length : 0;
}

export function lastRedemption(
  redemptions: RedemptionEntry[] | null | undefined
): RedemptionEntry | null {
  if (!redemptions?.length) return null;
  return redemptions[redemptions.length - 1] ?? null;
}

/** YYYY-MM-DD of a redemption timestamp in Asia/Hong_Kong. */
export function redemptionHkYmd(
  entry: RedemptionEntry | null | undefined
): string | null {
  const at = redemptionAt(entry);
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" });
}

/** True if this ticket already has a check-in on the given HK calendar day. */
export function hasRedemptionOnDay(
  redemptions: RedemptionEntry[] | null | undefined,
  onYmd: string
): boolean {
  if (!Array.isArray(redemptions) || !onYmd) return false;
  return redemptions.some((r) => redemptionHkYmd(r) === onYmd);
}

export function makeCheckInRecord(opts: {
  byId?: string;
  byName?: string;
  remark?: string;
  at?: string;
}): CheckInRecord {
  const rec: CheckInRecord = {
    at: opts.at || new Date().toISOString(),
  };
  if (opts.byId) rec.byId = opts.byId;
  if (opts.byName?.trim()) rec.byName = opts.byName.trim().slice(0, 80);
  if (opts.remark?.trim()) rec.remark = opts.remark.trim().slice(0, 500);
  return rec;
}
