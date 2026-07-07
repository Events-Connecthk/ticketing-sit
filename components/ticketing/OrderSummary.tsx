"use client";

import React from "react";
import { OrderCart, EventConfig } from "@/types";

interface OrderSummaryProps {
  cart: OrderCart;
  event: EventConfig;
  compact?: boolean;
}

/**
 * Displays a clean breakdown of the order.
 * Used on checkout + success.
 */
export function OrderSummary({ cart, event, compact = false }: OrderSummaryProps) {
  const totalTickets = cart.tickets.reduce((sum, t) => sum + t.quantity, 0);

  return (
    <div className={`rounded-2xl border card ${compact ? "p-5" : "p-6"}`} style={{ borderColor: '#EDE4D3' }}>
      <h3 className="font-semibold mb-4 text-lg">Order Summary</h3>

      <div className="space-y-3 text-sm">
        <div>
          <div className="font-medium">{event.name}</div>
          <div className="text-zinc-600">
            {event.date} {event.time && `• ${event.time}`}
          </div>
          <div className="text-zinc-600">{event.location}</div>
        </div>

        <div className="border-t pt-3">
          {cart.tickets.map((sel, idx) => {
            const ticketType = event.ticketTypes.find((t) => t.id === sel.ticketTypeId);
            if (!ticketType) return null;

            return (
              <div key={idx} className="flex justify-between py-1">
                <span>
                  {ticketType.name} × {sel.quantity}
                </span>
                <span className="tabular-nums">
                  {cart.currency} {(ticketType.price * sel.quantity).toFixed(0)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex justify-between border-t pt-3 font-semibold text-base">
          <span>Total ({totalTickets} ticket{totalTickets !== 1 ? "s" : ""})</span>
          <span className="tabular-nums">
            {cart.currency} {cart.totalAmount}
          </span>
        </div>
        {cart.appliedDiscountCode && cart.discountAmount && (
          <div className="text-xs text-emerald-600 text-right -mt-1">
            {cart.appliedDiscountCode} applied (-{cart.discountAmount})
          </div>
        )}
      </div>

      {!compact && (
        <div className="mt-6 border-t pt-4 text-sm">
          <div className="font-medium mb-1">Attendee</div>
          <div>{cart.buyer.name}</div>
          <div className="text-zinc-600">{cart.buyer.email}</div>
          <div className="text-zinc-600">{cart.buyer.phone}</div>
        </div>
      )}
    </div>
  );
}
