/**
 * Date-window rules for ticket types (scanner + admin).
 * Dates are calendar days in Asia/Hong_Kong (event is HK-based).
 */

export type TicketValidity = {
  validFrom?: string | null;
  validTo?: string | null;
};

/** YYYY-MM-DD for "today" in Hong Kong */
export function hkTodayYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function normalizeYmd(s?: string | null): string | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  // Accept ISO datetime → date part
  const m = t.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Check if a ticket type is valid for a given calendar day (HK).
 * - No dates set → always valid (date-agnostic ticket)
 * - Only validFrom → valid on/after that day
 * - Only validTo → valid on/before that day
 * - Both → inclusive range
 */
export function isTicketValidOnDate(
  ticket: TicketValidity,
  onYmd: string = hkTodayYmd()
): { ok: true } | { ok: false; reason: string } {
  const from = normalizeYmd(ticket.validFrom);
  const to = normalizeYmd(ticket.validTo);
  const day = normalizeYmd(onYmd) || hkTodayYmd();

  if (from && day < from) {
    return {
      ok: false,
      reason: `Not valid yet (valid from ${from}; today is ${day} HK)`,
    };
  }
  if (to && day > to) {
    return {
      ok: false,
      reason: `Expired / wrong date (valid until ${to}; today is ${day} HK)`,
    };
  }
  return { ok: true };
}

export function formatTicketDateWindow(ticket: TicketValidity): string {
  const from = normalizeYmd(ticket.validFrom);
  const to = normalizeYmd(ticket.validTo);
  if (from && to) {
    if (from === to) return from;
    return `${from} → ${to}`;
  }
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return "any day";
}
