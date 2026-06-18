"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, Download } from "lucide-react";
import { loadEventBySlug } from "@/lib/config/events";

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
  const [eventSlug, setEventSlug] = React.useState<string | null>(null);
  const [event, setEvent] = React.useState<any>(null);

  React.useEffect(() => {
    params.then((p) => setEventSlug(p.eventSlug));
  }, [params]);

  React.useEffect(() => {
    if (eventSlug) {
      loadEventBySlug(eventSlug).then(setEvent);
    }
  }, [eventSlug]);

  const ref = searchParams.get("ref") || "N/A";
  const amount = searchParams.get("amount") || "0";

  const [showDownloaded, setShowDownloaded] = useState(false);

  // In a real app we could fetch the full order from our DB here by ref.
  // For now we show the data passed in query + event info.

  if (!eventSlug || !event) {
    return <div className="p-12 text-center">Loading confirmation...</div>;
  }

  function handleDownloadTicket() {
    // Placeholder. In production this would fetch the PDF or trigger client download.
    // The PDF is already emailed. This is a convenience action.
    setShowDownloaded(true);

    // Simulate download delay + browser save
    setTimeout(() => {
      alert(`Ticket PDF for order #${ref} would download here.\n\n(In production: served from /api/tickets/${ref}.pdf or Supabase storage)`);
      setShowDownloaded(false);
    }, 650);
  }

  return (
    <div className="min-h-screen flex items-start justify-center py-12" style={{ background: '#FAF8F5' }}>
      <div className="w-full max-w-lg px-6">
        <div className="rounded-3xl bg-white shadow-sm border p-8 text-center card" style={{ borderColor: '#EDE4D3' }}>
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle className="h-9 w-9 text-emerald-600" />
          </div>

          <h1 className="text-3xl font-semibold tracking-tight">Purchase Confirmed</h1>
          <p className="mt-2 text-zinc-600">Thank you! Your tickets have been issued.</p>

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

          <button
            onClick={handleDownloadTicket}
            disabled={showDownloaded}
            className="flex w-full items-center justify-center gap-2 rounded-xl btn-gold py-3 font-medium disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {showDownloaded ? "Preparing PDF..." : "Download Ticket PDF"}
          </button>

          <p className="mt-4 text-xs text-zinc-500">
            A copy of your ticket has also been sent to your email.
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
