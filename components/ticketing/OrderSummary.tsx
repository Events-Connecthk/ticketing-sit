"use client";

import React from "react";
import { OrderCart, EventConfig } from "@/types";
import { formatMoney } from "@/lib/money";

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
  const cur = cart.currency === "FREE" ? "HKD" : cart.currency;

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
            const line = ticketType.price * sel.quantity;

            return (
              <div key={idx} className="flex justify-between py-1">
                <span>
                  {ticketType.name} × {sel.quantity}
                </span>
                <span className="tabular-nums">
                  {cur} {formatMoney(line)}
                </span>
              </div>
            );
          })}
          {cart.appliedDiscountCode && (cart.discountAmount ?? 0) > 0 && (
            <div className="flex justify-between py-1 text-red-600 font-medium">
              <span>
                {cart.appliedDiscountCode}
                {cart.ticketAmount != null && cart.discountAmount
                  ? ` (−${formatMoney(
                      cart.ticketAmount + cart.discountAmount > 0
                        ? (cart.discountAmount /
                            (cart.ticketAmount + cart.discountAmount)) *
                          100
                        : 0
                    )}%)`
                  : ""}
              </span>
              <span className="tabular-nums">
                −{cur} {formatMoney(cart.discountAmount!)}
              </span>
            </div>
          )}
          {(cart.donationAmount ?? 0) > 0 && (
            <div className="flex justify-between py-1 text-rose-700">
              <span>Donation</span>
              <span className="tabular-nums">
                {cur} {formatMoney(Number(cart.donationAmount))}
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-between border-t pt-3 font-semibold text-base">
          <span>
            Total ({totalTickets} ticket{totalTickets !== 1 ? "s" : ""}
            {(cart.donationAmount ?? 0) > 0 ? " + donation" : ""})
          </span>
          <span className="tabular-nums">
            {cart.currency === "FREE"
              ? "Free"
              : `${cart.currency} ${formatMoney(cart.totalAmount)}`}
          </span>
        </div>
        {(cart.ticketAmount != null || (cart.donationAmount ?? 0) > 0) &&
          cart.currency !== "FREE" && (
            <div className="text-xs text-zinc-500 text-right space-y-0.5">
              {cart.ticketAmount != null && (
                <div>
                  Tickets: {cart.currency}{" "}
                  {formatMoney(Number(cart.ticketAmount))}
                </div>
              )}
              {(cart.donationAmount ?? 0) > 0 && (
                <div>
                  Donation: {cart.currency}{" "}
                  {formatMoney(Number(cart.donationAmount))}
                </div>
              )}
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
