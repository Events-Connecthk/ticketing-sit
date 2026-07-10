/**
 * Hong Kong time helpers.
 * Storage stays UTC ISO in the DB; display/business "today" use Asia/Hong_Kong.
 */

export const HK_TZ = "Asia/Hong_Kong";

/** Format ISO/date for UI in Hong Kong time. */
export function formatHkDateTime(
  input: string | Date | null | undefined,
  opts?: Intl.DateTimeFormatOptions
): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-HK", {
    timeZone: HK_TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: opts?.second !== undefined ? opts.second : undefined,
    hour12: false,
    ...opts,
  });
}

export function formatHkTime(
  input: string | Date | null | undefined
): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-HK", {
    timeZone: HK_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatHkDate(
  input: string | Date | null | undefined
): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-HK", {
    timeZone: HK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** YYYY-MM-DD in Hong Kong (for early-bird / sales cutoffs). */
export function hkTodayYmd(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: HK_TZ }); // en-CA → YYYY-MM-DD
}
