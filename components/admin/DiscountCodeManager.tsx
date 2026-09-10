"use client";

import React, { useEffect, useMemo, useState } from "react";
import { DiscountCode, EventConfig } from "@/types";
import {
  adminGetDiscountCodeUsage,
  adminSaveEventDetailed,
} from "@/app/sit-admin/actions";
import { generateBulkDiscountCodes } from "@/lib/tickets/discount-codes";
import { RefreshCw, Plus, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";

type Props = {
  events: EventConfig[];
  eventsLoading: boolean;
  onEventsChanged: () => void;
};

export function DiscountCodeManager({
  events,
  eventsLoading,
  onEventsChanged,
}: Props) {
  const [eventSlug, setEventSlug] = useState("");
  const [codes, setCodes] = useState<DiscountCode[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [stackMode, setStackMode] = useState<"single" | "stack">("single");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  // New single code
  const [newCode, setNewCode] = useState("");
  const [newPercent, setNewPercent] = useState("10");
  const [newMaxUses, setNewMaxUses] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newValidFrom, setNewValidFrom] = useState("");
  const [newValidUntil, setNewValidUntil] = useState("");

  // Bulk
  const [bulkCount, setBulkCount] = useState("20");
  const [bulkPercent, setBulkPercent] = useState("10");
  const [bulkMaxUses, setBulkMaxUses] = useState("1");
  const [bulkPrefix, setBulkPrefix] = useState("INF");
  const [bulkLabel, setBulkLabel] = useState("");

  const event = events.find((e) => e.slug === eventSlug) || null;

  useEffect(() => {
    if (!eventSlug && events.length > 0) {
      setEventSlug(events[0].slug);
    }
  }, [events, eventSlug]);

  const codesSnapshot = JSON.stringify(event?.discountCodes || []);
  useEffect(() => {
    if (!event) {
      setCodes([]);
      setUsage({});
      setStackMode("single");
      return;
    }
    setCodes([...(event.discountCodes || [])]);
    setStackMode(event.discountStackMode === "stack" ? "stack" : "single");
    void loadUsage(event.slug);
    // Reload when event or its codes change (manager is source of truth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSlug, event?.slug, codesSnapshot, event?.discountStackMode]);

  async function loadUsage(slug: string) {
    try {
      const u = await adminGetDiscountCodeUsage(slug);
      setUsage(u);
    } catch {
      setUsage({});
    }
  }

  const filtered = useMemo(() => {
    const f = filter.trim().toUpperCase();
    if (!f) return codes;
    return codes.filter(
      (c) =>
        c.code.includes(f) ||
        (c.label || "").toUpperCase().includes(f) ||
        (c.batchId || "").toUpperCase().includes(f) ||
        (c.description || "").toUpperCase().includes(f)
    );
  }, [codes, filter]);

  async function saveCodes(next: DiscountCode[], nextStack = stackMode) {
    if (!event) return;
    setBusy(true);
    try {
      const result = await adminSaveEventDetailed({
        ...event,
        discountCodes: next,
        discountStackMode: nextStack,
      });
      if (!result.ok) {
        toast.error(result.error || "Save failed");
        return;
      }
      setCodes(next);
      toast.success("Discount codes saved");
      onEventsChanged();
      await loadUsage(event.slug);
    } catch (e) {
      console.error(e);
      toast.error("Save failed");
    } finally {
      setBusy(false);
    }
  }

  function addSingle() {
    const code = newCode.trim().toUpperCase().replace(/\s+/g, "");
    if (!code) {
      toast.error("Enter a code");
      return;
    }
    if (codes.some((c) => c.code === code)) {
      toast.error("Code already exists on this event");
      return;
    }
    const percent = Math.max(0, Math.min(100, Number(newPercent) || 0));
    const maxUses =
      newMaxUses.trim() === ""
        ? undefined
        : Math.max(1, Math.floor(Number(newMaxUses) || 1));
    const row: DiscountCode = {
      id: `dc_${Date.now().toString(36)}`,
      code,
      percent,
      maxUses,
      label: newLabel.trim() || undefined,
      description: newLabel.trim() || undefined,
      validFrom: newValidFrom || undefined,
      validUntil: newValidUntil || undefined,
      enabled: true,
      stackable: false,
    };
    void saveCodes([row, ...codes]);
    setNewCode("");
    setNewLabel("");
  }

  function addBulk() {
    const count = Math.floor(Number(bulkCount) || 0);
    if (count < 1) {
      toast.error("Bulk count must be at least 1");
      return;
    }
    const { codes: created, batchId } = generateBulkDiscountCodes({
      existing: codes,
      count,
      percent: Number(bulkPercent) || 0,
      maxUses:
        bulkMaxUses.trim() === ""
          ? 1
          : Math.max(1, Math.floor(Number(bulkMaxUses) || 1)),
      prefix: bulkPrefix,
      label: bulkLabel.trim() || undefined,
      validFrom: newValidFrom || undefined,
      validUntil: newValidUntil || undefined,
      stackable: false,
    });
    void saveCodes([...created, ...codes]);
    toast.message(`Generated ${created.length} codes`, {
      description: `Batch ${batchId}`,
    });
  }

  async function copyCodes(list: DiscountCode[]) {
    const text = list.map((c) => c.code).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${list.length} code(s)`);
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Discount codes</h2>
        <p className="text-sm text-zinc-600 mt-1">
          Event-wide promo codes, bulk influencer codes, and usage counts.
          Checkout still applies <strong>one code per order</strong> (stacking
          reserved for later). Usage is counted from purchases.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-zinc-500">Event</label>
          <select
            value={eventSlug}
            onChange={(e) => setEventSlug(e.target.value)}
            className="mt-1 block border rounded-lg px-3 py-2 text-sm min-w-[14rem] bg-white"
          >
            <option value="">
              {eventsLoading ? "Loading…" : "Select event…"}
            </option>
            {events.map((ev) => (
              <option key={ev.slug} value={ev.slug}>
                {ev.name} ({ev.slug})
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={!event || busy}
          onClick={() => event && void loadUsage(event.slug)}
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-zinc-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          Refresh usage
        </button>
        <div>
          <label className="text-xs font-medium text-zinc-500">
            Code behaviour (event)
          </label>
          <select
            value={stackMode}
            onChange={(e) => {
              const v = e.target.value === "stack" ? "stack" : "single";
              setStackMode(v);
              void saveCodes(codes, v);
            }}
            disabled={!event || busy}
            className="mt-1 block border rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="single">
              One code only (cannot combine) — recommended
            </option>
            <option value="stack" disabled>
              Stack codes together (coming soon)
            </option>
          </select>
        </div>
      </div>

      {!event ? (
        <p className="text-sm text-zinc-500">Select an event to manage codes.</p>
      ) : (
        <>
          {/* Add single */}
          <div className="rounded-2xl border bg-white p-4 sm:p-5 space-y-3">
            <h3 className="font-semibold text-sm">Add event-wide code</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <label className="text-xs text-zinc-500 col-span-2">
                Code
                <input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  placeholder="SUMMER20"
                  className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm font-mono"
                />
              </label>
              <label className="text-xs text-zinc-500">
                % off
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={newPercent}
                  onChange={(e) => setNewPercent(e.target.value)}
                  className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-zinc-500">
                Max uses (blank = ∞)
                <input
                  type="number"
                  min={1}
                  value={newMaxUses}
                  onChange={(e) => setNewMaxUses(e.target.value)}
                  placeholder="∞"
                  className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-zinc-500 col-span-2">
                Label
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Campaign / note"
                  className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-zinc-500">
                Valid from
                <input
                  type="date"
                  value={newValidFrom}
                  onChange={(e) => setNewValidFrom(e.target.value)}
                  className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-zinc-500">
                Valid until
                <input
                  type="date"
                  value={newValidUntil}
                  onChange={(e) => setNewValidUntil(e.target.value)}
                  className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={addSingle}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 text-white px-3 py-2 text-sm hover:bg-zinc-800"
            >
              <Plus className="h-4 w-4" /> Add code
            </button>
          </div>

          {/* Bulk */}
          <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4 sm:p-5 space-y-3">
            <h3 className="font-semibold text-sm">
              Generate bulk personalized codes
            </h3>
            <p className="text-xs text-zinc-600">
              e.g. one unique code per influencer (max uses usually 1). Codes are
              unique for this event.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <label className="text-xs text-zinc-500">
                How many
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={bulkCount}
                  onChange={(e) => setBulkCount(e.target.value)}
                  className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm bg-white"
                />
              </label>
              <label className="text-xs text-zinc-500">
                % off
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={bulkPercent}
                  onChange={(e) => setBulkPercent(e.target.value)}
                  className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm bg-white"
                />
              </label>
              <label className="text-xs text-zinc-500">
                Max uses each
                <input
                  type="number"
                  min={1}
                  value={bulkMaxUses}
                  onChange={(e) => setBulkMaxUses(e.target.value)}
                  className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm bg-white"
                />
              </label>
              <label className="text-xs text-zinc-500">
                Prefix
                <input
                  value={bulkPrefix}
                  onChange={(e) =>
                    setBulkPrefix(e.target.value.toUpperCase())
                  }
                  className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm font-mono bg-white"
                />
              </label>
              <label className="text-xs text-zinc-500">
                Batch label
                <input
                  value={bulkLabel}
                  onChange={(e) => setBulkLabel(e.target.value)}
                  placeholder="Creator wave 1"
                  className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm bg-white"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={addBulk}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-700 text-white px-3 py-2 text-sm hover:bg-violet-800"
            >
              Generate &amp; save
            </button>
          </div>

          {/* List */}
          <div className="rounded-2xl border bg-white overflow-hidden">
            <div className="p-3 sm:p-4 border-b flex flex-wrap gap-2 items-center justify-between">
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter code / label / batch…"
                className="border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[12rem]"
              />
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 hover:bg-zinc-50"
                onClick={() => copyCodes(filtered)}
                disabled={filtered.length === 0}
              >
                <Copy className="h-3.5 w-3.5" /> Copy listed codes
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 bg-zinc-50 border-b">
                    <th className="p-3 font-medium">Code</th>
                    <th className="p-3 font-medium">%</th>
                    <th className="p-3 font-medium">Uses</th>
                    <th className="p-3 font-medium">Max</th>
                    <th className="p-3 font-medium">Label / batch</th>
                    <th className="p-3 font-medium">Window</th>
                    <th className="p-3 font-medium">On</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="p-8 text-center text-zinc-400"
                      >
                        No discount codes for this event yet.
                      </td>
                    </tr>
                  )}
                  {filtered.map((c) => {
                    const used = usage[c.code.toUpperCase()] || 0;
                    const max = c.maxUses;
                    const exhausted =
                      max != null && used >= Number(max);
                    return (
                      <tr key={c.id} className="align-top">
                        <td className="p-3 font-mono text-xs font-semibold">
                          {c.code}
                        </td>
                        <td className="p-3 tabular-nums">{c.percent}%</td>
                        <td
                          className={`p-3 tabular-nums font-medium ${
                            exhausted ? "text-red-700" : ""
                          }`}
                        >
                          {used}
                        </td>
                        <td className="p-3 tabular-nums text-zinc-500">
                          {max != null ? max : "∞"}
                        </td>
                        <td className="p-3 text-xs text-zinc-600">
                          <div>{c.label || c.description || "—"}</div>
                          {c.batchId && (
                            <div className="font-mono text-[10px] text-zinc-400">
                              {c.batchId}
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-xs text-zinc-500 whitespace-nowrap">
                          {c.validFrom || c.validUntil
                            ? `${c.validFrom || "…"} → ${c.validUntil || "…"}`
                            : "Always"}
                        </td>
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={c.enabled !== false}
                            onChange={(e) => {
                              const next = codes.map((x) =>
                                x.id === c.id
                                  ? { ...x, enabled: e.target.checked }
                                  : x
                              );
                              void saveCodes(next);
                            }}
                          />
                        </td>
                        <td className="p-3">
                          <button
                            type="button"
                            className="text-red-600 hover:bg-red-50 rounded p-1"
                            title="Delete code"
                            onClick={() => {
                              if (
                                !confirm(
                                  `Delete code ${c.code}? Past purchases keep their recorded code.`
                                )
                              ) {
                                return;
                              }
                              void saveCodes(
                                codes.filter((x) => x.id !== c.id)
                              );
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="p-3 text-[11px] text-zinc-500 border-t">
              {codes.length} code{codes.length === 1 ? "" : "s"} on this event ·
              showing {filtered.length}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
