"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, Download } from "lucide-react";
import { loadEventBySlug } from "@/lib/config/events";
import { generateTicketPdf } from "@/lib/pdf/generate-ticket";
import { getPurchaseByReference } from "@/app/sit-admin/actions";

/**
 * Success / Confirmation Page
 *
 * Shown after payment + full order processing completes.
 * Displays key details and offers to "download ticket" (simulated).
 */

interface SuccessPageProps {
  params: Promise<{ eventSlug: string }>;
}

export default function SuccessPage({ params }: SuccessPageProps) {
  const searchParams = useSearchParams();

  const ref = searchParams.get("ref") || "N/A";
  const amountParam = searchParams.get("amount");
  const amount = amountParam || "0";
  const isFreeRegistration = ref.startsWith("FREE") || (amountParam !== null && parseFloat(amount) === 0);

  const [eventSlug, setEventSlug] = React.useState<string | null>(null);
  const [event, setEvent] = React.useState<any>(null);
  const [purchase, setPurchase] = React.useState<any>(null);
  const [purchaseLoading, setPurchaseLoading] = React.useState(true);
  const [showDownloaded, setShowDownloaded] = useState(false);

  const ticketCount = purchase 
    ? (purchase.ticket_breakdown || []).reduce((sum: number, t: any) => sum + (t.quantity || 0), 0) 
    : 1;

  const ticketItems = React.useMemo(() => {
    if (!purchase || !event || !ref) return [];
    const items: Array<{ serial: string; ticketTypeId: string; ticketTypeName: string }> = [];
    const breakdown = purchase.ticket_breakdown || [];

    // Prefer stored serials from DB (set at purchase time)
    if (breakdown.some((t: any) => t.serial)) {
      for (const sel of breakdown) {
        const tt = event.ticketTypes?.find((t: any) => t.id === sel.ticketTypeId);
        items.push({
          serial: sel.serial,
          ticketTypeId: sel.ticketTypeId,
          ticketTypeName: tt?.name || sel.ticketTypeId,
        });
      }
      return items;
    }

    // Legacy: synthesize serials from quantities
    let counter = 1;
    breakdown.forEach((sel: any) => {
      const tt = event.ticketTypes?.find((t: any) => t.id === sel.ticketTypeId);
      const name = tt?.name || sel.ticketTypeId;
      for (let i = 0; i < (sel.quantity || 0); i++) {
        items.push({
          serial: `${ref}-${String(counter).padStart(3, "0")}`,
          ticketTypeId: sel.ticketTypeId,
          ticketTypeName: name,
        });
        counter++;
      }
    });
    return items;
  }, [purchase, event, ref]);

  React.useEffect(() => {
    params.then((p) => setEventSlug(p.eventSlug));
  }, [params]);

  React.useEffect(() => {
    if (eventSlug) {
      loadEventBySlug(eventSlug).then(setEvent);
    }
  }, [eventSlug]);

  React.useEffect(() => {
    if (!ref || ref === "N/A") {
      setPurchaseLoading(false);
      return;
    }

    // Use server action with service role to fetch by ref.
    // This works even if anon SELECT is blocked by RLS.
    getPurchaseByReference(ref).then((p) => {
      if (p) setPurchase(p);
      setPurchaseLoading(false);
    }).catch(() => {
      setPurchaseLoading(false);
    });
  }, [ref]);

  // In a real app we could fetch the full order from our DB here by ref.
  // For now we show the data passed in query + event info.

  if (!eventSlug || !event) {
    return <div className="p-12 text-center">Loading confirmation...</div>;
  }

  async function handleDownloadTicket() {
    if (!event) {
      alert("Event details still loading...");
      return;
    }

    let currentPurchase = purchase;

    if (!currentPurchase) {
      // Attempt a fresh lookup before giving up (handles slow async or refresh)
      try {
        const found = await getPurchaseByReference(ref);
        if (found) {
          currentPurchase = found;
          setPurchase(found);
        }
      } catch (e) {
        console.error(e);
      }
    }

    if (!currentPurchase) {
      alert("Could not load full ticket details yet. Please wait a moment and try again, or refresh the page.");
      return;
    }

    setShowDownloaded(true);

    try {
      const sel = (currentPurchase.ticket_breakdown || [])[0];
      if (!sel) {
        alert("No ticket found.");
        setShowDownloaded(false);
        return;
      }

      const pdfResult = await generateTicketPdf({
        event,
        buyer: { name: currentPurchase.name, phone: currentPurchase.phone, email: currentPurchase.email },
        tickets: [sel],
        orderReference: ref,
        amount: parseFloat(amount) || 0,
        currency: event.ticketTypes?.[0]?.currency || "HKD",
        purchaseDate: currentPurchase.bought_at || new Date().toISOString(),
      });

      if (pdfResult.success && pdfResult.pdfBuffer) {
        const blob = new Blob([pdfResult.pdfBuffer as any], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = pdfResult.filename || `ticket-${ref}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert("Failed to generate PDF: " + (pdfResult.error || "Unknown error"));
      }
    } catch (err) {
      console.error(err);
      alert("Error generating PDF. Check console.");
    } finally {
      setShowDownloaded(false);
    }
  }

  async function handleDownloadSingle(serial: string, ticketTypeId: string) {
    if (!event || !purchase) return;
    setShowDownloaded(true);

    try {
      const sel = (purchase.ticket_breakdown || []).find((t: any) => t.ticketTypeId === ticketTypeId);
      if (!sel) {
        alert("Ticket details not found.");
        return;
      }

      const pdfResult = await generateTicketPdf({
        event,
        buyer: { name: purchase.name, phone: purchase.phone, email: purchase.email },
        tickets: [sel],
        orderReference: ref,
        amount: parseFloat(amount) || 0,
        currency: event.ticketTypes?.[0]?.currency || "HKD",
        purchaseDate: purchase.bought_at || new Date().toISOString(),
        ticketSerial: serial,
      });

      if (pdfResult.success && pdfResult.pdfBuffer) {
        const blob = new Blob([pdfResult.pdfBuffer as any], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = pdfResult.filename || `ticket-${serial}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert("Failed to generate PDF: " + (pdfResult.error || "Unknown error"));
      }
    } catch (err) {
      console.error(err);
      alert("Error generating PDF. Check console.");
    } finally {
      setShowDownloaded(false);
    }
  }

  return (
    <div className="min-h-screen flex items-start justify-center py-12" style={{ background: '#FAF8F5' }}>
      <div className="w-full max-w-lg px-6">
        <div className="rounded-3xl bg-white shadow-sm border p-8 text-center card" style={{ borderColor: '#EDE4D3' }}>
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle className="h-9 w-9 text-emerald-600" />
          </div>

          <h1 className="text-3xl font-semibold tracking-tight">{isFreeRegistration ? "Registration Successful" : "Purchase Confirmed"}</h1>
          <p className="mt-2 text-zinc-600">{isFreeRegistration ? "Thank you! Your registration has been confirmed." : "Thank you! Your tickets have been issued."}</p>

          <div className="my-8 border-y py-6 text-left space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Order Reference</span>
              <span className="font-mono font-medium">{ref}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Event</span>
              <span className="font-medium">{event.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Date</span>
              <span>{event.date}{event.time ? ` • ${event.time}` : ""}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Location</span>
              <span>{event.location}</span>
            </div>
            <div className="flex justify-between font-medium pt-1">
              <span>Total Paid</span>
              <span>{event.ticketTypes[0]?.currency || "HKD"} {amount}</span>
            </div>
          </div>

          {!isFreeRegistration && (
            ticketCount <= 1 ? (
              <button
                onClick={handleDownloadTicket}
                disabled={showDownloaded || (!purchase && purchaseLoading)}
                className="flex w-full items-center justify-center gap-2 rounded-xl btn-gold py-3 font-medium disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                {showDownloaded
                  ? "Preparing PDF..."
                  : purchase
                    ? "Download Ticket PDF"
                    : purchaseLoading
                      ? "Loading ticket data..."
                      : "Download Ticket PDF"}
              </button>
            ) : (
              <div className="mt-4">
                <div className="text-sm font-medium mb-2 text-left">Your Tickets</div>
                <div className="border rounded-xl overflow-hidden bg-white text-left text-sm">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-zinc-50">
                        <th className="p-3 text-left font-medium">Serial</th>
                        <th className="p-3 text-left font-medium">Ticket Type</th>
                        <th className="p-3 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {ticketItems.map((item, idx) => (
                        <tr key={idx}>
                          <td className="p-3 font-mono text-xs">{item.serial}</td>
                          <td className="p-3">{item.ticketTypeName}</td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => handleDownloadSingle(item.serial, item.ticketTypeId)}
                              disabled={showDownloaded}
                              className="text-xs px-3 py-1.5 rounded-lg border hover:bg-zinc-50 disabled:opacity-50"
                            >
                              <Download className="inline h-3 w-3 mr-1" /> Download PDF
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[10px] text-zinc-500 text-left">
                  Click each row to download that ticket's PDF individually.
                </p>
              </div>
            )
          )}

          <p className="mt-4 text-xs text-zinc-500">
            A link to view and download your ticket(s) has also been sent to your email.
          </p>
        </div>

        <div className="mt-8 text-center text-sm text-zinc-600">
          Questions? Contact the event team.<br />
          Keep your order reference <span className="font-medium">#{ref}</span> handy.
        </div>
      </div>
    </div>
  );
}
