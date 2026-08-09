/**
 * Inventory helpers:
 * - Per-ticket-type caps (TicketType.quantityAvailable)
 * - Shared day seating (EventConfig.seatDays) — multi-day tickets deduct from each day they cover
 */

import type { SeatDayCapacity, TicketSelection, TicketType } from "@/types";

/** Show "Limited available" at or below this remaining count */
export const LIMITED_STOCK_THRESHOLD = 50;

export type StockLevel = "unlimited" | "ok" | "limited" | "sold_out";

export function getStockLevel(remaining: number | null): StockLevel {
  if (remaining === null) return "unlimited";
  if (remaining <= 0) return "sold_out";
  if (remaining <= LIMITED_STOCK_THRESHOLD) return "limited";
  return "ok";
}

/** Max qty user may select for one type this order */
export function getMaxSelectable(
  ticket: TicketType,
  remaining: number | null
): number {
  const perOrder = Math.max(1, Number(ticket.maxPerOrder) || 6);
  if (remaining === null) return perOrder;
  return Math.max(0, Math.min(perOrder, remaining));
}

/** Remaining stock by ticket type only; null = unlimited (no capacity set) */
export function getRemaining(
  ticket: TicketType,
  soldByType: Record<string, number>
): number | null {
  const cap = ticket.quantityAvailable;
  if (cap == null || cap === undefined || Number.isNaN(Number(cap))) {
    return null;
  }
  const sold = soldByType[ticket.id] || 0;
  return Math.max(0, Number(cap) - sold);
}

/**
 * YYYY-MM-DD list covered by a ticket.
 * Prefer explicit coveredDays (subset of event days); else validFrom/validTo range.
 * No coverage set → full-event pass (all seat days).
 */
export function daysCoveredByTicket(
  ticket: TicketType,
  seatDayDates: string[]
): string[] {
  if (!seatDayDates.length) return [];
  const sorted = [...seatDayDates].sort();
  const explicit = (ticket.coveredDays || [])
    .map((d) => String(d).slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (explicit.length > 0) {
    const allowed = new Set(sorted);
    return [...new Set(explicit.filter((d) => allowed.has(d)))].sort();
  }
  const from = ticket.validFrom || ticket.validTo;
  const to = ticket.validTo || ticket.validFrom;
  // No dates → full-event pass: occupies every seat day
  if (!from && !to) return sorted;
  const start = from || sorted[0];
  const end = to || from || sorted[sorted.length - 1];
  return sorted.filter((d) => d >= start && d <= end);
}

/** Count sold tickets per type from purchase rows */
export function countSoldByTicketType(
  purchases: Array<{
    ticket_breakdown?: Array<{ ticketTypeId?: string; quantity?: number }>;
    number_of_tickets?: number;
  }>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of purchases || []) {
    const rows = p.ticket_breakdown || [];
    if (rows.length === 0) continue;
    for (const row of rows) {
      const id = row.ticketTypeId;
      if (!id) continue;
      const q = Math.max(1, Number(row.quantity) || 1);
      counts[id] = (counts[id] || 0) + q;
    }
  }
  return counts;
}

/**
 * Seats used per event day from purchases, using each type's validity window.
 * Multi-day tickets count 1 seat on every day they cover.
 */
export function countSoldBySeatDay(
  purchases: Array<{
    ticket_breakdown?: Array<{ ticketTypeId?: string; quantity?: number }>;
  }>,
  ticketTypes: TicketType[],
  seatDays: SeatDayCapacity[] | undefined
): Record<string, number> {
  const seatDates = (seatDays || []).map((s) => s.date).filter(Boolean);
  if (!seatDates.length) return {};
  const typeMap = new Map(ticketTypes.map((t) => [t.id, t]));
  const byDay: Record<string, number> = {};
  for (const d of seatDates) byDay[d] = 0;

  for (const p of purchases || []) {
    for (const row of p.ticket_breakdown || []) {
      const id = row.ticketTypeId;
      if (!id) continue;
      const tt = typeMap.get(id);
      if (!tt) continue;
      const q = Math.max(1, Number(row.quantity) || 1);
      for (const day of daysCoveredByTicket(tt, seatDates)) {
        byDay[day] = (byDay[day] || 0) + q;
      }
    }
  }
  return byDay;
}

/**
 * Seats taken in the cart per event day (all ticket types in cart).
 * Multi-day lines add their qty to every day they cover.
 */
export function cartUseByDay(
  cart: TicketSelection[],
  allTypes: TicketType[],
  seatDayDates: string[]
): Record<string, number> {
  const typeMap = new Map(allTypes.map((t) => [t.id, t]));
  const use: Record<string, number> = {};
  for (const sel of cart || []) {
    const tt = typeMap.get(sel.ticketTypeId);
    if (!tt) continue;
    const q = Math.max(0, Math.floor(Number(sel.quantity) || 0));
    if (q <= 0) continue;
    for (const day of daysCoveredByTicket(tt, seatDayDates)) {
      use[day] = (use[day] || 0) + q;
    }
  }
  return use;
}

/**
 * Max quantity of `ticket` that can be in the cart (absolute, not "more").
 * Shared day pool: every cart line (including other types) that covers a day
 * reduces that day's free seats. Multi-day tickets therefore lower Day 1 / Day 2
 * availability on those cards too.
 *
 * null = unlimited on all axes
 */
export function getRemainingCombined(
  ticket: TicketType,
  soldByType: Record<string, number>,
  soldByDay: Record<string, number>,
  seatDays: SeatDayCapacity[] | undefined,
  cart: TicketSelection[] = [],
  allTypes: TicketType[] = []
): number | null {
  const typeRem = getRemaining(ticket, soldByType);

  const seatDates = (seatDays || [])
    .map((s) => String(s.date || "").slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const capByDay = new Map(
    (seatDays || []).map((s) => [
      String(s.date || "").slice(0, 10),
      Math.max(0, Number(s.capacity) || 0),
    ])
  );

  if (!seatDates.length || !capByDay.size) {
    // No shared day pool: only per-type stock, minus this type already in cart
    if (typeRem === null) return null;
    const own = Math.max(
      0,
      Number(
        cart.find((c) => c.ticketTypeId === ticket.id)?.quantity || 0
      )
    );
    // Return absolute max for this type (sold already in typeRem)
    return typeRem + own;
  }

  const covered = daysCoveredByTicket(ticket, seatDates);
  if (covered.length === 0) {
    if (typeRem === null) return null;
    const own = Math.max(
      0,
      Number(
        cart.find((c) => c.ticketTypeId === ticket.id)?.quantity || 0
      )
    );
    return typeRem + own;
  }

  const cartDay = cartUseByDay(cart, allTypes, seatDates);
  const ownQty = Math.max(
    0,
    Math.floor(
      Number(cart.find((c) => c.ticketTypeId === ticket.id)?.quantity || 0)
    )
  );

  // Free seats per day AFTER full cart, then add back this type's own use so
  // result is "max total qty of this type allowed" (not "how many more").
  let seatMax = Infinity;
  for (const day of covered) {
    const cap = capByDay.get(day);
    if (cap == null) continue;
    const sold = soldByDay[day] || 0;
    const inCart = cartDay[day] || 0;
    // Own contribution on this day (only if this type covers it — it does)
    const freeAfterOthers = Math.max(0, cap - sold - inCart + ownQty);
    seatMax = Math.min(seatMax, freeAfterOthers);
  }

  if (!Number.isFinite(seatMax)) {
    if (typeRem === null) return null;
    return typeRem + ownQty;
  }

  // Type stock: remaining inventory for this type + already in cart = absolute max
  let typeMax = Infinity;
  if (typeRem !== null) {
    typeMax = typeRem + ownQty;
  }

  return Math.max(0, Math.min(seatMax, typeMax));
}
