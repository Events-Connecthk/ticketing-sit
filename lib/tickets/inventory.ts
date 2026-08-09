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
 * Remaining for a ticket type considering:
 * 1) per-type quantityAvailable
 * 2) shared seat-day capacities (min remaining across days this type covers)
 * 3) other tickets already in the cart (shared day pool)
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

  const seatDates = (seatDays || []).map((s) => s.date).filter(Boolean);
  const capByDay = new Map(
    (seatDays || []).map((s) => [s.date, Math.max(0, Number(s.capacity) || 0)])
  );

  if (!seatDates.length || !capByDay.size) {
    return typeRem;
  }

  const typeMap = new Map(allTypes.map((t) => [t.id, t]));
  // Seats reserved by other cart lines (exclude this ticket type)
  const cartDayUse: Record<string, number> = {};
  for (const sel of cart) {
    if (sel.ticketTypeId === ticket.id) continue;
    const tt = typeMap.get(sel.ticketTypeId);
    if (!tt) continue;
    const q = Math.max(0, Number(sel.quantity) || 0);
    if (q <= 0) continue;
    for (const day of daysCoveredByTicket(tt, seatDates)) {
      cartDayUse[day] = (cartDayUse[day] || 0) + q;
    }
  }

  const covered = daysCoveredByTicket(ticket, seatDates);
  if (covered.length === 0) {
    return typeRem;
  }

  let seatRem = Infinity;
  for (const day of covered) {
    const cap = capByDay.get(day);
    if (cap == null) continue;
    const used =
      (soldByDay[day] || 0) + (cartDayUse[day] || 0);
    seatRem = Math.min(seatRem, Math.max(0, cap - used));
  }

  if (!Number.isFinite(seatRem)) {
    return typeRem;
  }

  if (typeRem === null) return seatRem;
  return Math.max(0, Math.min(typeRem, seatRem));
}
