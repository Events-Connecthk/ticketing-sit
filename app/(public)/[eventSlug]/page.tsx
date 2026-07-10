"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { TicketSelector } from "@/components/ticketing";
import { loadEventBySlug, getEffectivePrice } from "@/lib/config/events";
import { EventConfig, TicketSelection, BuyerInfo, OrderCart, BuyerFormField } from "@/types";
import { Calendar, MapPin, Users } from "lucide-react";
import { getEventTicketSoldCounts } from "@/app/sit-admin/actions";
import { getRemaining } from "@/lib/tickets/inventory";

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
      if (loaded) {
        const hasTickets = loaded.ticketTypes && loaded.ticketTypes.length > 0;
        const needsTicketSelection = hasTickets && loaded.paymentEnabled !== false;
        setStep(needsTicketSelection ? "tickets" : "details");
      }
    });
    getEventTicketSoldCounts(eventSlug)
      .then(setSoldByType)
      .catch(() => setSoldByType({}));
  }, [eventSlug]);

  const [step, setStep] = useState<"tickets" | "details">("details");
  const [selections, setSelections] = useState<TicketSelection[]>([]);
  const [buyer, setBuyer] = useState<BuyerInfo | null>(null);
  const [customBuyerValues, setCustomBuyerValues] = useState<Record<string, string>>({});
  const [discountCodeInput, setDiscountCodeInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{ code: string; percent: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [soldByType, setSoldByType] = useState<Record<string, number>>({});

  React.useEffect(() => {
    if (event) {
      const has = event.ticketTypes && event.ticketTypes.length > 0;
      const needs = has && event.paymentEnabled !== false;
      if (!needs && step === "tickets") {
        setStep("details");
      }
    }
  }, [event, step]);

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

  // Apply customizable discounts (early bird by date, group, student etc.)
  const effectiveSelections = selections.map(sel => {
    const t = availableTicketTypes.find((tt) => tt.id === sel.ticketTypeId);
    if (!t) return { ...sel, effectivePrice: 0 };
    const eff = getEffectivePrice(t, new Date(), sel.quantity);
    return { ...sel, effectivePrice: eff.discounted, originalPrice: eff.original, discountName: eff.appliedDiscountName };
  });

  const totalAmount = effectiveSelections.reduce((sum, sel) => sum + (sel.effectivePrice || 0) * sel.quantity, 0);
  const totalTickets = selections.reduce((s, sel) => s + sel.quantity, 0);

  // Order-level discount code (independent of ticket type)
  const discountAmount = appliedDiscount ? Math.round(totalAmount * (appliedDiscount.percent / 100)) : 0;
  const finalTotal = Math.max(0, totalAmount - discountAmount);

  const handleTicketChange = (newSelections: TicketSelection[]) => {
    setSelections(newSelections);
  };

  const handleBuyerSubmit = (data: BuyerInfo) => {
    setBuyer(data);
    const hasTickets = event.ticketTypes && event.ticketTypes.length > 0;
    if (hasTickets && event.paymentEnabled !== false) {
      proceedToCheckout(data);
    } else {
      handleFreeRegistration(data);
    }
  };

  const proceedToCheckout = async (buyerData?: BuyerInfo) => {
    const finalBuyer = buyerData || buyer;
    if (!event || !finalBuyer || totalTickets === 0) return;

    const cart: OrderCart = {
      eventSlug: event.slug,
      tickets: selections,
      buyer: finalBuyer,
      totalAmount: event.paymentEnabled ? finalTotal : 0,
      currency,
      appliedDiscountCode: appliedDiscount?.code,
      discountAmount: discountAmount || undefined,
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

  async function handleFreeRegistration(buyerData: BuyerInfo) {
    if (!event) return;
    const slug = event.slug;
    const freeCart: OrderCart = {
      eventSlug: slug,
      tickets: selections,
      buyer: buyerData,
      totalAmount: 0,
      currency: "FREE",
    };

    if (typeof window !== "undefined") {
      sessionStorage.setItem("pendingCart", JSON.stringify(freeCart));
    }

    setIsLoading(true);

    try {
      // Process free registration directly
      const { finalizeAfterPayment } = await import("@/lib/integrations/order.service");
      const result = await finalizeAfterPayment("FREE-" + Date.now(), freeCart);
      const ref = result.orderReference || "FREE-" + Date.now();
      router.push(`/${slug}/success?ref=${ref}&amount=0`);
    } catch (e) {
      console.error(e);
      alert("Registration failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  const goBackToTickets = () => {
    setStep("tickets");
  };

  return (
    <div className="min-h-screen" style={{ background: '#FAF8F5' }}>
      {/* Optional Event Banner Image */}
      {event.image && (
        <div className="w-full overflow-hidden">
          <img
            src={event.image}
            alt={`${event.name} banner`}
            className="w-full h-48 md:h-64 lg:h-72 object-cover"
          />
        </div>
      )}

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
                  soldByType={soldByType}
                />

                <div className="mt-6">
                  <button
                    onClick={() => {
                      if (totalTickets > 0) setStep("details");
                    }}
                    disabled={
                      totalTickets === 0 ||
                      availableTicketTypes.every((t) => {
                        const rem = getRemaining(t, soldByType);
                        return rem !== null && rem <= 0;
                      })
                    }
                    className="btn-gold w-full rounded-xl py-4 font-medium text-lg disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {totalTickets > 0 ? (event.paymentEnabled ? "Proceed to Checkout" : "Register for Free") : "Select tickets to continue"}
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
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const base: BuyerInfo = {
                      name: (document.getElementById('buyer-name') as HTMLInputElement)?.value || '',
                      phone: (document.getElementById('buyer-phone') as HTMLInputElement)?.value || '',
                      email: (document.getElementById('buyer-email') as HTMLInputElement)?.value || '',
                      customFields: { ...customBuyerValues },
                    };
                    handleBuyerSubmit(base);
                  }} className="space-y-5">
                    {/* Always include core fields */}
                    <div>
                      <label className="block text-sm font-medium mb-1">Full Name</label>
                      <input id="buyer-name" type="text" required className="w-full border rounded-lg px-3 py-2" defaultValue={buyer?.name} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Phone</label>
                      <input id="buyer-phone" type="tel" required className="w-full border rounded-lg px-3 py-2" defaultValue={buyer?.phone} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Email</label>
                      <input id="buyer-email" type="email" required className="w-full border rounded-lg px-3 py-2" defaultValue={buyer?.email} />
                    </div>

                    {/* Custom per-event fields from admin */}
                    {(event.buyerFormFields || []).map(field => (
                      <div key={field.id}>
                        <label className="block text-sm font-medium mb-1">{field.label} {field.required && '*'}</label>
                        {field.type === 'select' ? (
                          <select
                            className="w-full border rounded-lg px-3 py-2"
                            required={field.required}
                            value={customBuyerValues[field.id] || ''}
                            onChange={e => setCustomBuyerValues(prev => ({...prev, [field.id]: e.target.value}))}
                          >
                            <option value="">Select...</option>
                            {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        ) : field.type === 'textarea' ? (
                          <textarea
                            className="w-full border rounded-lg px-3 py-2"
                            required={field.required}
                            placeholder={field.placeholder}
                            value={customBuyerValues[field.id] || ''}
                            onChange={e => setCustomBuyerValues(prev => ({...prev, [field.id]: e.target.value}))}
                          />
                        ) : (
                          <input
                            type={field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text'}
                            className="w-full border rounded-lg px-3 py-2"
                            required={field.required}
                            placeholder={field.placeholder}
                            value={customBuyerValues[field.id] || ''}
                            onChange={e => setCustomBuyerValues(prev => ({...prev, [field.id]: e.target.value}))}
                          />
                        )}
                      </div>
                    ))}

                    {/* Promo / Discount Code (event level) */}
                    {event.discountCodes && event.discountCodes.length > 0 && (
                      <div className="pt-2 border-t">
                        <label className="block text-sm font-medium mb-1">Discount Code (optional)</label>
                        <div className="flex gap-2">
                          <input
                            value={discountCodeInput}
                            onChange={(e) => setDiscountCodeInput(e.target.value.toUpperCase())}
                            placeholder="e.g. SUMMER20"
                            className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const code = discountCodeInput.trim().toUpperCase();
                              if (!code) return;
                              const match = (event.discountCodes || []).find(dc => dc.code.toUpperCase() === code);
                              if (match) {
                                setAppliedDiscount({ code: match.code, percent: match.percent });
                              } else {
                                alert("Invalid or expired discount code.");
                              }
                            }}
                            className="px-4 py-2 border rounded-lg text-sm hover:bg-white"
                          >
                            Apply
                          </button>
                        </div>
                        {appliedDiscount && (
                          <div className="mt-1 text-xs text-emerald-600">
                            ✓ {appliedDiscount.code} applied (-{appliedDiscount.percent}%)
                            <button className="ml-2 text-zinc-500 underline" onClick={() => { setAppliedDiscount(null); setDiscountCodeInput(""); }}>Remove</button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-3 pt-2">
                      <button type="button" onClick={goBackToTickets} className="flex-1 rounded-lg border py-3 font-medium">Back</button>
                      <button type="submit" className="btn-gold flex-1 rounded-lg py-3 font-medium">{event.paymentEnabled ? "Proceed to Checkout" : "Register for Free"}</button>
                    </div>
                  </form>
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
                    {effectiveSelections.map((sel: any, idx) => {
                      const type = availableTicketTypes.find((t) => t.id === sel.ticketTypeId);
                      if (!type) return null;
                      const isDiscounted = sel.effectivePrice && sel.effectivePrice < (sel.originalPrice || type.price);
                      return (
                        <div key={idx} className="flex justify-between">
                          <span>{type.name} × {sel.quantity}{sel.discountName ? ` (${sel.discountName})` : ''}</span>
                          <span className="font-medium tabular-nums">
                            {isDiscounted && <span className="line-through text-xs text-zinc-400 mr-1">{currency} {sel.originalPrice! * sel.quantity}</span>}
                            {currency} {sel.effectivePrice! * sel.quantity}
                          </span>
                        </div>
                      );
                    })}
                    <div className="border-t pt-3 mt-2 flex justify-between font-semibold">
                      <span>Total</span>
                      <span>{currency} {event.paymentEnabled ? finalTotal : 0}</span>
                    </div>
                    {appliedDiscount && (
                      <div className="text-xs text-emerald-600 text-right">
                        {appliedDiscount.code} (-{appliedDiscount.percent}%)
                      </div>
                    )}
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
                Secure checkout powered by KPay. All sales final unless otherwise stated.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
