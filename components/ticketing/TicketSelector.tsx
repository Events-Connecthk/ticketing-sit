"use client";

import React from "react";
import { TicketType, TicketSelection } from "@/types";
import { Plus, Minus } from "lucide-react";

interface TicketSelectorProps {
  ticketTypes: TicketType[];
  selections: TicketSelection[];
  onChange: (selections: TicketSelection[]) => void;
  currency: string;
}

/**
 * Reusable ticket selector.
 * Real-time quantity control + price breakdown.
 * Fully controlled from parent.
 */
export function TicketSelector({
  ticketTypes,
  selections,
  onChange,
  currency,
}: TicketSelectorProps) {
  const getQuantity = (id: string) =>
    selections.find((s) => s.ticketTypeId === id)?.quantity ?? 0;

  const updateQuantity = (ticketTypeId: string, newQuantity: number) => {
    const clamped = Math.max(0, Math.min(newQuantity, 10)); // sane upper limit
    let next = [...selections];
    const existingIndex = next.findIndex((s) => s.ticketTypeId === ticketTypeId);

    if (clamped === 0) {
      next = next.filter((s) => s.ticketTypeId !== ticketTypeId);
    } else if (existingIndex >= 0) {
      next[existingIndex] = { ticketTypeId, quantity: clamped };
    } else {
      next.push({ ticketTypeId, quantity: clamped });
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

        return (
          <div
            key={ticket.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border card p-5"
            style={{ borderColor: '#EDE4D3' }}
          >
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <h4 className="font-semibold text-lg">{ticket.name}</h4>
                <span className="text-sm" style={{ color: '#6B5E50' }}>
                  {currency} {ticket.price}
                </span>
              </div>
              {ticket.description && (
                <p className="mt-1 text-sm text-zinc-600">{ticket.description}</p>
              )}
              {ticket.maxPerOrder && (
                <p className="mt-1 text-xs text-amber-600">Max {ticket.maxPerOrder} per order</p>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center rounded-lg border border-zinc-200">
                <button
                  type="button"
                  onClick={() => updateQuantity(ticket.id, qty - 1)}
                  className="flex h-10 w-10 items-center justify-center text-zinc-500 hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-40"
                  disabled={qty === 0}
                  aria-label={`Decrease ${ticket.name}`}
                >
                  <Minus size={16} />
                </button>
                <div className="w-10 text-center font-medium tabular-nums">{qty}</div>
                <button
                  type="button"
                  onClick={() => updateQuantity(ticket.id, qty + 1)}
                  className="flex h-10 w-10 items-center justify-center text-zinc-500 hover:bg-zinc-50 active:bg-zinc-100"
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

      {/* Summary */}
      <div className="flex items-center justify-between border-t pt-4 text-sm" style={{ borderColor: '#EDE4D3' }}>
        <div style={{ color: '#6B5E50' }}>
          {totalTickets} ticket{totalTickets !== 1 ? "s" : ""} selected
        </div>
        <div className="text-xl font-semibold tabular-nums text-[#2C2520]">
          Total: {currency} {total}
        </div>
      </div>
    </div>
  );
}
