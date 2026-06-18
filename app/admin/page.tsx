"use client";

import React, { useEffect, useState } from "react";
import { PurchaseRecord, EventConfig, TicketType } from "@/types";
import { getAllPurchases } from "@/lib/db/purchases";
import { getAllEvents, saveEvent, deleteEvent, toggleEventEnabled, isSupabaseConfigured } from "@/lib/db/events";
import { getDefaultDemoEvent } from "@/lib/config/events";
import * as XLSX from "xlsx";
import { Download, Search, RefreshCw, Plus, Edit2, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

/**
 * Admin Dashboard
 *
 * Simple protected area for viewing all purchases.
 *
 * Protection: Very basic password gate using ADMIN_PASSWORD env (client demo).
 * For production: replace with proper auth (NextAuth, Clerk, or middleware + secure cookie).
 */

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "sit-admin-2026";

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("");

  // ===== NEW: Admin Tabs and Event Management =====
  const [activeTab, setActiveTab] = useState<"purchases" | "events">("purchases");

  const [events, setEvents] = useState<EventConfig[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventConfig | null>(null);
  const [usingSupabase, setUsingSupabase] = useState(false);

  // Event form state
  const [eventForm, setEventForm] = useState({
    slug: "",
    name: "",
    description: "",
    date: "",
    time: "",
    location: "",
    enabled: true,
  });
  const [ticketTypesForm, setTicketTypesForm] = useState<TicketType[]>([]);

  // Temporary new ticket type input
  const [newTicket, setNewTicket] = useState<Partial<TicketType>>({
    id: "",
    name: "",
    price: 0,
    currency: "HKD",
    maxPerOrder: 6,
    enabled: true,
  });

  // Separate state for time pickers (to support native date/time inputs)
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  async function loadPurchases() {
    setLoading(true);
    try {
      const data = await getAllPurchases({
        search: search || undefined,
        eventSlug: eventFilter || undefined,
      });
      setPurchases(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  // Ensure purchases are loaded when switching back to purchases tab
  useEffect(() => {
    if (isAuthenticated && activeTab === "purchases") {
      loadPurchases();
    }
  }, [isAuthenticated, activeTab]);

  useEffect(() => {
    if (isAuthenticated) {
      loadPurchases();
    }
  }, [isAuthenticated, search, eventFilter]);

  useEffect(() => {
    if (isAuthenticated && activeTab === "events") {
      loadEvents();
    }
  }, [isAuthenticated, activeTab]);

  // Check Supabase config once authenticated
  useEffect(() => {
    if (isAuthenticated) {
      setUsingSupabase(isSupabaseConfigured());
    }
  }, [isAuthenticated]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
      setPassword("");
    } else {
      alert("Incorrect password");
    }
  }

  function exportToCSV() {
    if (purchases.length === 0) return;

    const rows = purchases.map((p) => ({
      bought_at: p.bought_at,
      name: p.name,
      phone: p.phone,
      email: p.email,
      number_of_tickets: p.number_of_tickets,
      amount: p.amount,
      currency: p.currency,
      event_slug: p.event_slug,
      order_reference: p.order_reference,
      payment_reference: p.payment_reference,
      payment_method: p.payment_method,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Purchases");
    XLSX.writeFile(workbook, `purchases-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportToCSVRaw() {
    // Fallback pure CSV
    if (purchases.length === 0) return;
    const header = ["bought_at", "name", "phone", "email", "number_of_tickets", "amount", "currency", "event_slug", "order_reference"];
    const csvRows = [
      header.join(","),
      ...purchases.map((p) =>
        [
          p.bought_at,
          `"${p.name.replace(/"/g, '""')}"`,
          p.phone,
          p.email,
          p.number_of_tickets,
          p.amount,
          p.currency || "",
          p.event_slug,
          p.order_reference || "",
        ].join(",")
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchases-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Dev-only helper: Seed some demo purchases so admin isn't empty on first run
  async function seedDemoData() {
    if (process.env.NODE_ENV === "production") return;

    const demoPurchases = [
      {
        bought_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
        name: "Emma Chen",
        phone: "+852 9876 5432",
        email: "emma.chen@example.com",
        number_of_tickets: 2,
        payment_method: "wonder",
        amount: 700,
        currency: "HKD",
        event_slug: "at-the-peak",
        ticket_breakdown: [{ ticketTypeId: "ga", quantity: 2 }],
        order_reference: "DEV-1001",
        payment_reference: "WONDER-DEV-1001",
      },
      {
        bought_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
        name: "Marcus Lee",
        phone: "+852 9123 8888",
        email: "marcus.lee@gmail.com",
        number_of_tickets: 1,
        payment_method: "wonder",
        amount: 680,
        currency: "HKD",
        event_slug: "at-the-peak",
        ticket_breakdown: [{ ticketTypeId: "vip", quantity: 1 }],
        order_reference: "DEV-1002",
        payment_reference: "WONDER-DEV-1002",
      },
    ];

    // We call savePurchase multiple times (it will use memory when no Supabase)
    const { savePurchase } = await import("@/lib/db/purchases");
    for (const p of demoPurchases) {
      await savePurchase(p as any);
    }
    await loadPurchases();
  }

  // ===== Event Management Functions =====

  async function loadEvents() {
    setEventsLoading(true);
    try {
      const data = await getAllEvents();
      setEvents(data);
    } catch (e) {
      console.error(e);
    } finally {
      setEventsLoading(false);
    }
  }

  async function seedDemoAtThePeak() {
    const demo = getDefaultDemoEvent();
    await saveEvent(demo);
    await loadEvents();
  }

  // Open modal for new event
  function openNewEvent() {
    setEditingEvent(null);
    setEventForm({
      slug: "",
      name: "",
      description: "",
      date: "",
      time: "",
      location: "",
      enabled: true,
    });
    setTicketTypesForm([]);
    setNewTicket({ id: "", name: "", price: 0, currency: "HKD", maxPerOrder: 6, enabled: true });
    setStartTime("");
    setEndTime("");
    setShowEventModal(true);
  }

  // Open modal to edit existing
  function openEditEvent(ev: EventConfig) {
    setEditingEvent(ev);
    setEventForm({
      slug: ev.slug,
      name: ev.name,
      description: ev.description || "",
      date: ev.date || "",
      time: ev.time || "",
      location: ev.location || "",
      enabled: ev.enabled !== false,
    });
    setTicketTypesForm([...(ev.ticketTypes || [])]);
    setNewTicket({ id: "", name: "", price: 0, currency: "HKD", maxPerOrder: 6, enabled: true });

    // Parse time range if present (e.g. "18:30 – 23:00")
    if (ev.time) {
      const parts = ev.time.split(/[–-]/).map((p) => p.trim());
      if (parts.length >= 2) {
        setStartTime(parts[0]);
        setEndTime(parts[1]);
      } else {
        setStartTime(ev.time);
        setEndTime("");
      }
    } else {
      setStartTime("");
      setEndTime("");
    }

    setShowEventModal(true);
  }

  // Reset time pickers when modal closes (safety)
  function closeModal() {
    setShowEventModal(false);
    setStartTime("");
    setEndTime("");
  }

  async function handleSaveEvent() {
    if (!eventForm.slug.trim() || !eventForm.name.trim()) {
      alert("Slug and Name are required.");
      return;
    }

    // Build time string from pickers if available, otherwise fall back to form
    let timeValue = eventForm.time;
    if (startTime && endTime) {
      timeValue = `${startTime} – ${endTime}`;
    } else if (startTime) {
      timeValue = startTime;
    }

    const newEvent: EventConfig = {
      slug: eventForm.slug.trim().toLowerCase().replace(/\s+/g, "-"),
      name: eventForm.name.trim(),
      description: eventForm.description.trim(),
      date: eventForm.date,
      time: timeValue,
      location: eventForm.location,
      enabled: eventForm.enabled,
      ticketTypes: ticketTypesForm,
    };

    try {
      await saveEvent(newEvent);
      closeModal();
      await loadEvents();
      toast.success(`Event "${newEvent.name}" saved successfully!`);
      if (!usingSupabase) {
        toast.warning("Saved to memory only — will disappear after refresh. Check Supabase keys + restart.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to save event");
    }
  }

  async function handleDeleteEvent(slug: string) {
    if (!confirm(`Delete event "${slug}"? This cannot be undone.`)) return;
    await deleteEvent(slug);
    await loadEvents();
    toast.success("Event deleted");
  }

  async function handleToggleEvent(slug: string, currentEnabled: boolean) {
    await toggleEventEnabled(slug, !currentEnabled);
    await loadEvents();
  }

  // Ticket types management inside modal
  function addTicketType() {
    if (!newTicket.name || !newTicket.id) {
      alert("Ticket ID and Name are required.");
      return;
    }
    const t: TicketType = {
      id: newTicket.id.trim(),
      name: newTicket.name.trim(),
      price: Number(newTicket.price) || 0,
      currency: newTicket.currency || "HKD",
      maxPerOrder: newTicket.maxPerOrder || 6,
      description: "",
      enabled: newTicket.enabled !== false,
    };
    setTicketTypesForm([...ticketTypesForm, t]);
    setNewTicket({ id: "", name: "", price: 0, currency: "HKD", maxPerOrder: 6, enabled: true });
  }

  function removeTicketType(id: string) {
    setTicketTypesForm(ticketTypesForm.filter((t) => t.id !== id));
  }

  function toggleTicketType(id: string) {
    setTicketTypesForm(
      ticketTypesForm.map((t) =>
        t.id === id ? { ...t, enabled: !(t.enabled !== false) } : t
      )
    );
  }

  function updateTicketPrice(id: string, price: number) {
    setTicketTypesForm(ticketTypesForm.map((t) => (t.id === id ? { ...t, price } : t)));
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white">
        <div className="w-full max-w-sm px-6">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tighter">Ticketing System SIT</h1>
            <p className="text-zinc-400 mt-1">Admin Dashboard</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              placeholder="Enter admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-white/20 bg-zinc-900 px-5 py-3 text-white placeholder:text-zinc-500 focus:border-white outline-none"
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-white py-3 font-medium text-black hover:bg-zinc-200"
            >
              Sign In
            </button>
          </form>
          <p className="mt-6 text-center text-xs" style={{ color: '#6B5E50' }}>
            Protected area. Default demo password: <span className="font-mono text-[#2C2520]">sit-admin-2026</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-2xl tracking-tight">Admin Dashboard</h1>
            <p className="text-sm text-zinc-500">Ticketing System SIT — Purchases &amp; Event Management</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsAuthenticated(false)}
              className="text-sm px-3 py-2 text-zinc-600 hover:text-black"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-6 pt-6">
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab("purchases")}
            className={`px-6 py-3 font-medium text-sm border-b-2 transition-all ${activeTab === "purchases" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            Purchases
          </button>
          <button
            onClick={() => setActiveTab("events")}
            className={`px-6 py-3 font-medium text-sm border-b-2 transition-all ${activeTab === "events" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            Manage Events
          </button>
        </div>
      </div>

      {/* PURCHASES TAB */}
      {activeTab === "purchases" && (
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={loadPurchases}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-zinc-100"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>

              {process.env.NODE_ENV !== "production" && (
                <button
                  onClick={seedDemoData}
                  className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm hover:bg-amber-50 border-amber-300 text-amber-700"
                >
                  Seed Demo Data
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={exportToCSV} className="flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-zinc-800">
                <Download className="h-4 w-4" /> Export Excel
              </button>
              <button onClick={exportToCSVRaw} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-zinc-100">
                Export CSV
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-zinc-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email or phone..."
                className="w-full pl-10 rounded-xl border py-2.5 bg-white"
              />
            </div>
            <input
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              placeholder="Filter by event slug"
              className="rounded-xl border py-2.5 px-4 bg-white w-full sm:w-72"
            />
          </div>

          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-left">
                  <th className="p-4 font-medium">Date</th>
                  <th className="p-4 font-medium">Name</th>
                  <th className="p-4 font-medium">Email / Phone</th>
                  <th className="p-4 font-medium text-center">Tickets</th>
                  <th className="p-4 font-medium text-right">Amount</th>
                  <th className="p-4 font-medium">Event</th>
                  <th className="p-4 font-medium">Order Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading && (
                  <tr><td colSpan={7} className="p-10 text-center text-zinc-400">Loading purchases...</td></tr>
                )}
                {!loading && purchases.length === 0 && (
                  <tr><td colSpan={7} className="p-10 text-center text-zinc-400">No purchases found.</td></tr>
                )}
                {purchases.map((purchase, idx) => (
                  <tr key={purchase.id ?? idx} className="hover:bg-zinc-50/50">
                    <td className="p-4 text-xs text-zinc-500 whitespace-nowrap">
                      {new Date(purchase.bought_at).toLocaleString()}
                    </td>
                    <td className="p-4 font-medium">{purchase.name}</td>
                    <td className="p-4">
                      <div>{purchase.email}</div>
                      <div className="text-xs text-zinc-500">{purchase.phone}</div>
                    </td>
                    <td className="p-4 text-center font-medium tabular-nums">{purchase.number_of_tickets}</td>
                    <td className="p-4 text-right font-medium tabular-nums">
                      {purchase.currency || "HKD"} {purchase.amount}
                    </td>
                    <td className="p-4">
                      <span className="font-mono text-xs rounded bg-zinc-100 px-2 py-0.5">{purchase.event_slug}</span>
                    </td>
                    <td className="p-4 font-mono text-xs text-zinc-600">{purchase.order_reference || purchase.payment_reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-zinc-500">Data from memory or Supabase.</p>
        </div>
      )}

      {/* EVENTS TAB - Full Management */}
      {activeTab === "events" && (
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-xl font-semibold">Manage Events</h2>
              <div className="text-xs mt-1" style={{ color: usingSupabase ? '#16a34a' : '#dc2626' }}>
                Storage: {usingSupabase ? "Supabase (persisted)" : "In-memory only (lost on refresh)"}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={loadEvents}
                disabled={eventsLoading}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-zinc-100"
              >
                <RefreshCw className={`h-4 w-4 ${eventsLoading ? "animate-spin" : ""}`} /> Refresh
              </button>
              <button
                onClick={openNewEvent}
                className="btn-gold flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
              >
                <Plus className="h-4 w-4" /> Add New Event
              </button>
              {events.length === 0 && (
                <button
                  onClick={seedDemoAtThePeak}
                  className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm hover:bg-amber-50 border-amber-300 text-amber-700"
                >
                  Seed Demo "At The Peak"
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50">
                  <th className="p-4 text-left">Event</th>
                  <th className="p-4 text-left">Date / Location</th>
                  <th className="p-4 text-center">Ticket Types</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {eventsLoading && (
                  <tr><td colSpan={5} className="p-8 text-center text-zinc-400">Loading events...</td></tr>
                )}
                {!eventsLoading && events.length === 0 && (
                  <tr><td colSpan={5} className="p-8 text-center text-zinc-400">
                    No events yet.<br />
                    Click "Add New Event" or use the "Seed Demo" button above to get started.
                  </td></tr>
                )}
                {events.map((ev) => {
                  const isEnabled = ev.enabled !== false;
                  return (
                    <tr key={ev.slug} className="hover:bg-zinc-50/60">
                      <td className="p-4">
                        <div className="font-medium">{ev.name}</div>
                        <div className="font-mono text-xs text-zinc-500">{ev.slug}</div>
                      </td>
                      <td className="p-4 text-sm">
                        <div>{ev.date} {ev.time && `• ${ev.time}`}</div>
                        <div className="text-zinc-500">{ev.location}</div>
                      </td>
                      <td className="p-4 text-center">
                        <div className="text-xs text-zinc-500">
                          {ev.ticketTypes?.filter(t => t.enabled !== false).length || 0} active / {ev.ticketTypes?.length || 0} total
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleToggleEvent(ev.slug, isEnabled)}
                          className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border ${isEnabled ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-zinc-100 text-zinc-600 border-zinc-200"}`}
                        >
                          {isEnabled ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                          {isEnabled ? "ON" : "OFF"}
                        </button>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => openEditEvent(ev)}
                            className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-600"
                            title="Edit"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteEvent(ev.slug)}
                            className="p-2 rounded-lg hover:bg-red-50 text-red-600"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-zinc-500 mt-4">
            Changes are saved to Supabase (or memory in development). The public site immediately respects the enabled state and visible ticket types.
          </p>
        </div>
      )}

      {/* EVENT EDIT / CREATE MODAL */}
      {showEventModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-auto shadow-xl">
            <div className="p-6 border-b flex justify-between items-center">
              <h3 className="font-semibold text-xl">{editingEvent ? "Edit Event" : "Create New Event"}</h3>
              <button onClick={closeModal} className="text-zinc-400 hover:text-black">✕</button>
            </div>

            <div className="p-6 space-y-6">
              {/* Event Basics */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500">Slug (URL)</label>
                  <input
                    value={eventForm.slug}
                    onChange={(e) => setEventForm({ ...eventForm, slug: e.target.value })}
                    disabled={!!editingEvent}
                    placeholder="summer-gala-2026"
                    className="mt-1 w-full border rounded-lg px-3 py-2 disabled:bg-zinc-100 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Event Name</label>
                  <input
                    value={eventForm.name}
                    onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Date</label>
                  <input
                    type="date"
                    value={eventForm.date}
                    onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Start Time</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">End Time</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                    placeholder="optional"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-zinc-500">Location</label>
                  <input value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-zinc-500">Description</label>
                  <textarea
                    value={eventForm.description}
                    onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2 h-20"
                  />
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="enabled"
                    checked={eventForm.enabled}
                    onChange={(e) => setEventForm({ ...eventForm, enabled: e.target.checked })}
                  />
                  <label htmlFor="enabled" className="text-sm">Event is enabled (publicly visible)</label>
                </div>
              </div>

              {/* Ticket Types */}
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-semibold">Ticket Types</label>
                </div>

                {/* Existing ticket types */}
                {ticketTypesForm.length > 0 && (
                  <div className="border rounded-xl divide-y mb-4">
                    {ticketTypesForm.map((t, idx) => (
                      <div key={idx} className="p-3 flex flex-wrap md:flex-nowrap items-center gap-3 text-sm">
                        <div className="flex-1 font-medium">{t.name} <span className="font-mono text-xs text-zinc-400">({t.id})</span></div>
                        <div>
                          <input
                            type="number"
                            value={t.price}
                            onChange={(e) => updateTicketPrice(t.id, parseFloat(e.target.value) || 0)}
                            className="w-24 border rounded px-2 py-1 text-right"
                          />
                          <span className="ml-1 text-xs text-zinc-500">{t.currency}</span>
                        </div>
                        <button
                          onClick={() => toggleTicketType(t.id)}
                          className={`px-3 py-1 rounded text-xs ${t.enabled !== false ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"}`}
                        >
                          {t.enabled !== false ? "Enabled" : "Disabled"}
                        </button>
                        <button onClick={() => removeTicketType(t.id)} className="text-red-500 text-xs px-2">Remove</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new ticket type */}
                <div className="border rounded-xl p-4 bg-zinc-50">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <input
                      placeholder="ID (e.g. ga)"
                      value={newTicket.id}
                      onChange={(e) => setNewTicket({ ...newTicket, id: e.target.value })}
                      className="border px-3 py-2 rounded text-sm"
                    />
                    <input
                      placeholder="Name"
                      value={newTicket.name}
                      onChange={(e) => setNewTicket({ ...newTicket, name: e.target.value })}
                      className="border px-3 py-2 rounded text-sm"
                    />
                    <input
                      type="number"
                      placeholder="Price"
                      value={newTicket.price}
                      onChange={(e) => setNewTicket({ ...newTicket, price: parseFloat(e.target.value) || 0 })}
                      className="border px-3 py-2 rounded text-sm"
                    />
                    <input
                      placeholder="Currency"
                      value={newTicket.currency}
                      onChange={(e) => setNewTicket({ ...newTicket, currency: e.target.value })}
                      className="border px-3 py-2 rounded text-sm"
                    />
                    <button onClick={addTicketType} className="bg-white border rounded-lg text-sm hover:bg-white/80">
                      + Add Type
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-2">Ticket type IDs must be unique within the event.</p>
                </div>
              </div>
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={closeModal} className="px-5 py-2 rounded-lg border" style={{ borderColor: '#EDE4D3' }}>Cancel</button>
              <button onClick={handleSaveEvent} className="btn-gold px-6 py-2 rounded-lg">Save Event</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
