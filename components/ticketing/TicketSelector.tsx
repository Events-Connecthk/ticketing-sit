"use client";

import React from "react";
import { TicketType, TicketSelection } from "@/types";
import { Plus, Minus } from "lucide-react";
import {
  getMaxSelectable,
  getRemaining,
  getStockLevel,
  LIMITED_STOCK_THRESHOLD,
} from "@/lib/tickets/inventory";

interface TicketSelectorProps {
  ticketTypes: TicketType[];
  selections: TicketSelection[];
  onChange: (selections: TicketSelection[]) => void;
  currency: string;
  /** Sold counts by ticket type id (from purchases) */
  soldByType?: Record<string, number>;
}

/**
 * Reusable ticket selector.
 * Enforces maxPerOrder + inventory; limited / out of stock labels.
 */
export function TicketSelector({
  ticketTypes,
  selections,
  onChange,
  currency,
  soldByType = {},
}: TicketSelectorProps) {
  const getQuantity = (id: string) =>
    selections.find((s) => s.ticketTypeId === id)?.quantity ?? 0;

  const updateQuantity = (ticket: TicketType, newQuantity: number) => {
    const remaining = getRemaining(ticket, soldByType);
    const max = getMaxSelectable(ticket, remaining);
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

  const total = selections.reduce((sum, sel) => {
    const type = ticketTypes.find((t) => t.id === sel.ticketTypeId);
    return sum + (type ? type.price * sel.quantity : 0);
  }, 0);

  const totalTickets = selections.reduce((s, sel) => s + sel.quantity, 0);

  return (
    <div className="space-y-4">
      {ticketTypes.map((ticket) => {
        const qty = getQuantity(ticket.id);
        const lineTotal = ticket.price * qty;
        const remaining = getRemaining(ticket, soldByType);
        const max = getMaxSelectable(ticket, remaining);
        const level = getStockLevel(remaining);
        const soldOut = level === "sold_out";
        const limited = level === "limited";

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
                <span className="text-sm" style={{ color: "#6B5E50" }}>
                  {currency} {ticket.price}
                </span>
                {soldOut && (
                  <span className="text-xs font-semibold uppercase tracking-wide text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                    Out of stock
                  </span>
                )}
                {limited && !soldOut && (
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                    Limited available
                    {remaining != null ? ` (${remaining} left)` : ""}
                  </span>
                )}
              </div>
              {ticket.description && (
                <p className="mt-1 text-sm text-zinc-600">{ticket.description}</p>
              )}
              <p className="mt-1 text-xs text-amber-700">
                Max {ticket.maxPerOrder ?? 6} per order
                {remaining != null && remaining > 0 && remaining < (ticket.maxPerOrder ?? 6)
                  ? ` · only ${remaining} left`
                  : ""}
              </p>
              {level === "ok" && remaining != null && remaining > LIMITED_STOCK_THRESHOLD && (
                <p className="mt-0.5 text-xs text-zinc-500">{remaining} available</p>
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

              <div className="w-20 text-right font-semibold tabular-nums">
                {lineTotal > 0 ? `${currency} ${lineTotal}` : "—"}
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
          Total: {currency} {total}
        </div>
      </div>
    </div>
  );
}
