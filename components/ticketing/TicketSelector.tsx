"use client";

import React from "react";
import { TicketType, TicketSelection, SeatDayCapacity } from "@/types";
import { Plus, Minus } from "lucide-react";
import {
  getMaxSelectable,
  getRemainingCombined,
  getStockLevel,
  LIMITED_STOCK_THRESHOLD,
} from "@/lib/tickets/inventory";
import { formatMoney, roundMoney } from "@/lib/money";
import { getEffectivePrice } from "@/lib/config/events";

interface TicketSelectorProps {
  ticketTypes: TicketType[];
  selections: TicketSelection[];
  onChange: (selections: TicketSelection[]) => void;
  currency: string;
  /** Sold counts by ticket type id (from purchases) */
  soldByType?: Record<string, number>;
  /** Sold seats by day YYYY-MM-DD (shared capacity) */
  soldByDay?: Record<string, number>;
  /** Event-level seat day capacities */
  seatDays?: SeatDayCapacity[];
}

/**
 * Reusable ticket selector.
 * Enforces maxPerOrder + per-type + shared day inventory; limited / out of stock labels.
 * Shows regular price with red discount % when type discounts apply.
 */
export function TicketSelector({
  ticketTypes,
  selections,
  onChange,
  currency,
  soldByType = {},
  soldByDay = {},
  seatDays,
}: TicketSelectorProps) {
  const getQuantity = (id: string) =>
    selections.find((s) => s.ticketTypeId === id)?.quantity ?? 0;

  const remainingFor = (ticket: TicketType) =>
    getRemainingCombined(
      ticket,
      soldByType,
      soldByDay,
      seatDays,
      selections,
      ticketTypes
    );

  const updateQuantity = (ticket: TicketType, newQuantity: number) => {
    const remaining = remainingFor(ticket);
    // remaining already excludes this type's cart qty, so max is remaining + current
    const current = getQuantity(ticket.id);
    const effectiveRemaining =
      remaining === null ? null : remaining + current;
    const max = getMaxSelectable(ticket, effectiveRemaining);
    const clamped = Math.max(0, Math.min(newQuantity, max));

    let next = [...selections];
    const existingIndex = next.findIndex((s) => s.ticketTypeId === ticket.id);

    if (clamped === 0) {
      next = next.filter((s) => s.ticketTypeId !== ticket.id);
    } else if (existingIndex >= 0) {
      next[existingIndex] = { ticketTypeId: ticket.id, quantity: clamped };
    } else {
      next.push({ ticketTypeId: ticket.id, quantity: clamped });
    }

    onChange(next);
  };

  const total = roundMoney(
    selections.reduce((sum, sel) => {
      const type = ticketTypes.find((t) => t.id === sel.ticketTypeId);
      if (!type || type.isFree) return sum;
      const eff = getEffectivePrice(type, new Date(), sel.quantity);
      return sum + eff.discounted * sel.quantity;
    }, 0)
  );

  const totalTickets = selections.reduce((s, sel) => s + sel.quantity, 0);

  return (
    <div className="space-y-4">
      {ticketTypes.map((ticket) => {
        const qty = getQuantity(ticket.id);
        const remaining = remainingFor(ticket);
        // remaining is seats left after cart (excluding this type); add back current for display/stock
        const displayRemaining =
          remaining === null ? null : remaining + qty;
        const max = getMaxSelectable(ticket, displayRemaining);
        const level = getStockLevel(displayRemaining);
        const soldOut = level === "sold_out";
        const limited = level === "limited";

        const pricing = getEffectivePrice(ticket, new Date(), Math.max(1, qty || 1));
        const unitOriginal = pricing.original;
        const unitDiscounted = pricing.discounted;
        const hasUnitDiscount =
          !ticket.isFree && unitDiscounted < unitOriginal - 0.001;
        const discountPct =
          hasUnitDiscount && unitOriginal > 0
            ? roundMoney(((unitOriginal - unitDiscounted) / unitOriginal) * 100)
            : 0;
        const lineOriginal = roundMoney(unitOriginal * qty);
        const lineTotal = ticket.isFree
          ? 0
          : roundMoney(unitDiscounted * qty);

        const dateHint =
          ticket.validFrom || ticket.validTo
            ? ticket.validFrom && ticket.validTo
              ? ticket.validFrom === ticket.validTo
                ? ticket.validFrom
                : `${ticket.validFrom} → ${ticket.validTo}`
              : ticket.validFrom
                ? `from ${ticket.validFrom}`
                : `until ${ticket.validTo}`
            : null;

        return (
          <div
            key={ticket.id}
            className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border card p-5 ${
              soldOut ? "opacity-70 bg-zinc-50" : ""
            }`}
            style={{ borderColor: soldOut ? "#D4D4D4" : "#EDE4D3" }}
          >
            <div className="flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <h4 className="font-semibold text-lg">{ticket.name}</h4>
                {ticket.isFree ? (
                  <span className="text-sm" style={{ color: "#6B5E50" }}>
                    Free
                  </span>
                ) : hasUnitDiscount ? (
                  <span className="text-sm flex flex-wrap items-baseline gap-1.5">
                    <span className="line-through text-zinc-400 tabular-nums">
                      {currency} {formatMoney(unitOriginal)}
                    </span>
                    <span className="font-semibold text-red-600 tabular-nums">
                      −{formatMoney(discountPct)}%
                    </span>
                    <span className="font-medium tabular-nums text-[#2C2520]">
                      {currency} {formatMoney(unitDiscounted)}
                    </span>
                  </span>
                ) : (
                  <span className="text-sm" style={{ color: "#6B5E50" }}>
                    {currency} {formatMoney(ticket.price)}
                  </span>
                )}
                {ticket.isFree && (
                  <span className="text-xs font-semibold uppercase tracking-wide text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    Free
                  </span>
                )}
                {hasUnitDiscount && pricing.appliedDiscountName && (
                  <span className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                    {pricing.appliedDiscountName} −{formatMoney(discountPct)}%
                  </span>
                )}
                {soldOut && (
                  <span className="text-xs font-semibold uppercase tracking-wide text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                    Out of stock
                  </span>
                )}
                {limited && !soldOut && (
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                    Limited available
                    {displayRemaining != null ? ` (${displayRemaining} left)` : ""}
                  </span>
                )}
              </div>
              {ticket.description && (
                <p className="mt-1 text-sm text-zinc-600">{ticket.description}</p>
              )}
              {dateHint && (
                <p className="mt-1 text-xs text-blue-800/80">Valid: {dateHint}</p>
              )}
              <p className="mt-1 text-xs text-amber-700">
                Max {ticket.maxPerOrder ?? 6} per order
                {displayRemaining != null &&
                displayRemaining > 0 &&
                displayRemaining < (ticket.maxPerOrder ?? 6)
                  ? ` · only ${displayRemaining} left`
                  : ""}
              </p>
              {level === "ok" &&
                displayRemaining != null &&
                displayRemaining > LIMITED_STOCK_THRESHOLD && (
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {displayRemaining} available
                  </p>
                )}
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center rounded-lg border border-zinc-200">
                <button
                  type="button"
                  onClick={() => updateQuantity(ticket, qty - 1)}
                  className="flex h-10 w-10 items-center justify-center text-zinc-500 hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-40"
                  disabled={qty === 0 || soldOut}
                  aria-label={`Decrease ${ticket.name}`}
                >
                  <Minus size={16} />
                </button>
                <div className="w-10 text-center font-medium tabular-nums">{qty}</div>
                <button
                  type="button"
                  onClick={() => updateQuantity(ticket, qty + 1)}
                  className="flex h-10 w-10 items-center justify-center text-zinc-500 hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-40"
                  disabled={soldOut || qty >= max}
                  aria-label={`Increase ${ticket.name}`}
                >
                  <Plus size={16} />
                </button>
              </div>

              <div className="w-28 text-right font-semibold tabular-nums">
                {ticket.isFree
                  ? qty > 0
                    ? "Free"
                    : "-"
                  : lineTotal > 0
                    ? hasUnitDiscount
                      ? (
                          <div className="leading-tight">
                            <div className="text-xs line-through text-zinc-400 font-normal">
                              {currency} {formatMoney(lineOriginal)}
                            </div>
                            <div className="text-xs text-red-600 font-medium">
                              −{formatMoney(discountPct)}%
                            </div>
                            <div>
                              {currency} {formatMoney(lineTotal)}
                            </div>
                          </div>
                        )
                      : `${currency} ${formatMoney(lineTotal)}`
                    : "-"}
              </div>
            </div>
          </div>
        );
      })}

      <div
        className="flex items-center justify-between border-t pt-4 text-sm"
        style={{ borderColor: "#EDE4D3" }}
      >
        <div style={{ color: "#6B5E50" }}>
          {totalTickets} ticket{totalTickets !== 1 ? "s" : ""} selected
        </div>
        <div className="text-xl font-semibold tabular-nums text-[#2C2520]">
          Total: {currency} {formatMoney(total)}
        </div>
      </div>
    </div>
  );
}
