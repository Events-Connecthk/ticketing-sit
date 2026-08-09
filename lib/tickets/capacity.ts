/**
 * Event-day capacity model (FR 6.1–6.4).
 *
 * Capacity is per event day (shared). Remaining is always derived:
 *   remaining(day) = capacity(day) - sold(day)
 * Sold = count of valid (issued/paid) tickets whose coverage includes that day.
 * Multi-day tickets deduct 1 seat from each day in coverage (all or nothing).
 */

import type {
  EventConfig,
  PurchaseRecord,
  SeatDayCapacity,
  TicketSelection,
  TicketType,
} from "@/types";
import {
  countSoldBySeatDay,
  countSoldByTicketType,
  daysCoveredByTicket,
  getRemainingCombined,
} from "@/lib/tickets/inventory";

/** Low-stock threshold as fraction of capacity (FR 6.6 proposed 10%). */
export const LOW_STOCK_FRACTION = 0.1;

export type DayCapacityStatus = "ok" | "low" | "sold_out" | "unlimited";

export type DayCapacityRow = {
  date: string;
  capacity: number;
  sold: number;
  remaining: number;
  status: DayCapacityStatus;
  /** Sold per ticket type that touches this day */
  byType: Array<{ typeId: string; name: string; sold: number }>;
};

/** Normalize coverage list from coveredDays or validFrom/validTo. */
export function getTicketCoverage(
  ticket: TicketType,
  seatDays: SeatDayCapacity[] | undefined
): string[] {
  const explicit = (ticket.coveredDays || [])
    .map((d) => String(d).slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (explicit.length > 0) {
    // Intersect with event days when configured
    const allowed = new Set((seatDays || []).map((s) => s.date));
    if (allowed.size === 0) return [...new Set(explicit)].sort();
    return [...new Set(explicit.filter((d) => allowed.has(d)))].sort();
  }
  return daysCoveredByTicket(
    ticket,
    (seatDays || []).map((s) => s.date)
  );
}

export function coverageKey(days: string[] | undefined): string {
  return [...(days || [])].map((d) => d.slice(0, 10)).sort().join(",");
}

/** Valid tickets consume capacity (exclude cancelled/refunded if marked). */
export function isCapacityConsumingPurchase(p: {
  payment_method?: string;
  amount?: number;
  order_reference?: string;
}): boolean {
  const m = String(p.payment_method || "").toLowerCase();
  if (m.includes("cancel") || m.includes("refund") || m === "void") {
    return false;
  }
  return true;
}

export function filterValidPurchases<T extends { payment_method?: string }>(
  purchases: T[]
): T[] {
  return (purchases || []).filter(isCapacityConsumingPurchase);
}

/**
 * Assert cart can be issued against current sold + seat day capacities.
 * Returns null if ok, or an error message.
 */
export function assertCanIssueTickets(
  event: EventConfig,
  tickets: TicketSelection[],
  purchases: PurchaseRecord[]
): string | null {
  const seatDays = event.seatDays || [];
  if (!seatDays.length) {
    // No shared day pool: only per-type stock
    const valid = filterValidPurchases(purchases);
    const soldByType = countSoldByTicketType(valid);
    for (const line of tickets) {
      const tt = event.ticketTypes.find((t) => t.id === line.ticketTypeId);
      if (!tt) return `Unknown ticket type: ${line.ticketTypeId}`;
      if (tt.enabled === false || tt.archived) {
        return `Ticket type "${tt.name}" is not available.`;
      }
      const rem = getRemainingCombined(
        tt,
        soldByType,
        {},
        undefined,
        tickets,
        event.ticketTypes
      );
      // rem excludes this type's cart qty for other lines; recompute simply:
      if (tt.quantityAvailable != null) {
        const sold = soldByType[tt.id] || 0;
        const need = Math.max(0, Number(line.quantity) || 0);
        if (sold + need > Number(tt.quantityAvailable)) {
          return `Not enough stock for "${tt.name}" (${sold} sold, need ${need}, cap ${tt.quantityAvailable}).`;
        }
      }
    }
    return null;
  }

  const valid = filterValidPurchases(purchases);
  const soldByDay = countSoldBySeatDay(
    valid,
    event.ticketTypes,
    seatDays
  );

  // Seats this order needs per day (all lines)
  const needByDay: Record<string, number> = {};
  for (const line of tickets) {
    const tt = event.ticketTypes.find((t) => t.id === line.ticketTypeId);
    if (!tt) return `Unknown ticket type: ${line.ticketTypeId}`;
    if (tt.enabled === false || tt.archived) {
      return `Ticket type "${tt.name}" is not available.`;
    }
    const cov = getTicketCoverage(tt, seatDays);
    if (cov.length === 0) {
      return `Ticket type "${tt.name}" has no event-day coverage. Set covered days.`;
    }
    const q = Math.max(0, Math.floor(Number(line.quantity) || 0));
    for (const day of cov) {
      needByDay[day] = (needByDay[day] || 0) + q;
    }
  }

  // All-or-nothing: every day must have remaining >= need
  for (const [day, need] of Object.entries(needByDay)) {
    const capRow = seatDays.find((s) => s.date === day);
    if (!capRow) {
      return `Day ${day} is not configured on this event.`;
    }
    const sold = soldByDay[day] || 0;
    const remaining = Math.max(0, Number(capRow.capacity) - sold);
    if (need > remaining) {
      return (
        `Not enough seats on ${day}: need ${need}, remaining ${remaining} ` +
        `(capacity ${capRow.capacity}, sold ${sold}). Multi-day tickets need seats on all covered days.`
      );
    }
  }

  // Per-type stock still applies if set
  const soldByType = countSoldByTicketType(valid);
  for (const line of tickets) {
    const tt = event.ticketTypes.find((t) => t.id === line.ticketTypeId)!;
    if (tt.quantityAvailable != null) {
      const sold = soldByType[tt.id] || 0;
      const need = Math.max(0, Number(line.quantity) || 0);
      if (sold + need > Number(tt.quantityAvailable)) {
        return `Not enough stock for "${tt.name}" (type cap ${tt.quantityAvailable}, sold ${sold}).`;
      }
    }
  }

  return null;
}

/**
 * Validate seat day capacity edits (FR 6.1).
 * Increase free; decrease only to >= sold count.
 */
export function validateSeatDayCapacityChanges(
  previous: SeatDayCapacity[] | undefined,
  next: SeatDayCapacity[] | undefined,
  soldByDay: Record<string, number>
): { ok: true } | { ok: false; error: string } {
  const prevMap = new Map((previous || []).map((s) => [s.date, s.capacity]));
  for (const s of next || []) {
    const date = s.date;
    const newCap = Math.max(0, Math.floor(Number(s.capacity) || 0));
    if (newCap < 1 && (soldByDay[date] || 0) === 0) {
      // allow 0 only if nothing sold? FR says positive integer for max capacity
      // Allow 0 for closed days with 0 sold; reject if sold > 0
    }
    if (newCap < 1) {
      return {
        ok: false,
        error: `Capacity for ${date} must be a positive integer (got ${newCap}).`,
      };
    }
    const sold = soldByDay[date] || 0;
    if (newCap < sold) {
      return {
        ok: false,
        error: `Cannot set capacity for ${date} to ${newCap}: already sold ${sold} seats. Minimum allowed is ${sold}.`,
      };
    }
    const oldCap = prevMap.get(date);
    if (oldCap != null && newCap < oldCap && newCap < sold) {
      return {
        ok: false,
        error: `Cannot decrease capacity for ${date} below sold count (${sold}).`,
      };
    }
  }
  // Removing a day that has sales
  for (const [date, sold] of Object.entries(soldByDay)) {
    if (sold <= 0) continue;
    if (!(next || []).some((s) => s.date === date)) {
      return {
        ok: false,
        error: `Cannot remove event day ${date}: ${sold} ticket(s) already sold for that day.`,
      };
    }
  }
  return { ok: true };
}

/**
 * FR 6.2: after tickets sold for a type, day coverage must not change.
 */
export function validateTicketCoverageImmutable(
  previousTypes: TicketType[] | undefined,
  nextTypes: TicketType[] | undefined,
  soldByType: Record<string, number>,
  seatDays: SeatDayCapacity[] | undefined
): { ok: true } | { ok: false; error: string } {
  const prevMap = new Map((previousTypes || []).map((t) => [t.id, t]));
  for (const t of nextTypes || []) {
    const sold = soldByType[t.id] || 0;
    if (sold <= 0) continue;
    const prev = prevMap.get(t.id);
    if (!prev) continue;
    const a = coverageKey(getTicketCoverage(prev, seatDays));
    const b = coverageKey(getTicketCoverage(t, seatDays));
    // Also compare raw coveredDays / validFrom-to
    const rawA = coverageKey(
      prev.coveredDays?.length
        ? prev.coveredDays
        : [prev.validFrom, prev.validTo].filter(Boolean) as string[]
    );
    const rawB = coverageKey(
      t.coveredDays?.length
        ? t.coveredDays
        : [t.validFrom, t.validTo].filter(Boolean) as string[]
    );
    if (a !== b || rawA !== rawB) {
      return {
        ok: false,
        error:
          `Cannot change day coverage for "${t.name}" — ${sold} ticket(s) already sold. ` +
          `Archive this type (disable it) and create a new ticket type instead.`,
      };
    }
  }
  return { ok: true };
}

export function buildCapacityAuditEntries(
  previous: SeatDayCapacity[] | undefined,
  next: SeatDayCapacity[] | undefined,
  actor: string
): Array<{
  at: string;
  actor: string;
  day_date: string;
  old_capacity: number | null;
  new_capacity: number | null;
}> {
  const prevMap = new Map((previous || []).map((s) => [s.date, s.capacity]));
  const nextMap = new Map((next || []).map((s) => [s.date, s.capacity]));
  const dates = new Set([...prevMap.keys(), ...nextMap.keys()]);
  const at = new Date().toISOString();
  const out: Array<{
    at: string;
    actor: string;
    day_date: string;
    old_capacity: number | null;
    new_capacity: number | null;
  }> = [];
  for (const d of dates) {
    const oldC = prevMap.has(d) ? prevMap.get(d)! : null;
    const newC = nextMap.has(d) ? nextMap.get(d)! : null;
    if (oldC === newC) continue;
    out.push({
      at,
      actor,
      day_date: d,
      old_capacity: oldC,
      new_capacity: newC,
    });
  }
  return out;
}

/** Per-day dashboard rows (FR 6.6). */
export function buildDayCapacityRows(
  event: EventConfig,
  purchases: PurchaseRecord[]
): DayCapacityRow[] {
  const seatDays = event.seatDays || [];
  if (!seatDays.length) return [];
  const valid = filterValidPurchases(purchases);
  const soldByDay = countSoldBySeatDay(
    valid,
    event.ticketTypes,
    seatDays
  );
  const soldByType = countSoldByTicketType(valid);

  return seatDays
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((sd) => {
      const sold = soldByDay[sd.date] || 0;
      const capacity = Math.max(0, Number(sd.capacity) || 0);
      const remaining = Math.max(0, capacity - sold);
      let status: DayCapacityStatus = "ok";
      if (remaining <= 0) status = "sold_out";
      else if (capacity > 0 && remaining / capacity <= LOW_STOCK_FRACTION) {
        status = "low";
      }
      const byType = (event.ticketTypes || [])
        .map((tt) => {
          const cov = getTicketCoverage(tt, seatDays);
          if (!cov.includes(sd.date)) return null;
          const n = soldByType[tt.id] || 0;
          if (n <= 0) return null;
          return { typeId: tt.id, name: tt.name, sold: n };
        })
        .filter(Boolean) as Array<{ typeId: string; name: string; sold: number }>;
      return {
        date: sd.date,
        capacity,
        sold,
        remaining,
        status,
        byType,
      };
    });
}
