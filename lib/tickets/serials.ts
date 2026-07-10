/**
 * Multi-ticket serials: one payment/order, many scannable ticket IDs.
 *
 * Order ref:  KPY-1783...
 * Ticket IDs: KPY-1783...-001, KPY-1783...-002, ...
 */

import { TicketSelection } from "@/types";

export type TicketUnit = TicketSelection & {
  serial: string;
  quantity: 1;
  redemptions?: string[];
};

/** Expand cart lines into one row per physical ticket with serial. */
export function expandTicketsWithSerials(
  orderReference: string,
  tickets: TicketSelection[]
): TicketUnit[] {
  const units: TicketUnit[] = [];
  let n = 1;
  for (const sel of tickets || []) {
    const qty = Math.max(0, Number(sel.quantity) || 0);
    for (let i = 0; i < qty; i++) {
      units.push({
        ticketTypeId: sel.ticketTypeId,
        quantity: 1,
        serial: `${orderReference}-${String(n).padStart(3, "0")}`,
        redemptions: [],
      });
      n++;
    }
  }
  return units;
}

/** Match order ref, payment ref, or any ticket serial on the purchase. */
export function purchaseMatchesRef(p: {
  order_reference?: string | null;
  payment_reference?: string | null;
  ticket_breakdown?: Array<{ serial?: string }>;
}, ref: string): boolean {
  const r = (ref || "").trim();
  if (!r) return false;
  if (p.order_reference === r || p.payment_reference === r) return true;
  return (p.ticket_breakdown || []).some((t) => t.serial === r);
}

export function findTicketUnit(
  p: {
    ticket_breakdown?: Array<
      TicketSelection & { serial?: string; redemptions?: string[] }
    >;
  },
  serial: string
): TicketUnit | undefined {
  const hit = (p.ticket_breakdown || []).find((t) => t.serial === serial);
  if (!hit?.serial) return undefined;
  return {
    ticketTypeId: hit.ticketTypeId,
    quantity: 1,
    serial: hit.serial,
    redemptions: hit.redemptions || [],
  };
}

/** List serials for admin display. */
export function listSerials(p: {
  order_reference?: string;
  ticket_breakdown?: Array<{ serial?: string; quantity?: number; ticketTypeId?: string }>;
}): string[] {
  const fromUnits = (p.ticket_breakdown || [])
    .map((t) => t.serial)
    .filter((s): s is string => Boolean(s));
  if (fromUnits.length > 0) return fromUnits;

  // Legacy purchases: synthesize serials for display only
  if (!p.order_reference) return [];
  let n = 1;
  const out: string[] = [];
  for (const sel of p.ticket_breakdown || []) {
    const qty = Math.max(1, Number(sel.quantity) || 1);
    for (let i = 0; i < qty; i++) {
      out.push(`${p.order_reference}-${String(n).padStart(3, "0")}`);
      n++;
    }
  }
  return out;
}

export function unitRedemptionCount(unit: { redemptions?: string[]; redeemed_at?: string }): number {
  if (unit.redemptions && unit.redemptions.length > 0) return unit.redemptions.length;
  return 0;
}
