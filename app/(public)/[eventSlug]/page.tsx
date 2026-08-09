"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { TicketSelector } from "@/components/ticketing";
import { loadEventBySlug, getEffectivePrice } from "@/lib/config/events";
import { EventConfig, TicketSelection, BuyerInfo, OrderCart, BuyerFormField } from "@/types";
import { Calendar, MapPin, Users } from "lucide-react";
import { getEventTicketSoldCounts } from "@/app/sit-admin/actions";
import { getRemaining } from "@/lib/tickets/inventory";
import { isDiscountCodeActive } from "@/lib/tickets/validity";
import { getEventTheme } from "@/lib/tickets/event-theme";

/**
 * Dynamic Event Page
 *
 * Accessible at /at-the-peak (and future slugs).
 * Fully data-driven from lib/config/events.ts
 *
 * Flow:
 *   1. Select tickets → live total
 *   2. Fill buyer details (+ optional “I want to donate” checkbox)
 *   3. If donate checked → donation amount page (default from admin, editable)
 *   4. Proceed to /checkout (or free path) with cart including donationAmount
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
        setWantToDonate(false);
        setDonationAmount(
          loaded.donationEnabled
            ? Math.max(0, Number(loaded.donationDefaultAmount) || 0)
            : 0
        );
      }
    });
    getEventTicketSoldCounts(eventSlug)
      .then(setSoldByType)
      .catch(() => setSoldByType({}));
  }, [eventSlug]);

  const [step, setStep] = useState<"tickets" | "details" | "donation">("details");
  const [selections, setSelections] = useState<TicketSelection[]>([]);
  const [buyer, setBuyer] = useState<BuyerInfo | null>(null);
  const [customBuyerValues, setCustomBuyerValues] = useState<Record<string, string>>({});
  const [discountCodeInput, setDiscountCodeInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{ code: string; percent: number } | null>(null);
  const [discountCodeError, setDiscountCodeError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [soldByType, setSoldByType] = useState<Record<string, number>>({});
  /** User opted in on details form (donation step only if checked) */
  const [wantToDonate, setWantToDonate] = useState(false);
  /** Donation amount on donation step (any amount user chooses) */
  const [donationAmount, setDonationAmount] = useState<number>(0);

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
  const ticketTotal = Math.max(0, totalAmount - discountAmount);
  const chargeTotal =
    ticketTotal + (wantToDonate ? Math.max(0, Number(donationAmount) || 0) : 0);

  const handleTicketChange = (newSelections: TicketSelection[]) => {
    setSelections(newSelections);
  };

  // Skip KPay only when nothing to charge (tickets free/zero and no donation)
  const cartIsFree = chargeTotal <= 0;

  const buildCart = (
    finalBuyer: BuyerInfo,
    donAmt: number
  ): OrderCart => {
    const safeDon = Math.max(0, Number(donAmt) || 0);
    const total = ticketTotal + safeDon;
    return {
      eventSlug: event!.slug,
      tickets: selections,
      buyer: finalBuyer,
      ticketAmount: ticketTotal,
      donationAmount: safeDon > 0 ? safeDon : undefined,
      totalAmount: total,
      currency: total <= 0 ? "FREE" : currency,
      appliedDiscountCode: appliedDiscount?.code,
      discountAmount: discountAmount || undefined,
    };
  };

  const handleBuyerSubmit = (data: BuyerInfo) => {
    setBuyer(data);
    if (totalTickets === 0) {
      alert("Select at least one ticket.");
      return;
    }
    // Optional donation page after details
    if (event.donationEnabled && wantToDonate) {
      setDonationAmount(
        Math.max(0, Number(event.donationDefaultAmount) || donationAmount || 0)
      );
      setStep("donation");
      return;
    }
    finishOrder(data, 0);
  };

  const handleDonationContinue = () => {
    if (!buyer) return;
    const amt = Math.max(0, Number(donationAmount) || 0);
    if (wantToDonate && amt <= 0) {
      alert("Enter a donation amount greater than 0, or go back and uncheck donation.");
      return;
    }
    finishOrder(buyer, amt);
  };

  const finishOrder = (buyerData: BuyerInfo, donAmt: number) => {
    const total = ticketTotal + Math.max(0, donAmt);
    if (total <= 0) {
      void handleFreeRegistration(buyerData, 0);
    } else {
      void proceedToCheckout(buyerData, donAmt);
    }
  };

  const proceedToCheckout = async (
    buyerData?: BuyerInfo,
    donAmt: number = 0
  ) => {
    const finalBuyer = buyerData || buyer;
    if (!event || !finalBuyer || totalTickets === 0) return;

    const cart = buildCart(finalBuyer, donAmt);

    // Safety: free cart should never hit KPay checkout
    if (cart.totalAmount <= 0) {
      await handleFreeRegistration(finalBuyer, 0);
      return;
    }

    if (typeof window !== "undefined") {
      sessionStorage.setItem("pendingCart", JSON.stringify(cart));
    }

    setIsLoading(true);
    router.push(`/${event.slug}/checkout`);
  };

  async function handleFreeRegistration(
    buyerData: BuyerInfo,
    donAmt: number = 0
  ) {
    if (!event) return;
    // Donation with free tickets still needs payment
    if (donAmt > 0) {
      await proceedToCheckout(buyerData, donAmt);
      return;
    }
    const slug = event.slug;
    const freeCart = buildCart(buyerData, 0);

    if (typeof window !== "undefined") {
      sessionStorage.setItem("pendingCart", JSON.stringify(freeCart));
    }

    setIsLoading(true);

    try {
      const { processSuccessfulPurchase } = await import(
        "@/lib/integrations/order.service"
      );
      const { makeOrderReference } = await import("@/lib/tickets/serials");
      const payRef = `FREE-${makeOrderReference("FREE").split("-")[1] || Date.now()}`;
      const result = await processSuccessfulPurchase(freeCart, payRef, {
        paymentMethod: "free",
        orderPrefix: "FREE",
      });
      const ref = result.orderReference || payRef;
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

  const goBackFromDonation = () => {
    setStep("details");
  };

  const theme = getEventTheme(event);

  return (
    <div className="min-h-screen" style={theme.cssVars as React.CSSProperties}>
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

      {/* Hero — surface + accents; body text stays dark for readability */}
      <div
        className="border-b"
        style={{
          background: "var(--event-surface)",
          borderColor: "var(--border)",
        }}
      >
        <div className="max-w-4xl mx-auto px-6 pt-14 pb-10">
          <div className="flex flex-col gap-2">
            <div className="inline-flex items-center gap-2 text-sm" style={{ color: "var(--event-secondary)" }}>
              <span className="uppercase tracking-[1.5px] font-medium">Live Event</span>
            </div>
            <h1
              className="text-5xl font-semibold tracking-tighter"
              style={{ color: "var(--event-text)" }}
            >
              {event.name}
            </h1>
            <div
              className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2"
              style={{ color: "var(--event-text-body)" }}
            >
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" style={{ color: "var(--event-secondary)" }} /> {event.date} {event.time && `• ${event.time}`}
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" style={{ color: "var(--event-secondary)" }} /> {event.location}
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" style={{ color: "var(--event-secondary)" }} /> Tickets available
              </div>
            </div>
          </div>

          {event.description && (
            <p
              className="mt-6 max-w-2xl text-lg leading-relaxed"
              style={{ color: "var(--event-text-body)" }}
            >
              {event.description}
            </p>
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
                    {totalTickets > 0
                      ? "Continue"
                      : "Select tickets to continue"}
                  </button>
                </div>
              </>
            ) : step === "donation" ? (
              <>
                <div className="mb-6">
                  <h2 className="text-2xl font-semibold tracking-tight">Make a donation</h2>
                  <p className="text-sm text-zinc-600 mt-1">
                    Optional support for this event. You can keep the suggested amount or enter any amount you like.
                  </p>
                </div>
                <div
                  className="rounded-2xl border p-6 space-y-5"
                  style={{
                    background: "var(--event-surface)",
                    borderColor: "var(--border)",
                  }}
                >
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Donation amount ({currency})
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={Number.isFinite(donationAmount) ? donationAmount : ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") {
                          setDonationAmount(0);
                          return;
                        }
                        setDonationAmount(Math.max(0, Number(v) || 0));
                      }}
                      className="w-full border rounded-lg px-3 py-3 text-lg font-medium tabular-nums"
                    />
                    <p className="text-xs text-zinc-500 mt-2">
                      Suggested default: {currency}{" "}
                      {Math.max(0, Number(event.donationDefaultAmount) || 0)}. Change freely.
                    </p>
                  </div>
                  <div className="rounded-xl bg-zinc-50 border px-4 py-3 text-sm space-y-1">
                    <div className="flex justify-between">
                      <span>Tickets</span>
                      <span className="tabular-nums">
                        {ticketTotal <= 0 ? "Free" : `${currency} ${ticketTotal}`}
                      </span>
                    </div>
                    <div className="flex justify-between text-rose-700">
                      <span>Donation</span>
                      <span className="tabular-nums">
                        {currency} {Math.max(0, donationAmount || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between font-semibold border-t pt-2 mt-1">
                      <span>Total to pay</span>
                      <span className="tabular-nums">
                        {currency}{" "}
                        {ticketTotal + Math.max(0, donationAmount || 0)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={goBackFromDonation}
                      className="flex-1 rounded-lg border py-3 font-medium"
                      disabled={isLoading}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleDonationContinue}
                      disabled={isLoading || Math.max(0, donationAmount || 0) <= 0}
                      className="btn-gold flex-1 rounded-lg py-3 font-medium disabled:opacity-60"
                    >
                      {isLoading
                        ? "Please wait…"
                        : ticketTotal + Math.max(0, donationAmount || 0) <= 0
                          ? "Continue"
                          : "Continue to payment"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="mb-6">
                  <h2 className="text-2xl font-semibold tracking-tight">Your details</h2>
                  <p className="text-sm text-zinc-600 mt-1">We need this information to issue your tickets.</p>
                </div>

                <div
                  className="rounded-2xl border p-6"
                  style={{
                    background: "var(--event-surface)",
                    borderColor: "var(--border)",
                  }}
                >
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

                    {/* Optional donation opt-in (admin enables per event) */}
                    {event.donationEnabled && (
                      <div className="pt-2 border-t">
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4"
                            checked={wantToDonate}
                            onChange={(e) => setWantToDonate(e.target.checked)}
                          />
                          <span>
                            <span className="block text-sm font-medium">
                              I would like to make a donation
                            </span>
                            <span className="block text-xs text-zinc-500 mt-0.5">
                              If checked, you can set the amount on the next step
                              (suggested {currency}{" "}
                              {Math.max(0, Number(event.donationDefaultAmount) || 0)}).
                              Donation is added to your total and tracked separately.
                            </span>
                          </span>
                        </label>
                      </div>
                    )}

                    {/* Promo / Discount Code (event level) */}
                    {event.discountCodes && event.discountCodes.length > 0 && (
                      <div className="pt-2 border-t">
                        <label className="block text-sm font-medium mb-1">Discount Code (optional)</label>
                        <div className="flex gap-2">
                          <input
                            value={discountCodeInput}
                            onChange={(e) => {
                              setDiscountCodeInput(e.target.value.toUpperCase());
                              setDiscountCodeError("");
                            }}
                            placeholder="e.g. SUMMER20"
                            className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const code = discountCodeInput.trim().toUpperCase();
                              if (!code) return;
                              const match = (event.discountCodes || []).find(
                                (dc) => dc.code.toUpperCase() === code
                              );
                              if (!match) {
                                setAppliedDiscount(null);
                                setDiscountCodeError("Invalid discount code.");
                                return;
                              }
                              const active = isDiscountCodeActive(match);
                              if (!active.ok) {
                                setAppliedDiscount(null);
                                setDiscountCodeError(
                                  active.reason ||
                                    "This discount isn’t available."
                                );
                                return;
                              }
                              setDiscountCodeError("");
                              setAppliedDiscount({
                                code: match.code,
                                percent: match.percent,
                              });
                            }}
                            className="px-4 py-2 border rounded-lg text-sm hover:bg-white"
                          >
                            Apply
                          </button>
                        </div>
                        {discountCodeError && (
                          <div className="mt-1 text-xs text-red-600 font-medium">
                            {discountCodeError}
                          </div>
                        )}
                        {appliedDiscount && !discountCodeError && (
                          <div className="mt-1 text-xs text-emerald-600">
                            ✓ {appliedDiscount.code} applied (-{appliedDiscount.percent}%)
                            <button
                              type="button"
                              className="ml-2 text-zinc-500 underline"
                              onClick={() => {
                                setAppliedDiscount(null);
                                setDiscountCodeInput("");
                                setDiscountCodeError("");
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-3 pt-2">
                      <button type="button" onClick={goBackToTickets} className="flex-1 rounded-lg border py-3 font-medium">Back</button>
                      <button type="submit" className="btn-gold flex-1 rounded-lg py-3 font-medium" disabled={isLoading}>
                        {wantToDonate && event.donationEnabled
                          ? "Continue to donation"
                          : cartIsFree
                            ? "Get free tickets"
                            : "Proceed to Checkout"}
                      </button>
                    </div>
                  </form>
                </div>
              </>
            )}
          </div>

          {/* Sidebar summary */}
          <div className="lg:col-span-5">
            <div className="sticky top-8 space-y-6">
              <div
                className="rounded-2xl border card p-6"
                style={{
                  background: "var(--event-surface)",
                  borderColor: "var(--border)",
                }}
              >
                <div className="uppercase text-xs tracking-[1px] font-medium mb-3" style={{ color: "var(--event-secondary)" }}>Order Summary</div>

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
                    {appliedDiscount && (
                      <div className="text-xs text-emerald-600 text-right">
                        {appliedDiscount.code} (-{appliedDiscount.percent}%)
                      </div>
                    )}
                    {(wantToDonate || step === "donation") && (
                      <div className="flex justify-between text-rose-700">
                        <span>Donation</span>
                        <span className="tabular-nums">
                          {currency} {Math.max(0, donationAmount || 0)}
                        </span>
                      </div>
                    )}
                    <div className="border-t pt-3 mt-2 flex justify-between font-semibold">
                      <span>Total</span>
                      <span>
                        {ticketTotal +
                          (wantToDonate || step === "donation"
                            ? Math.max(0, donationAmount || 0)
                            : 0) <=
                        0
                          ? "Free"
                          : `${currency} ${
                              ticketTotal +
                              (wantToDonate || step === "donation"
                                ? Math.max(0, donationAmount || 0)
                                : 0)
                            }`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No tickets selected yet.</p>
                )}
              </div>

              {buyer && (step === "details" || step === "donation") && (
                <div
                  className="rounded-2xl border p-6 text-sm"
                  style={{
                    background: "var(--event-surface)",
                    borderColor: "var(--border)",
                  }}
                >
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
