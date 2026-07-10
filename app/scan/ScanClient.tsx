"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getPurchaseByReference } from "@/app/sit-admin/actions";

interface ScanClientProps {
  searchParams: Promise<{ ref?: string }>;
}

/**
 * Public scan page.
 * 
 * Anyone can scan the QR code on a ticket.
 * 
 * This page is now READ-ONLY for safety:
 * - It shows whether the ticket is valid or already redeemed.
 * - It does NOT automatically mark anything redeemed.
 * 
 * Only logged-in admins (via /sit-admin) should be able to actually redeem/check-in tickets.
 */
export default function ScanClient({ searchParams }: ScanClientProps) {
  const sp = useSearchParams();
  const [ref, setRef] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading ticket...");
  const [purchase, setPurchase] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    searchParams.then((p) => {
      if (mounted) setRef(p.ref || sp.get("ref") || null);
    });
    const fromHook = sp.get("ref");
    if (fromHook && !ref) setRef(fromHook);
    return () => { mounted = false; };
  }, [searchParams, sp]);

  useEffect(() => {
    if (!ref) return;

    setLoading(true);
    setMessage("Checking ticket...");

    getPurchaseByReference(ref).then((p) => {
      if (!p) {
        setMessage("Ticket not found. Invalid or unknown reference.");
        setPurchase(null);
      } else {
        const unit = (p.ticket_breakdown || []).find((t: any) => t.serial === ref);
        if (unit) {
          const count = unit.redemptions?.length || 0;
          setMessage(
            count > 0
              ? `Ticket ${unit.serial}: redeemed ${count} time(s)`
              : `Ticket ${unit.serial}: VALID — ready for check-in`
          );
        } else {
          const count = p.redemptions?.length || (p.redeemed_at ? 1 : 0);
          if (count > 0) {
            const latest = (p.redemptions?.[p.redemptions.length - 1] || p.redeemed_at) as string;
            const { formatHkDateTime } = await import("@/lib/time/hk");
            setMessage(
              `Order redeemed ${count} time${count > 1 ? "s" : ""} (last: ${formatHkDateTime(latest)} HK)`
            );
          } else {
            setMessage("Order is VALID. Admin should scan each ticket QR (…-001, …-002) at the door.");
          }
        }
        setPurchase(p);
      }
      setLoading(false);
    }).catch(() => {
      setMessage("Error checking ticket status.");
      setLoading(false);
    });
  }, [ref]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#FAF8F5' }}>
      <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow border text-center" style={{ borderColor: '#EDE4D3' }}>
        <h1 className="text-2xl font-semibold mb-4">Ticket Check</h1>
        
        <p className="mb-6 text-lg">{message}</p>

        {purchase && !loading && (
          <div className="text-left text-sm border-t pt-4 mt-4" style={{ borderColor: '#EDE4D3' }}>
            <p><strong>Attendee:</strong> {purchase.name}</p>
            <p><strong>Event:</strong> {purchase.event_slug}</p>
            <p><strong>Order:</strong> <span className="font-mono text-xs">{purchase.order_reference}</span></p>
            {ref && ref !== purchase.order_reference && (
              <p><strong>Scanned ID:</strong> <span className="font-mono text-xs">{ref}</span></p>
            )}
            {(purchase.ticket_breakdown || []).some((t: any) => t.serial) && (
              <p className="mt-2 text-xs text-zinc-500">
                Tickets:{" "}
                {(purchase.ticket_breakdown as any[])
                  .map((t) => t.serial)
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
            <p><strong>Tickets:</strong> {purchase.number_of_tickets}</p>
            <p><strong>Ref:</strong> <span className="font-mono">{ref}</span></p>
            {(() => {
              const count = purchase.redemptions?.length || (purchase.redeemed_at ? 1 : 0);
              if (count > 0) {
                return <p className="mt-2 text-green-600"><strong>Status:</strong> Redeemed {count} time{count > 1 ? 's' : ''}</p>;
              }
              return null;
            })()}
          </div>
        )}

        <div className="mt-8 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          This page only shows ticket status.<br />
          Redemption / check-in is performed by event staff using the admin scanner.
        </div>

        <p className="mt-6 text-xs text-zinc-500">
          Scan result for reference <span className="font-mono">{ref}</span>
        </p>
      </div>
    </div>
  );
}
