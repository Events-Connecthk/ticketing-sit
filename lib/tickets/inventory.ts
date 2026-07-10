/**
 * Per-ticket-type inventory helpers.
 * Capacity lives on TicketType.quantityAvailable (optional).
 * Sold counts come from purchases.ticket_breakdown.
 */

import { TicketType } from "@/types";

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

/** Remaining stock; null = unlimited (no capacity set) */
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
