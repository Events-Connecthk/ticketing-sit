"use client";

import React, { useEffect, useState } from "react";
import jsQR from "jsqr";
import { PurchaseRecord, EventConfig, TicketType, BuyerFormField, DiscountCode } from "@/types";
import { getAllEvents, isSupabaseConfigured } from "@/lib/db/events";
import {
  adminSaveEvent,
  adminGetAllEvents,
  adminDeleteEvent,
  adminGetAllPurchases,
  adminSavePurchase,
} from "./actions";
import { getDefaultDemoEvent } from "@/lib/config/events";
import * as XLSX from "xlsx";
import { Download, Search, RefreshCw, Plus, Edit2, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { formatHkDateTime, formatHkTime } from "@/lib/time/hk";
import { BannerCropModal } from "@/components/admin/BannerCropModal";

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
    quantityAvailable: undefined,
    redemptionLimit: 1,
    validFrom: "",
    validTo: "",
    enabled: true,
  });

  // Separate state for time pickers (to support native date/time inputs)
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  // ===== Ticket Scanner (admin-only redemption) =====
  const [scanRef, setScanRef] = useState("");
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanMessage, setScanMessage] = useState("");
  /** ok | error | warn | info — controls result banner colour */
  const [scanTone, setScanTone] = useState<"ok" | "error" | "warn" | "info">("info");
  const [isScanningCamera, setIsScanningCamera] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  /** Prevents double-fire / stale scanRef blocking 2nd+ QR auto-redeem */
  const lastHandledQrRef = React.useRef<string>("");
  const scanBusyRef = React.useRef(false);

  async function loadPurchases() {
    setLoading(true);
    try {
      // Use server action with service_role for secure admin read
      const data = await adminGetAllPurchases({
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

  // Admin-only redemption (order ref OR ticket serial KPY-…-001)

  function getTicketType(eventSlug: string, ticketTypeId: string) {
    const event = events.find((e) => e.slug === eventSlug);
    return event?.ticketTypes?.find((t) => t.id === ticketTypeId);
  }

  function getTicketTypeLimit(eventSlug: string, ticketTypeId: string): number {
    return getTicketType(eventSlug, ticketTypeId)?.redemptionLimit ?? 1;
  }

  function setScanFeedback(
    message: string,
    tone: "ok" | "error" | "warn" | "info" = "info",
    result?: any
  ) {
    setScanMessage(message);
    setScanTone(tone);
    if (result !== undefined) setScanResult(result);
  }

  function getMaxRedemptionsForPurchase(p: any): number {
    if (!p.ticket_breakdown || p.ticket_breakdown.length === 0) return 1;
    let maxLimit = 1;
    for (const sel of p.ticket_breakdown) {
      maxLimit = Math.max(maxLimit, getTicketTypeLimit(p.event_slug, sel.ticketTypeId));
    }
    return maxLimit;
  }

  function getCurrentRedemptionCount(p: any): number {
    // Prefer sum of per-ticket redemptions when serials exist
    const units = p.ticket_breakdown || [];
    if (units.some((u: any) => u.serial)) {
      return units.reduce(
        (sum: number, u: any) => sum + (u.redemptions?.length || 0),
        0
      );
    }
    if (p.redemptions && p.redemptions.length > 0) return p.redemptions.length;
    return p.redeemed_at ? 1 : 0;
  }

  function getTotalTicketSlots(p: any): number {
    const units = p.ticket_breakdown || [];
    if (units.some((u: any) => u.serial)) return units.length;
    return (
      units.reduce((s: number, u: any) => s + (u.quantity || 1), 0) ||
      p.number_of_tickets ||
      1
    );
  }

  async function checkTicketStatus(ref: string) {
    if (!ref.trim()) return;
    setScanFeedback("Checking...", "info", null);

    const { purchaseMatchesRef, findTicketUnit, listSerials } = await import(
      "@/lib/tickets/serials"
    );
    const { isTicketValidOnDate, formatTicketDateWindow, hkTodayYmd } =
      await import("@/lib/tickets/validity");
    const all = await adminGetAllPurchases();
    const found = all.find((p: any) => purchaseMatchesRef(p, ref.trim()));

    if (!found) {
      setScanFeedback("❌ Invalid ticket — not found for that reference.", "error", null);
      return;
    }

    const unit = findTicketUnit(found, ref.trim());
    const serials = listSerials(found);
    const resultBase = { ...found, _scannedRef: ref.trim() };

    if (unit) {
      const tt = getTicketType(found.event_slug, unit.ticketTypeId);
      const max = tt?.redemptionLimit ?? 1;
      const count = unit.redemptions?.length || 0;
      const dateCheck = isTicketValidOnDate(tt || {}, hkTodayYmd());
      const window = formatTicketDateWindow(tt || {});

      if (count >= max) {
        setScanFeedback(
          `❌ Invalid ticket — fully redeemed (${count}/${max}). Serial ${unit.serial}.`,
          "error",
          resultBase
        );
        return;
      }
      if (!dateCheck.ok) {
        setScanFeedback(
          `❌ Invalid ticket — wrong date. ${dateCheck.reason}. Ticket window: ${window}.`,
          "error",
          resultBase
        );
        return;
      }
      setScanFeedback(
        `✅ VALID ${unit.serial} (${count}/${max} used) · dates: ${window}`,
        "ok",
        resultBase
      );
    } else {
      const maxSlots = getTotalTicketSlots(found);
      const count = getCurrentRedemptionCount(found);
      if (count >= maxSlots) {
        setScanFeedback(
          `❌ Invalid ticket — order fully checked in (${count}/${maxSlots}).`,
          "error",
          resultBase
        );
        return;
      }
      setScanFeedback(
        `Order ${found.order_reference}: ${count}/${maxSlots} used. Serials: ${serials.join(", ") || "—"}`,
        "info",
        resultBase
      );
    }
  }

  async function redeemTicket(ref: string) {
    if (!ref.trim()) return;
    const scanned = ref.trim();

    const { purchaseMatchesRef, findTicketUnit, listSerials } = await import(
      "@/lib/tickets/serials"
    );
    const { isTicketValidOnDate, formatTicketDateWindow, hkTodayYmd } =
      await import("@/lib/tickets/validity");
    const all = await adminGetAllPurchases();
    const found = all.find((p: any) => purchaseMatchesRef(p, scanned));

    if (!found) {
      setScanFeedback("❌ Invalid ticket — not found.", "error", null);
      return;
    }

    const now = new Date().toISOString();
    let unit = findTicketUnit(found, scanned);

    // Order-level scan with multiple tickets: require a specific serial
    if (!unit && listSerials(found).length > 1 && scanned === found.order_reference) {
      setScanFeedback(
        `⚠️ Multi-ticket order. Scan a ticket QR (e.g. ${listSerials(found)[0]}), not only the order ref.`,
        "warn",
        { ...found, _scannedRef: scanned }
      );
      return;
    }

    // Single-ticket order scanned by order ref → redeem that unit
    const breakdown = found.ticket_breakdown || [];
    if (!unit && breakdown.length === 1) {
      const only = breakdown[0] as {
        ticketTypeId: string;
        serial?: string;
        redemptions?: string[];
      };
      if (only?.serial) {
        unit = {
          ticketTypeId: only.ticketTypeId,
          quantity: 1 as const,
          serial: only.serial,
          redemptions: only.redemptions || [],
        };
      }
    }

    if (unit?.serial) {
      const tt = getTicketType(found.event_slug, unit.ticketTypeId);
      const max = tt?.redemptionLimit ?? 1;
      const count = unit.redemptions?.length || 0;
      const dateCheck = isTicketValidOnDate(tt || {}, hkTodayYmd());
      const window = formatTicketDateWindow(tt || {});

      if (count >= max) {
        setScanFeedback(
          `❌ Invalid ticket — already fully redeemed (${count}/${max}). Serial ${unit.serial}.`,
          "error",
          { ...found, _scannedRef: scanned }
        );
        return;
      }

      if (!dateCheck.ok) {
        setScanFeedback(
          `❌ Invalid ticket — cannot redeem today. ${dateCheck.reason}. Allowed: ${window}.`,
          "error",
          { ...found, _scannedRef: scanned }
        );
        return;
      }

      const nextBreakdown = (found.ticket_breakdown || []).map((t: any) => {
        if (t.serial !== unit!.serial) return t;
        return {
          ...t,
          redemptions: [...(t.redemptions || []), now],
        };
      });

      const updated = {
        ...found,
        ticket_breakdown: nextBreakdown,
        redeemed_at: now,
        redemptions: [...(found.redemptions || []), now],
      };

      const saved = await adminSavePurchase(updated as any);
      if (!saved) {
        setScanFeedback(
          "❌ Could not save check-in to database. Check service role key + schema.",
          "error",
          { ...updated, _scannedRef: unit.serial }
        );
        return;
      }
      setScanFeedback(
        `✅ Redeemed ${unit.serial} (${count + 1}/${max}) at ${formatHkTime(new Date())} (HK)`,
        "ok",
        { ...saved, _scannedRef: unit.serial }
      );
      await loadPurchases();
      return;
    }

    // Legacy order without serials
    const max = getMaxRedemptionsForPurchase(found);
    const currentCount = getCurrentRedemptionCount(found);
    if (currentCount >= max) {
      setScanFeedback(
        `❌ Invalid ticket — already fully redeemed (${currentCount}/${max}).`,
        "error",
        found
      );
      return;
    }
    const newRedemptions = [...(found.redemptions || []), now];
    const updated = {
      ...found,
      redemptions: newRedemptions,
      redeemed_at: now,
    };
    const saved = await adminSavePurchase(updated as any);
    if (!saved) {
      setScanFeedback(
        "❌ Could not save check-in to database. Check SUPABASE_SERVICE_ROLE_KEY and schema.",
        "error",
        updated
      );
      return;
    }
    setScanFeedback(
      `✅ Redeemed (${newRedemptions.length}/${max}) at ${formatHkTime(new Date())} (HK)`,
      "ok",
      saved
    );
    await loadPurchases();
  }

  // ===== Camera QR Scanner (only available to logged-in admins) =====
  async function startCameraScanner() {
    // Allow next QR even if same serial as previous (show fully-redeemed / wrong-date)
    lastHandledQrRef.current = "";
    scanBusyRef.current = false;
    setIsScanningCamera(true);
    setScanFeedback(
      "Starting camera… Point at a ticket QR. Each scan auto check-in (or shows invalid reason).",
      "info"
    );

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }, // prefer back camera
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);

        // Read refs (not React state) so 2nd+ scans are not blocked by stale scanRef
        scanIntervalRef.current = setInterval(() => {
          scanQRFromVideo();
        }, 300);
      }
    } catch (err) {
      console.error("Camera error:", err);
      setScanFeedback(
        "Could not access camera. Use manual entry instead (or grant camera permission).",
        "error"
      );
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
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsScanningCamera(false);
  }

  function scanQRFromVideo() {
    if (scanBusyRef.current) return;

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

    if (!code?.data) return;

    let extractedRef = code.data.trim();
    try {
      const url = new URL(code.data, window.location.origin);
      const refParam = url.searchParams.get("ref");
      if (refParam) extractedRef = refParam.trim();
    } catch {
      // raw ref
    }

    if (!extractedRef) return;
    // Ignore same code in consecutive frames (but allow after Start Camera again)
    if (extractedRef === lastHandledQrRef.current) return;

    lastHandledQrRef.current = extractedRef;
    scanBusyRef.current = true;

    setScanRef(extractedRef);
    stopCameraScanner(); // same as first scan — close camera every time
    setScanFeedback(`QR detected: ${extractedRef}. Checking in…`, "info");

    void (async () => {
      try {
        // Always attempt redeem; redeemTicket shows invalid + reason if not allowed
        await redeemTicket(extractedRef);
        await loadPurchases();
      } finally {
        scanBusyRef.current = false;
      }
    })();
  }

  // Reload purchases when viewing purchases or attendance
  useEffect(() => {
    if (isAuthenticated && (activeTab === "purchases" || activeTab === "attendance")) {
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

  // Restore session cookie after refresh (httpOnly cookie set by server)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { checkAdminSession } = await import("./actions");
        const ok = await checkAdminSession();
        if (!cancelled && ok) setIsAuthenticated(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      alert(
        "Incorrect password or login temporarily locked. Use ADMIN_PASSWORD from Vercel/env (not the public demo password)."
      );
    }
  }

  // Stop camera when signing out
  async function handleSignOut() {
    stopCameraScanner();
    try {
      const { logoutAdmin } = await import("./actions");
      await logoutAdmin();
    } catch {
      /* ignore */
    }
    setIsAuthenticated(false);
  }

  function formatDateTime(iso?: string) {
    return formatHkDateTime(iso);
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

    // Use admin save for demo data (service role)
    for (const p of demoPurchases) {
      await adminSavePurchase(p as any);
    }
    await loadPurchases();
  }

  // ===== Event Management Functions =====

  async function loadEvents() {
    setEventsLoading(true);
    try {
      // Service-role list so admin always sees what was just saved
      const data = await adminGetAllEvents();
      setEvents(data);
    } catch (e) {
      console.error(e);
      try {
        const fallback = await getAllEvents();
        setEvents(fallback);
      } catch {
        /* ignore */
      }
    } finally {
      setEventsLoading(false);
    }
  }

  async function seedDemoAtThePeak() {
    const demo = getDefaultDemoEvent();
    await adminSaveEvent(demo);
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
    setNewTicket({
      id: "",
      name: "",
      price: 0,
      currency: "HKD",
      maxPerOrder: 6,
      quantityAvailable: undefined,
      redemptionLimit: 1,
      enabled: true,
    });
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
    setNewTicket({
      id: "",
      name: "",
      price: 0,
      currency: "HKD",
      maxPerOrder: 6,
      quantityAvailable: undefined,
      redemptionLimit: 1,
      enabled: true,
    });

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

  // Reset form when modal closes
  function closeModal() {
    setShowEventModal(false);
    setEditingEvent(null);
    setStartTime("");
    setEndTime("");
  }

  // Banner crop modal state
  const [bannerCropSrc, setBannerCropSrc] = useState<string | null>(null);
  const [bannerCropName, setBannerCropName] = useState("banner.jpg");

  // Pick file → open crop UI (does not upload until Apply)
  function handleBannerImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file (JPG/PNG/WEBP)");
      e.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image too large (max 10MB)");
      e.target.value = "";
      return;
    }
    if (bannerCropSrc) URL.revokeObjectURL(bannerCropSrc);
    const url = URL.createObjectURL(file);
    setBannerCropSrc(url);
    setBannerCropName(file.name || "banner.jpg");
    e.target.value = "";
  }

  function closeBannerCrop() {
    if (bannerCropSrc) URL.revokeObjectURL(bannerCropSrc);
    setBannerCropSrc(null);
  }

  async function uploadCroppedBanner(file: File) {
    const slugForName = eventForm.slug || editingEvent?.slug || "event";
    const formData = new FormData();
    formData.append("file", file);
    formData.append("slug", slugForName);

    try {
      const { uploadEventBanner } = await import("./actions");
      const result = await uploadEventBanner(formData);

      if (result.success && result.path) {
        setEventForm((prev) => ({ ...prev, image: result.path! }));
        toast.success("Banner cropped & uploaded");
        closeBannerCrop();
      } else {
        toast.error(result.error || "Upload failed");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to upload image");
    }
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
      // Always send arrays so remove/add persists (never leave undefined)
      ticketTypes: [...ticketTypesForm],
      buyerFormFields: [...buyerFormFields],
      discountCodes: [...discountCodesForm],
    };

    try {
      const saved = await adminSaveEvent(newEvent);
      if (saved) {
        // Close first so UI never looks "stuck" on the form
        setShowEventModal(false);
        setEditingEvent(null);
        setStartTime("");
        setEndTime("");
        // Optimistic list update, then refresh from server
        setEvents((prev) => {
          const rest = prev.filter((e) => e.slug !== saved.slug);
          return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name));
        });
        toast.success(`Event "${newEvent.name}" saved successfully!`);
        void loadEvents();
        if (!usingSupabase) {
          toast.warning(
            "Saved to memory only — will disappear after refresh. Check Supabase keys + restart."
          );
        }
      } else {
        toast.error("Failed to save event to Supabase");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to save event");
    }
  }

  async function handleDeleteEvent(slug: string) {
    if (!confirm(`Delete event "${slug}"? This cannot be undone.`)) return;
    await adminDeleteEvent(slug);
    await loadEvents();
    toast.success("Event deleted");
  }

  async function handleToggleEvent(slug: string, currentEnabled: boolean) {
    const existing = events.find((e) => e.slug === slug);
    if (!existing) return;
    await adminSaveEvent({ ...existing, enabled: !currentEnabled });
    await loadEvents();
  }

  // Ticket types management inside modal
  function addTicketType() {
    if (!newTicket.name || !newTicket.id) {
      alert("Ticket ID and Name are required.");
      return;
    }
    const cap = newTicket.quantityAvailable;
    const t: TicketType = {
      id: newTicket.id.trim(),
      name: newTicket.name.trim(),
      price: Number(newTicket.price) || 0,
      currency: newTicket.currency || "HKD",
      maxPerOrder: newTicket.maxPerOrder || 6,
      quantityAvailable:
        cap != null && cap !== ("" as any) && !Number.isNaN(Number(cap)) && Number(cap) > 0
          ? Number(cap)
          : undefined,
      redemptionLimit: newTicket.redemptionLimit || 1,
      validFrom: newTicket.validFrom?.trim() || undefined,
      validTo: newTicket.validTo?.trim() || undefined,
      description: "",
      enabled: newTicket.enabled !== false,
    };
    setTicketTypesForm([...ticketTypesForm, t]);
    setNewTicket({
      id: "",
      name: "",
      price: 0,
      currency: "HKD",
      maxPerOrder: 6,
      quantityAvailable: undefined,
      redemptionLimit: 1,
      validFrom: "",
      validTo: "",
      enabled: true,
    });
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
    <div className="min-h-screen bg-zinc-50 overflow-x-hidden">
      {bannerCropSrc && (
        <BannerCropModal
          imageSrc={bannerCropSrc}
          fileName={bannerCropName}
          onCancel={closeBannerCrop}
          onConfirm={uploadCroppedBanner}
        />
      )}
      <div className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-semibold text-xl sm:text-2xl tracking-tight">Admin Dashboard</h1>
            <p className="text-xs sm:text-sm text-zinc-500">
              Ticketing System SIT — Purchases &amp; Events
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleSignOut}
              className="text-sm px-3 py-2 text-zinc-600 hover:text-black border rounded-lg sm:border-0"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Tabs — scroll on small screens */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6">
        <div className="flex border-b overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 gap-0">
          <button
            onClick={() => setActiveTab("purchases")}
            className={`shrink-0 px-3 sm:px-6 py-3 font-medium text-xs sm:text-sm border-b-2 transition-all whitespace-nowrap ${activeTab === "purchases" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            Purchases
          </button>
          <button
            onClick={() => setActiveTab("events")}
            className={`shrink-0 px-3 sm:px-6 py-3 font-medium text-xs sm:text-sm border-b-2 transition-all whitespace-nowrap ${activeTab === "events" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            Events
          </button>
          <button
            onClick={() => {
              setActiveTab("scanner");
              stopCameraScanner(); // ensure camera is off when leaving
            }}
            className={`shrink-0 px-3 sm:px-6 py-3 font-medium text-xs sm:text-sm border-b-2 transition-all whitespace-nowrap ${activeTab === "scanner" ? "border-emerald-600 text-emerald-700" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            Scanner
          </button>
          <button
            onClick={() => setActiveTab("attendance")}
            className={`shrink-0 px-3 sm:px-6 py-3 font-medium text-xs sm:text-sm border-b-2 transition-all whitespace-nowrap ${activeTab === "attendance" ? "border-blue-600 text-blue-700" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            Attendance
          </button>
        </div>
      </div>

      {/* PURCHASES / REGISTRATION TAB */}
      {activeTab === "purchases" && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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

            <div className="flex flex-wrap gap-2">
              <button onClick={exportToCSV} className="flex items-center gap-2 rounded-lg bg-black px-3 sm:px-4 py-2 text-sm text-white hover:bg-zinc-800">
                <Download className="h-4 w-4" /> <span className="sm:inline">Export Excel</span>
              </button>
              <button onClick={exportToCSVRaw} className="flex items-center gap-2 rounded-lg border px-3 sm:px-4 py-2 text-sm hover:bg-zinc-100">
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

          <div className="overflow-x-auto rounded-2xl border bg-white -mx-1 sm:mx-0">
            <table className="w-full text-sm min-w-[720px] md:min-w-0">
              <thead>
                <tr className="border-b bg-zinc-50 text-left">
                  <th className="p-3 sm:p-4 font-medium whitespace-nowrap">Date</th>
                  <th className="p-3 sm:p-4 font-medium">Name</th>
                  <th className="p-3 sm:p-4 font-medium hidden sm:table-cell">Email / Phone</th>
                  <th className="p-3 sm:p-4 font-medium text-center">#</th>
                  <th className="p-3 sm:p-4 font-medium text-right">Amount</th>
                  <th className="p-3 sm:p-4 font-medium">Event</th>
                  <th className="p-3 sm:p-4 font-medium hidden md:table-cell">Order Ref</th>
                  <th className="p-3 sm:p-4 font-medium min-w-[10rem] hidden lg:table-cell">Per-ticket check-ins</th>
                  <th className="p-3 sm:p-4 font-medium">Summary</th>
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
                  <tr key={purchase.id ?? idx} className="hover:bg-zinc-50/50 align-top">
                    <td className="p-3 sm:p-4 text-xs text-zinc-500 whitespace-nowrap">
                      {formatHkDateTime(purchase.bought_at)}
                    </td>
                    <td className="p-3 sm:p-4 font-medium">
                      <div>{purchase.name}</div>
                      <div className="text-xs text-zinc-500 sm:hidden break-all">
                        {purchase.email}
                      </div>
                    </td>
                    <td className="p-3 sm:p-4 hidden sm:table-cell">
                      <div className="break-all">{purchase.email}</div>
                      <div className="text-xs text-zinc-500">{purchase.phone}</div>
                    </td>
                    <td className="p-3 sm:p-4 text-center font-medium tabular-nums">
                      {(() => {
                        const units = purchase.ticket_breakdown || [];
                        if (units.some((u: any) => u.serial)) return units.length;
                        return (
                          units.reduce((s: number, u: any) => s + (u.quantity || 1), 0) ||
                          purchase.number_of_tickets ||
                          1
                        );
                      })()}
                    </td>
                    <td className="p-3 sm:p-4 text-right font-medium tabular-nums whitespace-nowrap">
                      {purchase.currency || "HKD"} {purchase.amount}
                    </td>
                    <td className="p-3 sm:p-4">
                      <span className="font-mono text-xs rounded bg-zinc-100 px-2 py-0.5">{purchase.event_slug}</span>
                    </td>
                    <td className="p-3 sm:p-4 font-mono text-xs text-zinc-600 hidden md:table-cell break-all">
                      {purchase.order_reference || purchase.payment_reference}
                    </td>
                    <td className="p-3 sm:p-4 text-xs hidden lg:table-cell">
                      {(() => {
                        const units = purchase.ticket_breakdown || [];
                        const hasSerials = units.some((u: any) => u.serial);

                        if (hasSerials) {
                          return (
                            <ul className="space-y-1.5 font-mono text-[11px] leading-snug">
                              {units.map((u: any, i: number) => {
                                const used = u.redemptions?.length || 0;
                                const max = getTicketTypeLimit(
                                  purchase.event_slug,
                                  u.ticketTypeId
                                );
                                const done = used >= max;
                                return (
                                  <li key={u.serial || i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                    <span className="text-zinc-700">{u.serial}</span>
                                    <span
                                      className={
                                        done
                                          ? "text-green-600 font-medium tabular-nums"
                                          : used > 0
                                            ? "text-amber-600 font-medium tabular-nums"
                                            : "text-zinc-400 tabular-nums"
                                      }
                                    >
                                      {used}/{max}
                                      {done ? " ✓" : used === 0 ? " open" : ""}
                                    </span>
                                    {used > 0 && u.redemptions?.[used - 1] && (
                                      <span className="text-[10px] text-zinc-400 font-sans">
                                        last {formatDateTime(u.redemptions[used - 1])}
                                      </span>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          );
                        }

                        // Legacy order (no per-ticket serials)
                        const used = getCurrentRedemptionCount(purchase);
                        const max = getMaxRedemptionsForPurchase(purchase);
                        return (
                          <span className="text-zinc-500">
                            Order-level only: {used}/{max}
                            <span className="block text-[10px] text-zinc-400 mt-0.5">
                              (no serials — re-purchase after serial fix for per-ticket tracking)
                            </span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="p-4 text-xs whitespace-nowrap">
                      {(() => {
                        const units = purchase.ticket_breakdown || [];
                        if (units.some((u: any) => u.serial)) {
                          const total = units.length;
                          const fullyIn = units.filter((u: any) => {
                            const used = u.redemptions?.length || 0;
                            const max = getTicketTypeLimit(purchase.event_slug, u.ticketTypeId);
                            return used >= max;
                          }).length;
                          const anyIn = units.filter((u: any) => (u.redemptions?.length || 0) > 0).length;
                          if (anyIn === 0) {
                            return <span className="text-gray-500">Valid (0/{total} in)</span>;
                          }
                          if (fullyIn >= total) {
                            return <span className="text-green-600 font-medium">All in ({fullyIn}/{total})</span>;
                          }
                          return (
                            <span className="text-amber-600 font-medium">
                              Partial ({anyIn} scanned / {fullyIn} full / {total} tickets)
                            </span>
                          );
                        }
                        return purchase.redeemed_at ? (
                          <span className="text-green-600">Redeemed</span>
                        ) : (
                          <span className="text-gray-500">Valid</span>
                        );
                      })()}
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
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
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="mb-6">
            <h2 className="text-xl sm:text-2xl font-semibold">Ticket Scanner</h2>
            <p className="text-sm text-zinc-600 mt-1">
              Only staff logged into the admin can mark tickets as redeemed. 
              Scanning here will instantly update the Purchases/Registration table and future Excel exports.
            </p>
          </div>

          <div className="bg-white rounded-2xl border p-4 sm:p-8">
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">
                Ticket ID or Order Ref (from PDF QR — prefer KPY-…-001)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={scanRef}
                  onChange={(e) => setScanRef(e.target.value.trim())}
                  placeholder="e.g. KPY-1783…-001 or order KPY-1783…"
                  className="flex-1 min-w-0 border rounded-lg px-4 py-2 font-mono text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void (async () => {
                        await checkTicketStatus(scanRef);
                        await redeemTicket(scanRef);
                        await loadPurchases();
                      })();
                    }
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

            {/* Result always above camera so layout stays stable on 2nd+ scans */}
            {(scanMessage || scanResult) && (
              <div
                className={`mb-4 p-4 rounded-lg border text-sm ${
                  scanTone === "ok"
                    ? "bg-emerald-50 border-emerald-200"
                    : scanTone === "error"
                      ? "bg-red-50 border-red-300"
                      : scanTone === "warn"
                        ? "bg-amber-50 border-amber-200"
                        : "bg-zinc-50 border-zinc-200"
                }`}
              >
                <div className="font-semibold mb-1">
                  {scanTone === "error"
                    ? "Invalid / blocked"
                    : scanTone === "ok"
                      ? "OK"
                      : scanTone === "warn"
                        ? "Attention"
                        : "Result"}
                </div>
                <div
                  className={
                    scanTone === "ok"
                      ? "text-emerald-800 font-medium"
                      : scanTone === "error"
                        ? "text-red-800 font-medium"
                        : scanTone === "warn"
                          ? "text-amber-900"
                          : "text-zinc-700"
                  }
                >
                  {scanMessage}
                </div>

                {scanResult && (
                  <div className="mt-3 text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    <div><strong>Name:</strong> {scanResult.name}</div>
                    <div><strong>Event:</strong> {scanResult.event_slug}</div>
                    <div>
                      <strong>Ref:</strong>{" "}
                      <span className="font-mono break-all">
                        {scanResult._scannedRef ||
                          scanResult.order_reference ||
                          scanRef}
                      </span>
                    </div>
                    <div><strong>Tickets:</strong> {scanResult.number_of_tickets}</div>
                    <div className="sm:col-span-2 mt-1">
                      {(() => {
                        const max = getMaxRedemptionsForPurchase(scanResult);
                        const count = getCurrentRedemptionCount(scanResult);
                        if (count >= max && max > 0) {
                          return (
                            <span className="text-red-700 font-medium">
                              FULLY REDEEMED {count}/{max}
                            </span>
                          );
                        }
                        if (count > 0) {
                          return (
                            <span className="text-emerald-700 font-medium">
                              CHECK-INS {count}/{max}
                            </span>
                          );
                        }
                        return (
                          <span className="text-amber-700">Not redeemed yet (0/{max})</span>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Camera Scanner */}
            <div className="mt-2 border-t pt-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                <div>
                  <div className="font-medium">Camera Scanner</div>
                  <div className="text-xs text-zinc-500">
                    Use your device camera. Result banner stays above so it does not jump under the video.
                  </div>
                </div>
                {!isScanningCamera ? (
                  <button
                    onClick={startCameraScanner}
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 shrink-0"
                  >
                    Start Camera
                  </button>
                ) : (
                  <button
                    onClick={stopCameraScanner}
                    className="px-4 py-2 rounded-lg border text-sm hover:bg-red-50 text-red-600 shrink-0"
                  >
                    Stop Camera
                  </button>
                )}
              </div>

              {isScanningCamera && (
                <div className="relative bg-black rounded-xl overflow-hidden">
                  <video
                    ref={videoRef}
                    className="w-full max-h-[320px] object-contain"
                    playsInline
                    muted
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-3 py-1 rounded">
                    Point camera at the QR code on the ticket
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 text-xs text-zinc-500">
              Date rules use Hong Kong calendar day. Fully redeemed or wrong-date tickets show a red warning and will not check in.
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

      {/* ATTENDANCE TAB — derived from purchases (no separate Supabase table) */}
      {activeTab === "attendance" && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Attendance</h2>
              <p className="text-sm text-zinc-600 mt-1">
                Check-ins from the Scanner. One row per ticket serial when available.
                Data comes from the <strong>purchases</strong> table (ticket_breakdown + redeemed_at) —{" "}
                <strong>no separate attendance table</strong> in Supabase.
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadPurchases()}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-zinc-100"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-left">
                  <th className="p-4 font-medium">Redeemed At</th>
                  <th className="p-4 font-medium">Ticket ID</th>
                  <th className="p-4 font-medium">Name</th>
                  <th className="p-4 font-medium">Email / Phone</th>
                  <th className="p-4 font-medium">Event</th>
                  <th className="p-4 font-medium">Order Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(() => {
                  // Flatten to one attendance row per redeemed serial (or legacy order)
                  type AttRow = {
                    key: string;
                    redeemedAt: string;
                    ticketId: string;
                    name: string;
                    email: string;
                    phone: string;
                    event: string;
                    orderRef: string;
                  };
                  const rows: AttRow[] = [];
                  for (const p of purchases) {
                    const units = p.ticket_breakdown || [];
                    const hasSerials = units.some((u: any) => u.serial);
                    if (hasSerials) {
                      for (const u of units as any[]) {
                        const last = u.redemptions?.[u.redemptions.length - 1];
                        if (!last) continue;
                        rows.push({
                          key: `${p.id}-${u.serial}-${last}`,
                          redeemedAt: last,
                          ticketId: u.serial,
                          name: p.name,
                          email: p.email,
                          phone: p.phone,
                          event: p.event_slug,
                          orderRef: p.order_reference || p.payment_reference || "",
                        });
                      }
                    } else if (getCurrentRedemptionCount(p) > 0) {
                      const latest =
                        p.redemptions?.[p.redemptions.length - 1] || p.redeemed_at || "";
                      rows.push({
                        key: String(p.id ?? p.order_reference),
                        redeemedAt: latest,
                        ticketId: p.order_reference || "—",
                        name: p.name,
                        email: p.email,
                        phone: p.phone,
                        event: p.event_slug,
                        orderRef: p.order_reference || p.payment_reference || "",
                      });
                    }
                  }
                  rows.sort((a, b) => b.redeemedAt.localeCompare(a.redeemedAt));

                  if (rows.length === 0) {
                    return (
                      <tr>
                        <td colSpan={6} className="p-10 text-center text-zinc-400">
                          {loading ? "Loading..." : "No redeemed tickets yet. Use Scanner → Mark Redeemed (or camera)."}
                        </td>
                      </tr>
                    );
                  }
                  return rows.map((row) => (
                    <tr key={row.key} className="hover:bg-zinc-50/50">
                      <td className="p-4 text-xs text-emerald-700 font-medium whitespace-nowrap">
                        {formatDateTime(row.redeemedAt)}
                      </td>
                      <td className="p-4 font-mono text-xs">{row.ticketId}</td>
                      <td className="p-4 font-medium">{row.name}</td>
                      <td className="p-4 text-sm">
                        <div>{row.email}</div>
                        <div className="text-xs text-zinc-500">{row.phone}</div>
                      </td>
                      <td className="p-4">
                        <span className="font-mono text-xs rounded bg-zinc-100 px-2 py-0.5">{row.event}</span>
                      </td>
                      <td className="p-4 font-mono text-xs text-zinc-600">{row.orderRef}</td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-zinc-500">
            Use the Scanner tab to check people in. Purchases/Registration shows status; this tab is the check-in log.
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
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="cursor-pointer inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-50">
                        Upload &amp; crop image
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleBannerImageUpload}
                        />
                      </label>
                      <span className="text-[10px] text-zinc-500">
                        Opens crop tool (pan, zoom, aspect). JPG/PNG/WEBP up to 10MB.
                      </span>
                    </div>
                    {eventForm.image && (
                      <div className="mt-1">
                        <div className="text-xs text-zinc-500 mb-1">Preview:</div>
                        <img
                          src={eventForm.image}
                          alt="Banner preview"
                          className="w-full max-h-40 rounded-lg border object-cover"
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
                  <p className="text-[10px] text-zinc-500 mt-1">
                    Hero banner on the event page. Crop before upload for clean mobile/desktop framing.
                  </p>
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
                              value={t.maxPerOrder ?? 6}
                              onChange={(e) => {
                                const val = Math.max(1, parseInt(e.target.value) || 6);
                                setTicketTypesForm(
                                  ticketTypesForm.map((tt) =>
                                    tt.id === t.id ? { ...tt, maxPerOrder: val } : tt
                                  )
                                );
                              }}
                              className="w-12 border rounded px-1 py-0.5 text-center"
                              min="1"
                              title="Max per order"
                            />
                            <span className="ml-0.5 text-zinc-500">max/order</span>
                          </div>
                          <div className="text-xs">
                            <input
                              type="number"
                              value={t.quantityAvailable ?? ""}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const val =
                                  raw === "" ? undefined : Math.max(0, parseInt(raw) || 0);
                                setTicketTypesForm(
                                  ticketTypesForm.map((tt) =>
                                    tt.id === t.id
                                      ? { ...tt, quantityAvailable: val }
                                      : tt
                                  )
                                );
                              }}
                              className="w-16 border rounded px-1 py-0.5 text-center"
                              min="0"
                              placeholder="∞"
                              title="Total available (empty = unlimited)"
                            />
                            <span className="ml-0.5 text-zinc-500">stock</span>
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
                        <div className="flex flex-wrap items-center gap-2 text-xs pl-0 sm:pl-1">
                          <span className="text-zinc-500 shrink-0">Valid dates (HK):</span>
                          <label className="flex items-center gap-1">
                            <span className="text-zinc-400">from</span>
                            <input
                              type="date"
                              value={t.validFrom || ""}
                              onChange={(e) =>
                                setTicketTypesForm(
                                  ticketTypesForm.map((tt) =>
                                    tt.id === t.id
                                      ? {
                                          ...tt,
                                          validFrom: e.target.value || undefined,
                                        }
                                      : tt
                                  )
                                )
                              }
                              className="border rounded px-1.5 py-0.5"
                              title="Valid from (inclusive). Empty = no start limit"
                            />
                          </label>
                          <label className="flex items-center gap-1">
                            <span className="text-zinc-400">to</span>
                            <input
                              type="date"
                              value={t.validTo || ""}
                              onChange={(e) =>
                                setTicketTypesForm(
                                  ticketTypesForm.map((tt) =>
                                    tt.id === t.id
                                      ? {
                                          ...tt,
                                          validTo: e.target.value || undefined,
                                        }
                                      : tt
                                  )
                                )
                              }
                              className="border rounded px-1.5 py-0.5"
                              title="Valid to (inclusive). Empty = no end limit"
                            />
                          </label>
                          {!t.validFrom && !t.validTo && (
                            <span className="text-zinc-400">any day</span>
                          )}
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
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
                      type="number"
                      placeholder="Max per order"
                      value={newTicket.maxPerOrder ?? 6}
                      onChange={(e) =>
                        setNewTicket({
                          ...newTicket,
                          maxPerOrder: Math.max(1, parseInt(e.target.value) || 6),
                        })
                      }
                      className="border px-3 py-2 rounded text-sm"
                      min="1"
                    />
                    <input
                      type="number"
                      placeholder="Stock (blank = ∞)"
                      value={newTicket.quantityAvailable ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setNewTicket({
                          ...newTicket,
                          quantityAvailable:
                            raw === "" ? undefined : Math.max(0, parseInt(raw) || 0),
                        });
                      }}
                      className="border px-3 py-2 rounded text-sm"
                      min="0"
                    />
                    <input
                      type="number"
                      placeholder="Redemptions"
                      value={newTicket.redemptionLimit ?? 1}
                      onChange={(e) => setNewTicket({ ...newTicket, redemptionLimit: parseInt(e.target.value) || 1 })}
                      className="border px-3 py-2 rounded text-sm"
                      min="1"
                    />
                    <label className="text-xs text-zinc-500 flex flex-col gap-0.5">
                      Valid from
                      <input
                        type="date"
                        value={newTicket.validFrom || ""}
                        onChange={(e) =>
                          setNewTicket({ ...newTicket, validFrom: e.target.value })
                        }
                        className="border px-2 py-1.5 rounded text-sm text-zinc-800"
                      />
                    </label>
                    <label className="text-xs text-zinc-500 flex flex-col gap-0.5">
                      Valid to
                      <input
                        type="date"
                        value={newTicket.validTo || ""}
                        onChange={(e) =>
                          setNewTicket({ ...newTicket, validTo: e.target.value })
                        }
                        className="border px-2 py-1.5 rounded text-sm text-zinc-800"
                      />
                    </label>
                    <button onClick={addTicketType} className="bg-white border rounded-lg text-sm hover:bg-white/80 col-span-2 md:col-span-1">
                      + Add Type
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-2">
                    Unique IDs per event. Stock = total tickets for sale (empty = unlimited).
                    Valid from/to = which calendar day(s) the scanner will accept (HK timezone). Empty = any day.
                  </p>
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
                      <div
                        key={idx}
                        className="p-2 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
                      >
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="font-mono font-medium">{dc.code}</span>
                          <span className="text-emerald-700">-{dc.percent}%</span>
                          {dc.description && (
                            <span className="text-zinc-500 text-xs">{dc.description}</span>
                          )}
                          <span className="text-[11px] text-zinc-500">
                            {dc.validFrom || dc.validUntil
                              ? `Valid ${dc.validFrom || "…"} → ${dc.validUntil || "…"} (HK)`
                              : "No expiry"}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                          <label className="text-[10px] text-zinc-500 flex items-center gap-1">
                            from
                            <input
                              type="date"
                              value={dc.validFrom || ""}
                              onChange={(e) => {
                                const v = e.target.value || undefined;
                                setDiscountCodesForm(
                                  discountCodesForm.map((c, i) =>
                                    i === idx ? { ...c, validFrom: v } : c
                                  )
                                );
                              }}
                              className="border rounded px-1 py-0.5 text-xs"
                            />
                          </label>
                          <label className="text-[10px] text-zinc-500 flex items-center gap-1">
                            until
                            <input
                              type="date"
                              value={dc.validUntil || ""}
                              onChange={(e) => {
                                const v = e.target.value || undefined;
                                setDiscountCodesForm(
                                  discountCodesForm.map((c, i) =>
                                    i === idx ? { ...c, validUntil: v } : c
                                  )
                                );
                              }}
                              className="border rounded px-1 py-0.5 text-xs"
                            />
                          </label>
                          <button
                            onClick={() =>
                              setDiscountCodesForm(
                                discountCodesForm.filter((_, i) => i !== idx)
                              )
                            }
                            className="text-red-500 text-xs"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border rounded p-3 bg-zinc-50 text-sm grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-2">
                  <input
                    id="dcCode"
                    placeholder="Code (e.g. SUMMER20)"
                    className="border px-2 py-1 rounded font-mono uppercase"
                  />
                  <input
                    id="dcPercent"
                    type="number"
                    placeholder="% off"
                    className="border px-2 py-1 rounded"
                  />
                  <input
                    id="dcDesc"
                    placeholder="Description (optional)"
                    className="border px-2 py-1 rounded md:col-span-2"
                  />
                  <label className="text-[10px] text-zinc-500 flex flex-col gap-0.5">
                    Valid until (closes)
                    <input
                      id="dcUntil"
                      type="date"
                      className="border px-2 py-1 rounded text-sm text-zinc-800"
                    />
                  </label>
                  <label className="text-[10px] text-zinc-500 flex flex-col gap-0.5">
                    Valid from (optional)
                    <input
                      id="dcFrom"
                      type="date"
                      className="border px-2 py-1 rounded text-sm text-zinc-800"
                    />
                  </label>
                  <button
                    onClick={() => {
                      const codeEl = document.getElementById(
                        "dcCode"
                      ) as HTMLInputElement;
                      const pctEl = document.getElementById(
                        "dcPercent"
                      ) as HTMLInputElement;
                      const descEl = document.getElementById(
                        "dcDesc"
                      ) as HTMLInputElement;
                      const untilEl = document.getElementById(
                        "dcUntil"
                      ) as HTMLInputElement;
                      const fromEl = document.getElementById(
                        "dcFrom"
                      ) as HTMLInputElement;

                      if (!codeEl?.value || !pctEl?.value)
                        return alert("Code and % required");

                      const newCode: DiscountCode = {
                        id: "dc-" + Date.now(),
                        code: codeEl.value.trim().toUpperCase(),
                        percent: parseInt(pctEl.value, 10) || 10,
                        description: descEl?.value?.trim() || undefined,
                        validUntil: untilEl?.value?.trim() || undefined,
                        validFrom: fromEl?.value?.trim() || undefined,
                      };
                      setDiscountCodesForm([...discountCodesForm, newCode]);
                      codeEl.value = "";
                      pctEl.value = "";
                      if (descEl) descEl.value = "";
                      if (untilEl) untilEl.value = "";
                      if (fromEl) fromEl.value = "";
                    }}
                    className="bg-white border rounded text-sm px-3 py-2"
                  >
                    + Add Code
                  </button>
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">
                  After “valid until”, buyers see “This discount isn’t available (expired).” Empty dates = always open.
                </p>
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
