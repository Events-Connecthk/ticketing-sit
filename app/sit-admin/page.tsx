"use client";

import React, { useEffect, useState } from "react";
import jsQR from "jsqr";
import { PurchaseRecord, EventConfig, TicketType, BuyerFormField, DiscountCode } from "@/types";
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

// Admin password is now verified via server action (see ./actions.ts).
// This prevents the secret from being shipped to the browser.

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("");

  // ===== NEW: Admin Tabs and Event Management =====
  const [activeTab, setActiveTab] = useState<"purchases" | "events" | "scanner" | "attendance">("purchases");

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
    endDate: "",
    time: "",
    location: "",
    image: "",
    enabled: true,
    paymentEnabled: true,
    ticketTemplate: "",
  });
  const [buyerFormFields, setBuyerFormFields] = useState<BuyerFormField[]>([]);
  const [ticketTypesForm, setTicketTypesForm] = useState<TicketType[]>([]);
  const [discountCodesForm, setDiscountCodesForm] = useState<DiscountCode[]>([]);

  // Temporary new ticket type input
  const [newTicket, setNewTicket] = useState<Partial<TicketType>>({
    id: "",
    name: "",
    price: 0,
    currency: "HKD",
    maxPerOrder: 6,
    redemptionLimit: 1,
    enabled: true,
  });

  // Separate state for time pickers (to support native date/time inputs)
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  // ===== Ticket Scanner (admin-only redemption) =====
  const [scanRef, setScanRef] = useState("");
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanMessage, setScanMessage] = useState("");
  const [isScanningCamera, setIsScanningCamera] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = React.useRef<any>(null);

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

  // Admin-only redemption functions (called only from the Scanner tab)

  // Helper: compute max redemptions allowed for a purchase based on its ticket types
  function getMaxRedemptionsForPurchase(p: any, eventsList: any[] = []): number {
    if (!p.ticket_breakdown || p.ticket_breakdown.length === 0) return 1;

    let maxLimit = 1;
    for (const sel of p.ticket_breakdown) {
      // Try to find the event to get ticket type details
      // For simplicity we use the current loaded events or fall back
      const event = events.find(e => e.slug === p.event_slug) || eventsList.find((e: any) => e.slug === p.event_slug);
      if (event?.ticketTypes) {
        const tt = event.ticketTypes.find((t: any) => t.id === sel.ticketTypeId);
        if (tt?.redemptionLimit) {
          maxLimit = Math.max(maxLimit, tt.redemptionLimit);
        }
      }
    }
    return maxLimit;
  }

  function getCurrentRedemptionCount(p: any): number {
    if (p.redemptions && p.redemptions.length > 0) return p.redemptions.length;
    return p.redeemed_at ? 1 : 0;
  }

  async function checkTicketStatus(ref: string) {
    if (!ref.trim()) return;
    setScanMessage("Checking...");
    setScanResult(null);

    const all = await getAllPurchases();
    const found = all.find((p: any) =>
      p.order_reference === ref || p.payment_reference === ref
    );

    if (!found) {
      setScanMessage("No ticket found for that reference.");
      setScanResult(null);
    } else {
      setScanResult(found);
      const max = getMaxRedemptionsForPurchase(found);
      const count = getCurrentRedemptionCount(found);
      if (count >= max) {
        setScanMessage(`Fully redeemed (${count}/${max} times)`);
      } else {
        setScanMessage(`Valid — ${count}/${max} redemptions used`);
      }
    }
  }

  async function redeemTicket(ref: string) {
    if (!ref.trim()) return;

    const all = await getAllPurchases();
    const foundIndex = all.findIndex((p: any) =>
      p.order_reference === ref || p.payment_reference === ref
    );

    if (foundIndex === -1) {
      setScanMessage("Ticket not found.");
      return;
    }

    const p = all[foundIndex];
    const max = getMaxRedemptionsForPurchase(p);
    const currentCount = getCurrentRedemptionCount(p);

    if (currentCount >= max) {
      setScanMessage(`This ticket has already been fully redeemed (${currentCount}/${max}).`);
      setScanResult(p);
      return;
    }

    // Build new redemptions array
    const newRedemptions = [...(p.redemptions || [])];
    const now = new Date().toISOString();
    newRedemptions.push(now);

    const updated = {
      ...p,
      redemptions: newRedemptions,
      // keep legacy redeemed_at for compatibility
      redeemed_at: now,
    };

    const { savePurchase } = await import("@/lib/db/purchases");
    await savePurchase(updated as any);

    setScanResult(updated);
    setScanMessage(`✅ Redeemed (${newRedemptions.length}/${max}) at ${new Date().toLocaleTimeString()}`);

    // Refresh the main purchases list so table + exports are up to date
    await loadPurchases();

    // Also clear input for next scan
    // setScanRef(""); // optional
  }

  // ===== Camera QR Scanner (only available to logged-in admins) =====
  async function startCameraScanner() {
    setIsScanningCamera(true);
    setScanMessage("Starting camera... Point at a ticket QR code.");
    setScanResult(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" } // prefer back camera
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        // Start decoding loop
        if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);

        scanIntervalRef.current = setInterval(() => {
          scanQRFromVideo();
        }, 300); // check ~3x per second
      }
    } catch (err) {
      console.error("Camera error:", err);
      setScanMessage("Could not access camera. Use manual entry instead (or grant camera permission).");
      setIsScanningCamera(false);
    }
  }

  function stopCameraScanner() {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsScanningCamera(false);
  }

  function scanQRFromVideo() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (code && code.data) {
      // Extract ref from URL or raw value
      let extractedRef = code.data;
      try {
        const url = new URL(code.data, window.location.origin);
        const refParam = url.searchParams.get("ref");
        if (refParam) extractedRef = refParam;
      } catch {
        // not a full URL, treat the data as the ref
      }

      if (extractedRef && extractedRef !== scanRef) {
        setScanRef(extractedRef);
        stopCameraScanner();
        setScanMessage(`QR detected: ${extractedRef}. Checking...`);
        // Auto check + offer redeem
        checkTicketStatus(extractedRef);
      }
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
    if (isAuthenticated && (activeTab === "events" || activeTab === "scanner" || activeTab === "attendance")) {
      loadEvents();
    }
    // Stop camera if user leaves the scanner tab
    if (activeTab !== "scanner") {
      stopCameraScanner();
    }
  }, [isAuthenticated, activeTab]);

  // Check Supabase config once authenticated
  useEffect(() => {
    if (isAuthenticated) {
      setUsingSupabase(isSupabaseConfigured());
    }
  }, [isAuthenticated]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    // Dynamic import to avoid static "use server" module dependency at the top of this "use client" file.
    // This helps prevent "use client" directive / server component misclassification errors during HMR.
    const { verifyAdminPassword } = await import("./actions");
    const ok = await verifyAdminPassword(password);
    if (ok) {
      setIsAuthenticated(true);
      setPassword("");
    } else {
      alert("Incorrect password");
    }
  }

  // Stop camera when signing out
  function handleSignOut() {
    stopCameraScanner();
    setIsAuthenticated(false);
  }

  function formatDateTime(iso?: string) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      // Use en-GB for readable format, browser will use user's local TZ (e.g. HK)
      return d.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
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
      status: p.redeemed_at ? "Redeemed" : "Valid",
      redeemed_at: formatDateTime(p.redeemed_at),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Purchases");
    XLSX.writeFile(workbook, `purchases-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportToCSVRaw() {
    // Fallback pure CSV
    if (purchases.length === 0) return;
    const header = ["bought_at", "name", "phone", "email", "number_of_tickets", "amount", "currency", "event_slug", "order_reference", "status", "redeemed_at"];
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
          p.redeemed_at ? "Redeemed" : "Valid",
          formatDateTime(p.redeemed_at) || "",
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
        payment_method: "kpay",
        amount: 700,
        currency: "HKD",
        event_slug: "at-the-peak",
        ticket_breakdown: [{ ticketTypeId: "ga", quantity: 2 }],
        order_reference: "DEV-1001",
        payment_reference: "KPAY-DEV-1001",
      },
      {
        bought_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
        name: "Marcus Lee",
        phone: "+852 9123 8888",
        email: "marcus.lee@gmail.com",
        number_of_tickets: 1,
        payment_method: "kpay",
        amount: 680,
        currency: "HKD",
        event_slug: "at-the-peak",
        ticket_breakdown: [{ ticketTypeId: "vip", quantity: 1 }],
        order_reference: "DEV-1002",
        payment_reference: "KPAY-DEV-1002",
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
      endDate: "",
      time: "",
      location: "",
      image: "",
      enabled: true,
      paymentEnabled: true,
      ticketTemplate: "",
    });
    setTicketTypesForm([]);
    setBuyerFormFields([]);
    setDiscountCodesForm([]);
    setNewTicket({ id: "", name: "", price: 0, currency: "HKD", maxPerOrder: 6, redemptionLimit: 1, enabled: true });
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
      endDate: ev.endDate || "",
      time: ev.time || "",
      location: ev.location || "",
      image: ev.image || "",
      enabled: ev.enabled !== false,
      paymentEnabled: ev.paymentEnabled !== false,
      ticketTemplate: ev.ticketTemplate || "",
    });
    setTicketTypesForm([...(ev.ticketTypes || [])]);
    setBuyerFormFields([...(ev.buyerFormFields || [])]);
    setDiscountCodesForm([...(ev.discountCodes || [])]);
    setNewTicket({ id: "", name: "", price: 0, currency: "HKD", maxPerOrder: 6, redemptionLimit: 1, enabled: true });

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

  // Handle banner image file upload (saves via server action to public/images/events/)
  async function handleBannerImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const slugForName = eventForm.slug || editingEvent?.slug || "event";

    const formData = new FormData();
    formData.append("file", file);
    formData.append("slug", slugForName);

    try {
      const { uploadEventBanner } = await import("./actions");
      const result = await uploadEventBanner(formData);

      if (result.success && result.path) {
        setEventForm((prev) => ({ ...prev, image: result.path! }));
        toast.success("Image uploaded");
      } else {
        toast.error(result.error || "Upload failed");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to upload image");
    }

    // reset the file input so same file can be selected again if needed
    e.target.value = "";
  }

  async function handleTicketTemplateUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error("Template too large (max 10MB for image or PDF) - the file you selected is " + (file.size / (1024*1024)).toFixed(1) + "MB");
      e.target.value = "";
      return;
    }

    const slugForName = eventForm.slug || editingEvent?.slug || "event";

    const formData = new FormData();
    formData.append("file", file);
    formData.append("slug", slugForName);

    try {
      const { uploadEventBanner } = await import("./actions");
      const result = await uploadEventBanner(formData);

      if (result.success && result.path) {
        setEventForm((prev) => ({ ...prev, ticketTemplate: result.path! }));
        toast.success("Ticket template background uploaded");
      } else {
        toast.error(result.error || "Upload failed");
      }
    } catch (err: any) {
      console.error(err);
      if (err?.message?.includes('Body exceeded') || err?.digest?.includes('413')) {
        toast.error("Body size limit error (still 1MB). Stop dev server, run 'Remove-Item -Recurse -Force .next', then 'npm run dev'. Make sure next.config.ts has experimental.serverActions.bodySizeLimit.");
      } else {
        toast.error("Failed to upload template: " + (err?.message || "unknown error"));
      }
    }

    e.target.value = "";
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
      endDate: eventForm.endDate || undefined,
      time: timeValue,
      location: eventForm.location,
      image: eventForm.image || undefined,
      enabled: eventForm.enabled,
      paymentEnabled: eventForm.paymentEnabled,
      ticketTemplate: eventForm.ticketTemplate || undefined,
      ticketTypes: ticketTypesForm,
      buyerFormFields: buyerFormFields.length > 0 ? buyerFormFields : undefined,
      discountCodes: discountCodesForm.length > 0 ? discountCodesForm : undefined,
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
      redemptionLimit: newTicket.redemptionLimit || 1,
      description: "",
      enabled: newTicket.enabled !== false,
    };
    setTicketTypesForm([...ticketTypesForm, t]);
    setNewTicket({ id: "", name: "", price: 0, currency: "HKD", maxPerOrder: 6, redemptionLimit: 1, enabled: true });
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

  function addDiscountToTicket(ticketId: string) {
    const name = prompt("Discount name (e.g. Early Bird, Student, Group 5+):");
    if (!name) return;
    const type = (prompt("Type: early_bird / student / group / custom", "early_bird") || "custom") as any;
    const valueStr = prompt("Discount % (e.g. 20 for 20% off):", "10");
    const value = parseInt(valueStr || "0", 10) || 0;
    const validUntil = type === 'early_bird' ? prompt("Valid until date (YYYY-MM-DD):") || undefined : undefined;
    const minQty = type === 'group' ? parseInt(prompt("Minimum tickets:") || "5", 10) : undefined;

    setTicketTypesForm(ticketTypesForm.map((t) => {
      if (t.id !== ticketId) return t;
      const discounts = [...(t.discounts || [])];
      discounts.push({
        id: 'd-' + Date.now(),
        name,
        type,
        value,
        validUntil: validUntil || undefined,
        minQuantity: minQty || undefined,
      });
      return { ...t, discounts };
    }));
  }

  function removeDiscount(ticketId: string, discountId: string) {
    setTicketTypesForm(ticketTypesForm.map((t) => {
      if (t.id !== ticketId) return t;
      return {
        ...t,
        discounts: (t.discounts || []).filter(d => d.id !== discountId),
      };
    }));
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
            Demo protection only. Set ADMIN_PASSWORD in .env.local (server-side).
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
              onClick={handleSignOut}
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
            Purchases/Registration
          </button>
          <button
            onClick={() => setActiveTab("events")}
            className={`px-6 py-3 font-medium text-sm border-b-2 transition-all ${activeTab === "events" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            Manage Events
          </button>
          <button
            onClick={() => {
              setActiveTab("scanner");
              stopCameraScanner(); // ensure camera is off when leaving
            }}
            className={`px-6 py-3 font-medium text-sm border-b-2 transition-all ${activeTab === "scanner" ? "border-emerald-600 text-emerald-700" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            🎟️ Ticket Scanner
          </button>
          <button
            onClick={() => setActiveTab("attendance")}
            className={`px-6 py-3 font-medium text-sm border-b-2 transition-all ${activeTab === "attendance" ? "border-blue-600 text-blue-700" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            📋 Attendance
          </button>
        </div>
      </div>

      {/* PURCHASES / REGISTRATION TAB */}
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
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium">Redeemed At</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading && (
                  <tr><td colSpan={9} className="p-10 text-center text-zinc-400">Loading purchases...</td></tr>
                )}
                {!loading && purchases.length === 0 && (
                  <tr><td colSpan={9} className="p-10 text-center text-zinc-400">No purchases found.</td></tr>
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
                    <td className="p-4 text-xs">
                      {purchase.redeemed_at ? (
                        <span className="text-green-600">Redeemed</span>
                      ) : (
                        <span className="text-gray-500">Valid</span>
                      )}
                    </td>
                    <td className="p-4 text-xs text-zinc-600 whitespace-nowrap">
                      {purchase.redeemed_at ? formatDateTime(purchase.redeemed_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-zinc-500">Data from memory or Supabase.</p>
          <p className="mt-1 text-[10px] text-zinc-400">
            Note: The internal database <code>id</code> (BIGSERIAL) keeps increasing even after deletes. 
            Use "Order Ref" (KPY-...) as the real identifier. See supabase-schema.sql for how to reset.
          </p>
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

      {/* SCANNER TAB — Admin-only redemption / check-in */}
      {activeTab === "scanner" && (
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold">Ticket Scanner</h2>
            <p className="text-sm text-zinc-600 mt-1">
              Only staff logged into the admin can mark tickets as redeemed. 
              Scanning here will instantly update the Purchases/Registration table and future Excel exports.
            </p>
          </div>

          <div className="bg-white rounded-2xl border p-8">
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Order Reference (from ticket or QR)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={scanRef}
                  onChange={(e) => setScanRef(e.target.value.trim())}
                  placeholder="e.g. KPY-1783052511276 or KPAY-..."
                  className="flex-1 border rounded-lg px-4 py-2 font-mono text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") checkTicketStatus(scanRef);
                  }}
                />
                <button
                  onClick={() => checkTicketStatus(scanRef)}
                  className="px-4 py-2 border rounded-lg hover:bg-zinc-50 text-sm"
                >
                  Check
                </button>
                <button
                  onClick={() => redeemTicket(scanRef)}
                  disabled={!scanRef}
                  className="btn-gold px-6 py-2 rounded-lg font-medium disabled:opacity-50"
                >
                  Mark Redeemed
                </button>
              </div>
            </div>

            {/* Camera Scanner */}
            <div className="mt-6 border-t pt-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-medium">Camera Scanner</div>
                  <div className="text-xs text-zinc-500">Use your device's camera to scan the QR on the ticket.</div>
                </div>
                {!isScanningCamera ? (
                  <button
                    onClick={startCameraScanner}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700"
                  >
                    📷 Start Camera
                  </button>
                ) : (
                  <button
                    onClick={stopCameraScanner}
                    className="px-4 py-2 rounded-lg border text-sm hover:bg-red-50 text-red-600"
                  >
                    Stop Camera
                  </button>
                )}
              </div>

              {isScanningCamera && (
                <div className="relative bg-black rounded-xl overflow-hidden">
                  <video ref={videoRef} className="w-full max-h-[320px] object-contain" playsInline muted />
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-3 py-1 rounded">
                    Point camera at the QR code on the ticket
                  </div>
                </div>
              )}
            </div>

            {/* Result */}
            {(scanMessage || scanResult) && (
              <div className="mt-6 p-4 rounded-lg bg-zinc-50 border text-sm">
                <div className="font-medium mb-1">Result</div>
                <div className={scanMessage.includes("✅") || scanMessage.includes("VALID") ? "text-emerald-700" : "text-zinc-700"}>
                  {scanMessage}
                </div>

                {scanResult && (
                  <div className="mt-3 text-xs grid grid-cols-2 gap-x-4 gap-y-1">
                    <div><strong>Name:</strong> {scanResult.name}</div>
                    <div><strong>Event:</strong> {scanResult.event_slug}</div>
                    <div><strong>Ref:</strong> <span className="font-mono">{scanResult.order_reference || scanRef}</span></div>
                    <div><strong>Tickets:</strong> {scanResult.number_of_tickets}</div>
                    <div className="col-span-2 mt-1">
                      {(() => {
                        const max = getMaxRedemptionsForPurchase(scanResult);
                        const count = getCurrentRedemptionCount(scanResult);
                        if (count > 0) {
                          return <span className="text-green-600 font-medium">REDEEMED {count}/{max} ✓</span>;
                        }
                        return <span className="text-amber-600">Not redeemed yet (0/{max})</span>;
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 text-xs text-zinc-500">
              Tip: Public visitors scanning the QR will now only see status (no changes). 
              Use this scanner (or type the ref) to officially check people in.
            </div>
          </div>

          <div className="mt-4 text-center">
            <button
              onClick={() => { setActiveTab("purchases"); loadPurchases(); }}
              className="text-sm text-zinc-600 hover:text-black underline"
            >
              View updated Purchases/Registration list →
            </button>
          </div>
        </div>
      )}

      {/* ATTENDANCE TAB - Redeemed tickets with timestamps */}
      {activeTab === "attendance" && (
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="mb-6">
            <h2 className="text-xl font-semibold">Attendance</h2>
            <p className="text-sm text-zinc-600 mt-1">
              List of redeemed tickets. Timestamps are shown in your local time.
              {` `}
              <span className="text-amber-600">Note:</span> Redemption limit is set per ticket type (see when adding tickets).
              Orders can be redeemed up to the highest limit of their ticket types.
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-left">
                  <th className="p-4 font-medium">Redeemed At</th>
                  <th className="p-4 font-medium">Name</th>
                  <th className="p-4 font-medium">Email / Phone</th>
                  <th className="p-4 font-medium">Event</th>
                  <th className="p-4 font-medium">Order Ref</th>
                  <th className="p-4 font-medium text-center">Tickets</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {purchases.filter(p => getCurrentRedemptionCount(p) > 0).length === 0 && (
                  <tr><td colSpan={6} className="p-10 text-center text-zinc-400">No redeemed tickets yet.</td></tr>
                )}
                {purchases
                  .filter(p => getCurrentRedemptionCount(p) > 0)
                  .sort((a, b) => {
                    const aLatest = (a.redemptions?.[a.redemptions.length-1] || a.redeemed_at || "");
                    const bLatest = (b.redemptions?.[b.redemptions.length-1] || b.redeemed_at || "");
                    return bLatest.localeCompare(aLatest);
                  })
                  .map((purchase, idx) => (
                    <tr key={purchase.id ?? idx} className="hover:bg-zinc-50/50">
                      <td className="p-4 text-xs text-emerald-700 font-medium whitespace-nowrap">
                        {(() => {
                          const count = getCurrentRedemptionCount(purchase);
                          const latest = purchase.redemptions?.[purchase.redemptions.length - 1] || purchase.redeemed_at;
                          return `${count}× (${formatDateTime(latest)})`;
                        })()}
                      </td>
                      <td className="p-4 font-medium">{purchase.name}</td>
                      <td className="p-4 text-sm">
                        <div>{purchase.email}</div>
                        <div className="text-xs text-zinc-500">{purchase.phone}</div>
                      </td>
                      <td className="p-4">
                        <span className="font-mono text-xs rounded bg-zinc-100 px-2 py-0.5">{purchase.event_slug}</span>
                      </td>
                      <td className="p-4 font-mono text-xs text-zinc-600">{purchase.order_reference || purchase.payment_reference}</td>
                      <td className="p-4 text-center font-medium tabular-nums">{purchase.number_of_tickets}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-zinc-500">Use the Scanner tab to mark more tickets as redeemed.</p>
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
                  <label className="text-xs font-medium text-zinc-500">Start Date</label>
                  <input
                    type="date"
                    value={eventForm.date}
                    onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">End Date (sales close)</label>
                  <input
                    type="date"
                    value={eventForm.endDate}
                    onChange={(e) => setEventForm({ ...eventForm, endDate: e.target.value })}
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

                {/* Event Banner Image */}
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-zinc-500">Event Banner Image</label>
                  <div className="mt-1 flex flex-col gap-2">
                    <input
                      value={eventForm.image || ""}
                      onChange={(e) => setEventForm({ ...eventForm, image: e.target.value })}
                      placeholder="/images/events/my-banner.jpg or https://example.com/banner.jpg"
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                    <div className="flex items-center gap-3">
                      <label className="cursor-pointer inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-50">
                        📷 Upload image
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleBannerImageUpload}
                        />
                      </label>
                      <span className="text-[10px] text-zinc-500">JPG, PNG, WEBP up to 5MB. Or paste a path/URL above.</span>
                    </div>
                    {eventForm.image && (
                      <div className="mt-1">
                        <div className="text-xs text-zinc-500 mb-1">Preview:</div>
                        <img
                          src={eventForm.image}
                          alt="Banner preview"
                          className="max-h-32 rounded-lg border object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setEventForm({ ...eventForm, image: "" })}
                          className="text-xs text-red-500 mt-1"
                        >
                          Remove image
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">This will be used as the hero banner on the event page.</p>
                </div>

                {/* Payment toggle */}
                <div className="flex items-center gap-2 pt-2 md:col-span-2">
                  <input
                    type="checkbox"
                    id="paymentEnabled"
                    checked={eventForm.paymentEnabled}
                    onChange={(e) => setEventForm({ ...eventForm, paymentEnabled: e.target.checked })}
                  />
                  <label htmlFor="paymentEnabled" className="text-sm">Require payment (uncheck for free registration-only events)</label>
                </div>

                {/* Custom Ticket Template Background (Image or PDF) */}
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-zinc-500">Custom Ticket Template Background (Image or PDF)</label>
                  <div className="mt-1 flex flex-col gap-2">
                    <input
                      value={eventForm.ticketTemplate || ""}
                      onChange={(e) => setEventForm({ ...eventForm, ticketTemplate: e.target.value })}
                      placeholder="/images/events/my-ticket-bg.pdf or .jpg (recommended size ~842x1190 pt)"
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                    <div className="flex items-center gap-3">
                      <label className="cursor-pointer inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-50">
                        📄 Upload background (image or PDF)
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          className="hidden"
                          onChange={handleTicketTemplateUpload}
                        />
                      </label>
                      <span className="text-[10px] text-zinc-500">JPG/PNG/WEBP or PDF, up to 10MB. Overlays (text/QR) drawn on top at fixed positions.</span>
                    </div>
                    {eventForm.ticketTemplate && (
                      <div className="mt-1">
                        <div className="text-xs text-zinc-500 mb-1">Preview:</div>
                        {eventForm.ticketTemplate.toLowerCase().endsWith(".pdf") ? (
                          <div className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 text-sm bg-zinc-50">
                            📄 PDF: {eventForm.ticketTemplate.split("/").pop()}
                          </div>
                        ) : (
                          <img
                            src={eventForm.ticketTemplate}
                            alt="Template preview"
                            className="max-h-32 rounded-lg border object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => setEventForm({ ...eventForm, ticketTemplate: "" })}
                          className="text-xs text-red-500 mt-1 block"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">Leave empty for plain white background. For best results with PDF, design at 842 × 1190 points.</p>
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
                      <div key={idx} className="p-3 flex flex-col gap-2 text-sm">
                        <div className="flex flex-wrap md:flex-nowrap items-center gap-3">
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
                          <div className="text-xs">
                            <input
                              type="number"
                              value={t.redemptionLimit ?? 1}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 1;
                                setTicketTypesForm(ticketTypesForm.map(tt => tt.id === t.id ? { ...tt, redemptionLimit: val } : tt));
                              }}
                              className="w-12 border rounded px-1 py-0.5 text-center"
                              min="1"
                            />
                            <span className="ml-0.5 text-zinc-500">redemptions</span>
                          </div>
                          <button
                            onClick={() => toggleTicketType(t.id)}
                            className={`px-3 py-1 rounded text-xs ${t.enabled !== false ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"}`}
                          >
                            {t.enabled !== false ? "Enabled" : "Disabled"}
                          </button>
                          <button onClick={() => removeTicketType(t.id)} className="text-red-500 text-xs px-2">Remove</button>
                          <button
                            onClick={() => addDiscountToTicket(t.id)}
                            className="text-xs px-2 py-1 border rounded hover:bg-white"
                          >
                            + Discount
                          </button>
                        </div>

                        {/* Discounts list */}
                        {t.discounts && t.discounts.length > 0 && (
                          <div className="pl-2 text-xs space-y-1">
                            {t.discounts.map((d) => (
                              <div key={d.id} className="flex items-center gap-2 bg-white px-2 py-0.5 rounded border text-[11px]">
                                <span>{d.name} (-{d.value}%)</span>
                                {d.type !== 'custom' && <span className="text-zinc-500">[{d.type}]</span>}
                                {d.validUntil && <span className="text-amber-600">until {d.validUntil}</span>}
                                {d.minQuantity && <span className="text-blue-600">min {d.minQuantity}</span>}
                                <button onClick={() => removeDiscount(t.id, d.id)} className="ml-auto text-red-400 hover:text-red-600">×</button>
                              </div>
                            ))}
                          </div>
                        )}
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
                    <input
                      type="number"
                      placeholder="Redemption limit (days)"
                      value={newTicket.redemptionLimit ?? 1}
                      onChange={(e) => setNewTicket({ ...newTicket, redemptionLimit: parseInt(e.target.value) || 1 })}
                      className="border px-3 py-2 rounded text-sm"
                      min="1"
                    />
                    <button onClick={addTicketType} className="bg-white border rounded-lg text-sm hover:bg-white/80">
                      + Add Type
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-2">Ticket type IDs must be unique within the event.</p>
                </div>
              </div>

              {/* Custom Buyer Form Fields */}
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-semibold">Custom Buyer Info Form (per event)</label>
                </div>
                <p className="text-xs text-zinc-500 mb-2">Different events can ask for different info (e.g. student ID, dietary, company).</p>

                {buyerFormFields.length > 0 && (
                  <div className="border rounded-xl divide-y mb-3 text-sm">
                    {buyerFormFields.map((f, idx) => (
                      <div key={idx} className="p-2 flex items-center gap-2">
                        <span className="font-medium flex-1">{f.label}</span>
                        <span className="text-xs text-zinc-500">{f.type}{f.required ? ' *' : ''}</span>
                        <button onClick={() => setBuyerFormFields(buyerFormFields.filter((_, i) => i !== idx))} className="text-red-500 text-xs">Remove</button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border rounded p-3 bg-zinc-50 text-sm grid grid-cols-1 md:grid-cols-5 gap-2">
                  <input id="newFieldLabel" placeholder="Label (e.g. Student ID)" className="border px-2 py-1 rounded" />
                  <select id="newFieldType" className="border px-2 py-1 rounded">
                    <option value="text">Text</option>
                    <option value="email">Email</option>
                    <option value="tel">Phone</option>
                    <option value="select">Select</option>
                    <option value="textarea">Textarea</option>
                  </select>
                  <input id="newFieldOptions" placeholder="Options (comma sep for select)" className="border px-2 py-1 rounded md:col-span-2" />
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" id="newFieldRequired" /> Required
                  </label>
                  <button
                    onClick={() => {
                      const labelEl = document.getElementById('newFieldLabel') as HTMLInputElement;
                      const typeEl = document.getElementById('newFieldType') as HTMLSelectElement;
                      const optsEl = document.getElementById('newFieldOptions') as HTMLInputElement;
                      const reqEl = document.getElementById('newFieldRequired') as HTMLInputElement;

                      if (!labelEl?.value) return alert("Label required");

                      const newField: BuyerFormField = {
                        id: 'f-' + Date.now(),
                        label: labelEl.value.trim(),
                        type: typeEl.value as any,
                        required: reqEl?.checked,
                        options: typeEl.value === 'select' && optsEl.value ? optsEl.value.split(',').map(s => s.trim()) : undefined,
                      };
                      setBuyerFormFields([...buyerFormFields, newField]);

                      // reset
                      labelEl.value = ''; optsEl.value = ''; if (reqEl) reqEl.checked = false;
                    }}
                    className="bg-white border rounded text-sm px-3"
                  >
                    + Add Field
                  </button>
                </div>
              </div>

              {/* Event-level Discount / Promo Codes (independent of ticket types) */}
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-semibold">Discount / Promo Codes</label>
                </div>
                <p className="text-xs text-zinc-500 mb-2">
                  Codes that apply to the whole order (users enter at checkout). Not tied to specific ticket types.
                </p>

                {discountCodesForm.length > 0 && (
                  <div className="border rounded-xl divide-y mb-3 text-sm">
                    {discountCodesForm.map((dc, idx) => (
                      <div key={idx} className="p-2 flex items-center gap-3">
                        <span className="font-mono font-medium">{dc.code}</span>
                        <span className="text-emerald-700">-{dc.percent}%</span>
                        {dc.description && <span className="text-zinc-500 text-xs">{dc.description}</span>}
                        <button
                          onClick={() => setDiscountCodesForm(discountCodesForm.filter((_, i) => i !== idx))}
                          className="ml-auto text-red-500 text-xs"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border rounded p-3 bg-zinc-50 text-sm grid grid-cols-1 md:grid-cols-5 gap-2">
                  <input id="dcCode" placeholder="Code (e.g. SUMMER20)" className="border px-2 py-1 rounded font-mono uppercase" />
                  <input id="dcPercent" type="number" placeholder="% off" className="border px-2 py-1 rounded" />
                  <input id="dcDesc" placeholder="Description (optional)" className="border px-2 py-1 rounded md:col-span-2" />
                  <button
                    onClick={() => {
                      const codeEl = document.getElementById('dcCode') as HTMLInputElement;
                      const pctEl = document.getElementById('dcPercent') as HTMLInputElement;
                      const descEl = document.getElementById('dcDesc') as HTMLInputElement;

                      if (!codeEl?.value || !pctEl?.value) return alert("Code and % required");

                      const newCode: DiscountCode = {
                        id: 'dc-' + Date.now(),
                        code: codeEl.value.trim().toUpperCase(),
                        percent: parseInt(pctEl.value, 10) || 10,
                        description: descEl?.value?.trim() || undefined,
                      };
                      setDiscountCodesForm([...discountCodesForm, newCode]);
                      codeEl.value = ''; pctEl.value = ''; if (descEl) descEl.value = '';
                    }}
                    className="bg-white border rounded text-sm px-3"
                  >
                    + Add Code
                  </button>
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
