"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { TicketSelector } from "@/components/ticketing";
import { BuyerForm } from "@/components/ticketing";
import { loadEventBySlug } from "@/lib/config/events";
import { EventConfig, TicketSelection, BuyerInfo, OrderCart } from "@/types";
import { Calendar, MapPin, Users } from "lucide-react";

/**
 * Dynamic Event Page
 *
 * Accessible at /at-the-peak (and future slugs).
 * Fully data-driven from lib/config/events.ts
 *
 * Flow:
 *   1. Select tickets → live total
 *   2. Fill buyer details
 *   3. Proceed to /checkout with cart state passed via URL + localStorage fallback
 */

interface EventPageProps {
  params: Promise<{ eventSlug: string }>;
}

export default function EventPage({ params }: EventPageProps) {
  const router = useRouter();
  const [eventSlug, setEventSlug] = React.useState<string | null>(null);
  const [event, setEvent] = React.useState<EventConfig | null>(null);
  const [eventLoading, setEventLoading] = React.useState(true);

  // Resolve slug from params (Next 15 async params)
  React.useEffect(() => {
    params.then((p) => setEventSlug(p.eventSlug));
  }, [params]);

  // Load event asynchronously from DB (with fallback)
  React.useEffect(() => {
    if (!eventSlug) return;

    setEventLoading(true);
    loadEventBySlug(eventSlug).then((loaded) => {
      setEvent(loaded);
      setEventLoading(false);
    });
  }, [eventSlug]);

  const [step, setStep] = useState<"tickets" | "details">("tickets");
  const [selections, setSelections] = useState<TicketSelection[]>([]);
  const [buyer, setBuyer] = useState<BuyerInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!eventSlug || eventLoading) {
    return <div className="min-h-[60vh] flex items-center justify-center">Loading event...</div>;
  }

  if (!event) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center">
        <h1 className="text-2xl font-semibold mb-2">Event not found</h1>
        <p className="text-zinc-600">The event you are looking for does not exist or has ended.</p>
      </div>
    );
  }

  // Respect enabled flag from admin
  if (event.enabled === false) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center">
        <h1 className="text-2xl font-semibold mb-2">{event.name}</h1>
        <p className="text-zinc-600">This event is currently not available for ticket sales.</p>
      </div>
    );
  }

  // Only show enabled ticket types to users
  const availableTicketTypes = event.ticketTypes.filter((t) => t.enabled !== false);

  const currency = availableTicketTypes[0]?.currency || "HKD";

  const totalAmount = selections.reduce((sum, sel) => {
    const t = availableTicketTypes.find((tt) => tt.id === sel.ticketTypeId);
    return sum + (t ? t.price * sel.quantity : 0);
  }, 0);

  const totalTickets = selections.reduce((s, sel) => s + sel.quantity, 0);

  const handleTicketChange = (newSelections: TicketSelection[]) => {
    setSelections(newSelections);
  };

  const handleBuyerSubmit = (data: BuyerInfo) => {
    setBuyer(data);
    // Proceed to checkout immediately using the submitted data.
    // This records the cart (in sessionStorage) and navigates to the checkout page.
    // Note: We do NOT redirect back to the events/catalogue page here — that's for browsing.
    // The purchase is recorded only after successful payment on the checkout page.
    proceedToCheckout(data);
  };

  const proceedToCheckout = async (buyerData?: BuyerInfo) => {
    const finalBuyer = buyerData || buyer;
    if (!finalBuyer || totalTickets === 0) return;

    const cart: OrderCart = {
      eventSlug: event.slug,
      tickets: selections,
      buyer: finalBuyer,
      totalAmount,
      currency,
    };

    // Persist cart temporarily (checkout page will read it)
    // In production you could also encode a short-lived JWT or store server-side session.
    if (typeof window !== "undefined") {
      sessionStorage.setItem("pendingCart", JSON.stringify(cart));
    }

    setIsLoading(true);

    // Navigate to dedicated checkout page
    router.push(`/${event.slug}/checkout`);
  };

  const goBackToTickets = () => {
    setStep("tickets");
  };

  return (
    <div className="min-h-screen" style={{ background: '#FAF8F5' }}>
      {/* Hero / Event Header - White Gold */}
      <div className="bg-white border-b border-[#EDE4D3]">
        <div className="max-w-4xl mx-auto px-6 pt-14 pb-10">
          <div className="flex flex-col gap-2">
            <div className="inline-flex items-center gap-2 text-sm" style={{ color: '#6B5E50' }}>
              <span className="uppercase tracking-[1.5px] font-medium">Live Event</span>
            </div>
            <h1 className="text-5xl font-semibold tracking-tighter text-[#2C2520]">{event.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2" style={{ color: '#3A2F23' }}>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" /> {event.date} {event.time && `• ${event.time}`}
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" /> {event.location}
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" /> Tickets available
              </div>
            </div>
          </div>

          {event.description && (
            <p className="mt-6 max-w-2xl text-lg leading-relaxed" style={{ color: '#3A2F23' }}>{event.description}</p>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="grid gap-8 lg:grid-cols-12">
          {/* Main content */}
          <div className="lg:col-span-7">
            {step === "tickets" ? (
              <>
                <div className="mb-6">
                  <h2 className="text-2xl font-semibold tracking-tight">Select your tickets</h2>
                  <p className="text-sm text-zinc-600 mt-1">Choose quantity for each ticket type.</p>
                </div>

                <TicketSelector
                  ticketTypes={availableTicketTypes}
                  selections={selections}
                  onChange={handleTicketChange}
                  currency={currency}
                />

                <div className="mt-8">
                  <button
                    onClick={() => {
                      if (totalTickets > 0) setStep("details");
                    }}
                    disabled={totalTickets === 0}
                    className="btn-gold w-full rounded-xl py-4 font-medium text-lg disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {totalTickets > 0 ? `Continue with ${totalTickets} ticket${totalTickets > 1 ? "s" : ""}` : "Select tickets to continue"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-6">
                  <h2 className="text-2xl font-semibold tracking-tight">Your details</h2>
                  <p className="text-sm text-zinc-600 mt-1">We need this information to issue your tickets.</p>
                </div>

                <div className="rounded-2xl border bg-white p-6">
                  <BuyerForm
                    defaultValues={buyer || undefined}
                    onSubmit={handleBuyerSubmit}
                    onBack={goBackToTickets}
                    submitLabel="Review & Continue to Payment"
                  />
                </div>
              </>
            )}
          </div>

          {/* Sidebar summary */}
          <div className="lg:col-span-5">
            <div className="sticky top-8 space-y-6">
              <div className="rounded-2xl border card p-6" style={{ borderColor: '#EDE4D3' }}>
                <div className="uppercase text-xs tracking-[1px] font-medium mb-3" style={{ color: '#6B5E50' }}>Order Summary</div>

                {totalTickets > 0 ? (
                  <div className="space-y-2 text-sm">
                    {selections.map((sel, idx) => {
                      const type = availableTicketTypes.find((t) => t.id === sel.ticketTypeId);
                      if (!type) return null;
                      return (
                        <div key={idx} className="flex justify-between">
                          <span>{type.name} × {sel.quantity}</span>
                          <span className="font-medium tabular-nums">
                            {currency} {type.price * sel.quantity}
                          </span>
                        </div>
                      );
                    })}
                    <div className="border-t pt-3 mt-2 flex justify-between font-semibold">
                      <span>Total</span>
                      <span>{currency} {totalAmount}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No tickets selected yet.</p>
                )}
              </div>

              {buyer && step === "details" && (
                <div className="rounded-2xl border bg-white p-6 text-sm">
                  <div className="font-medium mb-2">Attendee Information</div>
                  <div>{buyer.name}</div>
                  <div className="text-zinc-600">{buyer.email}</div>
                  <div className="text-zinc-600">{buyer.phone}</div>
                </div>
              )}

              <div className="text-xs text-zinc-500 px-1">
                Secure checkout powered by Wonder. All sales final unless otherwise stated.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
