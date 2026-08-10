"use client";

import React, { useEffect, useState } from "react";
import jsQR from "jsqr";
import {
  PurchaseRecord,
  EventConfig,
  TicketType,
  BuyerFormField,
  DiscountCode,
  DonationRecord,
  SeatDayCapacity,
} from "@/types";
import { getAllEvents, isSupabaseConfigured } from "@/lib/db/events";
import {
  adminSaveEvent,
  adminSaveEventDetailed,
  adminGetAllEvents,
  adminDeleteEvent,
  adminGetAllPurchases,
  adminGetAllDonations,
  adminSavePurchase,
  adminIssueManualTickets,
  adminListCheckinStaff,
  adminCreateCheckinStaff,
  adminSetCheckinStaffEnabled,
  adminDeleteCheckinStaff,
  adminResetCheckinStaffPassword,
  adminPerformCheckIn,
} from "./actions";
import { getDefaultDemoEvent } from "@/lib/config/events";
import * as XLSX from "xlsx";
import { Download, Search, RefreshCw, Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { formatHkDateTime, formatHkTime } from "@/lib/time/hk";
import { BannerCropModal } from "@/components/admin/BannerCropModal";
import { generateTicketPdf } from "@/lib/pdf/generate-ticket";
import {
  DEFAULT_PAGE_BG,
  DEFAULT_PRIMARY,
  DEFAULT_SECONDARY,
  DEFAULT_SURFACE,
  mergeThemeMetadata,
  readThemeFromMetadata,
} from "@/lib/tickets/event-theme";
import {
  redemptionAt,
  redemptionByName,
  redemptionRemark,
} from "@/lib/tickets/redemption";
import {
  defaultTicketDesign,
  getTicketDesignFromEvent,
  type TicketDesign,
} from "@/lib/tickets/ticket-design";
import { TicketDesignEditor } from "@/components/admin/TicketDesignEditor";
import { buildDayCapacityRows } from "@/lib/tickets/capacity";

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
  const [donations, setDonations] = useState<DonationRecord[]>([]);
  const [donationsLoading, setDonationsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [donationEventFilter, setDonationEventFilter] = useState("");

  // ===== NEW: Admin Tabs and Event Management =====
  const [activeTab, setActiveTab] = useState<
    | "dashboard"
    | "purchases"
    | "donations"
    | "events"
    | "scanner"
    | "attendance"
    | "issue"
    | "checkin-staff"
  >("purchases");

  /** Event stats dashboard */
  const [dashEventSlug, setDashEventSlug] = useState("");
  /** Hover info box on dashboard charts */
  const [dashTip, setDashTip] = useState<null | {
    chart: "sales" | "revenue" | "donut";
    leftPct: number;
    topPct: number;
    title: string;
    rows: Array<{ label: string; value: string }>;
  }>(null);

  /** Purchase row ticket PDF download in progress (order ref key) */
  const [downloadingTicketsKey, setDownloadingTicketsKey] = useState<string | null>(null);

  // ===== Manual ticket issue (cash / offline proof) =====
  const [issueEventSlug, setIssueEventSlug] = useState("");
  const [issueQtys, setIssueQtys] = useState<Record<string, number>>({});
  const [issueBuyerName, setIssueBuyerName] = useState("");
  const [issueBuyerPhone, setIssueBuyerPhone] = useState("");
  const [issueBuyerEmail, setIssueBuyerEmail] = useState("");
  const [issuePaymentMethod, setIssuePaymentMethod] = useState("cash");
  const [issueNote, setIssueNote] = useState("");
  const [issueAmountOverride, setIssueAmountOverride] = useState("");
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueResult, setIssueResult] = useState<{
    orderReference: string;
    paymentReference?: string;
    amount: number;
    ticketCount: number;
    eventSlug: string;
  } | null>(null);

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
    /** Optional donation at checkout */
    donationEnabled: false,
    donationDefaultAmount: 50,
    /** Empty = use default white-gold theme */
    primaryColor: "",
    secondaryColor: "",
    backgroundColor: "",
    surfaceColor: "",
  });
  const [buyerFormFields, setBuyerFormFields] = useState<BuyerFormField[]>([]);
  const [ticketTypesForm, setTicketTypesForm] = useState<TicketType[]>([]);
  const [discountCodesForm, setDiscountCodesForm] = useState<DiscountCode[]>([]);
  /** Shared day seating (multi-day tickets deduct from each day) */
  const [seatDaysForm, setSeatDaysForm] = useState<SeatDayCapacity[]>([]);

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
    isFree: false,
  });

  // Separate state for time pickers (to support native date/time inputs)
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  // ===== Ticket Scanner (admin-only redemption) =====
  const [scanRef, setScanRef] = useState("");
  const [scanRemark, setScanRemark] = useState("");
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanMessage, setScanMessage] = useState("");
  /** ok | error | warn | info - controls result banner colour */
  const [scanTone, setScanTone] = useState<"ok" | "error" | "warn" | "info">("info");

  // Check-in staff accounts (admin manages; staff use /check-in)
  const [checkinStaffList, setCheckinStaffList] = useState<
    Array<{
      id: string;
      username: string;
      display_name: string;
      enabled: boolean;
      created_at?: string;
    }>
  >([]);
  const [staffUser, setStaffUser] = useState("");
  const [staffDisplay, setStaffDisplay] = useState("");
  const [staffPass, setStaffPass] = useState("");
  const [staffBusy, setStaffBusy] = useState(false);
  const [ticketDesign, setTicketDesign] = useState<TicketDesign | null>(null);
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

  async function loadDonations() {
    setDonationsLoading(true);
    try {
      // Always load full list (dashboard analytics needs every event)
      const data = await adminGetAllDonations({});
      setDonations(data);
    } catch (e) {
      console.error(e);
    } finally {
      setDonationsLoading(false);
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

  /** Human labels for ticket types on a purchase, e.g. "Weekend x1, Day 2 x1" */
  function formatPurchaseTicketTypes(p: PurchaseRecord): string {
    const units = p.ticket_breakdown || [];
    if (units.length === 0) return "-";

    const counts = new Map<string, number>();
    for (const u of units as any[]) {
      const id = String(u.ticketTypeId || "unknown");
      const q = u.serial ? 1 : Math.max(1, Number(u.quantity) || 1);
      counts.set(id, (counts.get(id) || 0) + q);
    }

    return Array.from(counts.entries())
      .map(([id, q]) => {
        const name = getTicketType(p.event_slug, id)?.name || id;
        return q > 1 ? `${name} x${q}` : name;
      })
      .join(", ");
  }

  function publicEventUrl(slug: string): string {
    const base = (
      process.env.NEXT_PUBLIC_SITE_URL ||
      (typeof window !== "undefined" ? window.location.origin : "") ||
      "https://ticketing-sit.connecthk.org"
    ).replace(/\/$/, "");
    return `${base}/${slug}`;
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy");
    }
  }

  function purchaseRowKey(p: PurchaseRecord): string {
    return String(p.id ?? p.order_reference ?? p.payment_reference ?? "");
  }

  /** Download ticket PDF(s) for a purchase - same as user success page (for resend when email fails). */
  async function handleAdminDownloadTickets(purchase: PurchaseRecord) {
    const key = purchaseRowKey(purchase);
    const orderRef =
      purchase.order_reference || purchase.payment_reference || "ticket";
    const event = events.find((e) => e.slug === purchase.event_slug);
    if (!event) {
      toast.error("Event config not loaded. Open Events or refresh, then try again.");
      if (events.length === 0) void loadEvents();
      return;
    }

    const units = purchase.ticket_breakdown || [];
    if (units.length === 0) {
      toast.error("No ticket breakdown on this purchase.");
      return;
    }

    setDownloadingTicketsKey(key);
    try {
      const buyer = {
        name: purchase.name,
        phone: purchase.phone,
        email: purchase.email,
      };
      const currency =
        purchase.currency || event.ticketTypes?.[0]?.currency || "HKD";
      const hasSerials = units.some((u: any) => u.serial);

      const jobs: Array<{ unit: any; serial?: string }> = [];
      if (hasSerials) {
        for (const u of units as any[]) {
          if (u.serial) jobs.push({ unit: u, serial: u.serial });
        }
      } else {
        jobs.push({ unit: units[0] });
      }

      if (jobs.length === 0) {
        toast.error("No tickets to download.");
        return;
      }

      let ok = 0;
      for (const job of jobs) {
        const pdfResult = await generateTicketPdf({
          event,
          buyer,
          tickets: [
            {
              ticketTypeId: job.unit.ticketTypeId,
              quantity: job.unit.serial
                ? 1
                : Math.max(1, Number(job.unit.quantity) || 1),
            },
          ],
          orderReference: orderRef,
          amount: Number(purchase.amount) || 0,
          currency,
          purchaseDate: purchase.bought_at || new Date().toISOString(),
          ticketSerial: job.serial,
        });

        if (pdfResult.success && pdfResult.pdfBuffer) {
          const blob = new Blob([pdfResult.pdfBuffer as any], {
            type: "application/pdf",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download =
            pdfResult.filename ||
            `ticket-${job.serial || orderRef}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          ok += 1;
          // Brief gap so browsers don't block multi-file downloads
          if (jobs.length > 1) {
            await new Promise((r) => setTimeout(r, 280));
          }
        }
      }

      if (ok === 0) {
        toast.error("Failed to generate ticket PDF.");
      } else if (ok === 1) {
        toast.success("Ticket PDF downloaded.");
      } else {
        toast.success(`${ok} ticket PDFs downloaded.`);
      }
    } catch (err) {
      console.error(err);
      toast.error("Error generating ticket PDF.");
    } finally {
      setDownloadingTicketsKey(null);
    }
  }

  const DASH_COLORS = [
    "#0f766e",
    "#b45309",
    "#1d4ed8",
    "#be123c",
    "#7c3aed",
    "#047857",
    "#c2410c",
    "#0369a1",
  ];

  /** Aggregate stats + chart data for the Dashboard tab (one event). */
  function buildEventDashboard(eventSlug: string) {
    const event = events.find((e) => e.slug === eventSlug) || null;
    const rows = purchases.filter((p) => p.event_slug === eventSlug);
    const donRows = donations.filter((d) => d.event_slug === eventSlug);

    const soldByType: Record<string, number> = {};
    let ticketsSold = 0;
    let revenue = 0;
    const byDay = new Map<
      string,
      {
        tickets: number;
        revenue: number;
        orders: number;
        donations: number;
        donationCount: number;
      }
    >();

    const dayBucket = (day: string) =>
      byDay.get(day) || {
        tickets: 0,
        revenue: 0,
        orders: 0,
        donations: 0,
        donationCount: 0,
      };

    for (const p of rows) {
      revenue += Number(p.amount) || 0;
      const units = p.ticket_breakdown || [];
      let orderTickets = 0;
      if (units.length > 0) {
        for (const u of units as any[]) {
          const id = String(u.ticketTypeId || "unknown");
          const q = u.serial ? 1 : Math.max(1, Number(u.quantity) || 1);
          soldByType[id] = (soldByType[id] || 0) + q;
          orderTickets += q;
        }
      } else {
        orderTickets = Math.max(1, Number(p.number_of_tickets) || 1);
        soldByType["_order"] = (soldByType["_order"] || 0) + orderTickets;
      }
      ticketsSold += orderTickets;

      const day = (p.bought_at || "").slice(0, 10) || "unknown";
      const prev = dayBucket(day);
      byDay.set(day, {
        ...prev,
        tickets: prev.tickets + orderTickets,
        revenue: prev.revenue + (Number(p.amount) || 0),
        orders: prev.orders + 1,
      });
    }

    let donationTotal = 0;
    for (const d of donRows) {
      const amt = Number(d.amount) || 0;
      donationTotal += amt;
      const day = (d.donated_at || "").slice(0, 10) || "unknown";
      const prev = dayBucket(day);
      byDay.set(day, {
        ...prev,
        donations: prev.donations + amt,
        donationCount: prev.donationCount + 1,
      });
    }
    const donationCount = donRows.length;
    const donationAvg =
      donationCount > 0 ? donationTotal / donationCount : 0;
    const combinedTotal = revenue + donationTotal;

    const typeRows = (event?.ticketTypes || []).map((tt, i) => {
      const sold = soldByType[tt.id] || 0;
      const cap =
        tt.quantityAvailable != null && !Number.isNaN(Number(tt.quantityAvailable))
          ? Number(tt.quantityAvailable)
          : null;
      const left = cap == null ? null : Math.max(0, cap - sold);
      return {
        id: tt.id,
        name: tt.name,
        sold,
        cap,
        left,
        color: DASH_COLORS[i % DASH_COLORS.length],
      };
    });

    // Types sold that are no longer on the event config
    for (const [id, sold] of Object.entries(soldByType)) {
      if (id === "_order") continue;
      if (typeRows.some((t) => t.id === id)) continue;
      typeRows.push({
        id,
        name: id,
        sold,
        cap: null,
        left: null,
        color: DASH_COLORS[typeRows.length % DASH_COLORS.length],
      });
    }
    if (soldByType["_order"]) {
      typeRows.push({
        id: "_order",
        name: "Unspecified (legacy)",
        sold: soldByType["_order"],
        cap: null,
        left: null,
        color: "#71717a",
      });
    }

    const timeline = Array.from(byDay.entries())
      .filter(([d]) => d !== "unknown")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    // FR 6.6: per event-day capacity (shared pool), derived remaining
    const dayCapacityRows = event
      ? buildDayCapacityRows(event, rows)
      : [];

    return {
      event,
      orderCount: rows.length,
      ticketsSold,
      revenue,
      donationTotal,
      donationCount,
      donationAvg,
      combinedTotal,
      donationEnabled: Boolean(event?.donationEnabled),
      typeRows,
      timeline,
      dayCapacityRows,
    };
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
      setScanFeedback("❌ Invalid ticket - not found for that reference.", "error", null);
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
          `❌ Invalid ticket - fully redeemed (${count}/${max}). Serial ${unit.serial}.`,
          "error",
          resultBase
        );
        return;
      }
      if (!dateCheck.ok) {
        setScanFeedback(
          `❌ Invalid ticket - wrong date. ${dateCheck.reason}. Ticket window: ${window}.`,
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
          `❌ Invalid ticket - order fully checked in (${count}/${maxSlots}).`,
          "error",
          resultBase
        );
        return;
      }
      setScanFeedback(
        `Order ${found.order_reference}: ${count}/${maxSlots} used. Serials: ${serials.join(", ") || "-"}`,
        "info",
        resultBase
      );
    }
  }

  async function redeemTicket(ref: string) {
    if (!ref.trim()) return;
    const scanned = ref.trim();
    const res = await adminPerformCheckIn(scanned, scanRemark || undefined);
    setScanFeedback(
      res.ok ? `✅ ${res.message}` : res.message.startsWith("⚠") ? res.message : `❌ ${res.message}`,
      res.tone,
      res.purchase
        ? { ...res.purchase, _scannedRef: res.serial || scanned }
        : null
    );
    if (res.ok) {
      setScanRemark("");
      await loadPurchases();
    }
  }

  async function loadCheckinStaff() {
    try {
      const list = await adminListCheckinStaff();
      setCheckinStaffList(list);
    } catch {
      setCheckinStaffList([]);
    }
  }

  async function handleCreateCheckinStaff(e: React.FormEvent) {
    e.preventDefault();
    setStaffBusy(true);
    try {
      const res = await adminCreateCheckinStaff({
        username: staffUser,
        displayName: staffDisplay || staffUser,
        password: staffPass,
      });
      if (!res.ok) {
        toast.error(res.error || "Failed to create staff");
        return;
      }
      toast.success(`Check-in account created: ${res.staff?.username}`);
      setStaffUser("");
      setStaffDisplay("");
      setStaffPass("");
      await loadCheckinStaff();
    } finally {
      setStaffBusy(false);
    }
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
    stopCameraScanner(); // same as first scan - close camera every time
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

  // Reload purchases when viewing purchases, attendance, or dashboard
  useEffect(() => {
    if (
      isAuthenticated &&
      (activeTab === "purchases" ||
        activeTab === "attendance" ||
        activeTab === "dashboard")
    ) {
      loadPurchases();
    }
  }, [isAuthenticated, activeTab]);

  useEffect(() => {
    if (isAuthenticated) {
      loadPurchases();
    }
  }, [isAuthenticated, search, eventFilter]);

  // Donations for Donations tab + Dashboard analytics
  useEffect(() => {
    if (
      isAuthenticated &&
      (activeTab === "donations" || activeTab === "dashboard")
    ) {
      loadDonations();
    }
  }, [isAuthenticated, activeTab]);

  useEffect(() => {
    if (
      isAuthenticated &&
      (activeTab === "events" ||
        activeTab === "scanner" ||
        activeTab === "attendance" ||
        activeTab === "issue" ||
        activeTab === "purchases" ||
        activeTab === "dashboard" ||
        activeTab === "checkin-staff")
    ) {
      loadEvents();
    }
    if (isAuthenticated && activeTab === "checkin-staff") {
      void loadCheckinStaff();
    }
    // Stop camera if user leaves the scanner tab
    if (activeTab !== "scanner") {
      stopCameraScanner();
    }
  }, [isAuthenticated, activeTab]);

  // Default dashboard event when list loads
  useEffect(() => {
    if (!dashEventSlug && events.length > 0) {
      setDashEventSlug(events[0].slug);
    }
  }, [events, dashEventSlug]);

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

  const issueEvent = events.find((e) => e.slug === issueEventSlug) || null;

  const issueCatalogTotal = (() => {
    if (!issueEvent) return 0;
    let sum = 0;
    for (const tt of issueEvent.ticketTypes || []) {
      const q = issueQtys[tt.id] || 0;
      if (q > 0) sum += (Number(tt.price) || 0) * q;
    }
    return sum;
  })();

  const issueTicketCount = Object.values(issueQtys).reduce(
    (s, q) => s + (Number(q) || 0),
    0
  );

  function resetIssueForm() {
    setIssueQtys({});
    setIssueBuyerName("");
    setIssueBuyerPhone("");
    setIssueBuyerEmail("");
    setIssuePaymentMethod("cash");
    setIssueNote("");
    setIssueAmountOverride("");
    setIssueResult(null);
  }

  async function handleIssueTickets(e: React.FormEvent) {
    e.preventDefault();
    if (!issueEventSlug) {
      toast.error("Select an event");
      return;
    }
    const tickets = Object.entries(issueQtys)
      .filter(([, q]) => (Number(q) || 0) > 0)
      .map(([ticketTypeId, quantity]) => ({
        ticketTypeId,
        quantity: Math.floor(Number(quantity) || 0),
      }));
    if (tickets.length === 0) {
      toast.error("Set quantity for at least one ticket type");
      return;
    }

    setIssueSubmitting(true);
    setIssueResult(null);
    try {
      const amountOverride =
        issueAmountOverride.trim() === ""
          ? undefined
          : Number(issueAmountOverride);
      if (
        amountOverride !== undefined &&
        (Number.isNaN(amountOverride) || amountOverride < 0)
      ) {
        toast.error("Amount override must be a valid number ≥ 0");
        return;
      }

      const res = await adminIssueManualTickets({
        eventSlug: issueEventSlug,
        tickets,
        buyer: {
          name: issueBuyerName.trim(),
          phone: issueBuyerPhone.trim(),
          email: issueBuyerEmail.trim(),
        },
        paymentMethod: issuePaymentMethod,
        note: issueNote.trim() || undefined,
        amountOverride,
      });

      if (!res.success) {
        toast.error(res.error || "Failed to issue tickets");
        return;
      }

      toast.success(`Tickets issued: ${res.orderReference}`);
      setIssueResult({
        orderReference: res.orderReference || "",
        paymentReference: res.paymentReference,
        amount: res.amount ?? 0,
        ticketCount: res.ticketCount ?? 0,
        eventSlug: issueEventSlug,
      });
      // Keep buyer/event so ops can issue another similar order; clear qtys
      setIssueQtys({});
      setIssueNote("");
      setIssueAmountOverride("");
      loadPurchases();
    } catch (err) {
      console.error(err);
      toast.error("Unexpected error issuing tickets");
    } finally {
      setIssueSubmitting(false);
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
      donationEnabled: false,
      donationDefaultAmount: 50,
      primaryColor: "",
      secondaryColor: "",
      backgroundColor: "",
      surfaceColor: "",
    });
    setTicketTypesForm([]);
    setBuyerFormFields([]);
    setDiscountCodesForm([]);
    setSeatDaysForm([]);
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
    setTicketDesign(defaultTicketDesign("Default ticket"));
    setShowEventModal(true);
  }

  function parseEventTime(ev: EventConfig) {
    if (ev.time) {
      const parts = ev.time.split(/[-–—]/).map((p) => p.trim());
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
  }

  function makeUniqueSlug(base: string): string {
    const root =
      (base || "event")
        .replace(/[^a-z0-9-]/gi, "-")
        .toLowerCase()
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "event";
    let candidate = `${root}-copy`;
    if (!events.some((e) => e.slug === candidate)) return candidate;
    candidate = `${root}-copy-${Date.now().toString(36)}`;
    return candidate;
  }

  /**
   * Duplicate event: same tickets, stock, redemptions, promo codes, form fields, banner.
   * User must set a new name + event dates; ticket valid-from/to are cleared.
   */
  function openDuplicateEvent(ev: EventConfig) {
    setEditingEvent(null); // create mode (new slug)
    const theme = readThemeFromMetadata(
      ev.metadata as Record<string, unknown> | undefined
    );
    setEventForm({
      slug: makeUniqueSlug(ev.slug),
      name: `Copy of ${ev.name}`,
      description: ev.description || "",
      date: "", // set new dates
      endDate: "",
      time: ev.time || "",
      location: ev.location || "",
      image: ev.image || "",
      enabled: false, // draft until ready
      paymentEnabled: ev.paymentEnabled !== false,
      ticketTemplate: ev.ticketTemplate || "",
      donationEnabled: Boolean(ev.donationEnabled),
      donationDefaultAmount: Math.max(
        0,
        Number(ev.donationDefaultAmount) || 50
      ),
      primaryColor: theme.primaryColor,
      secondaryColor: theme.secondaryColor,
      backgroundColor: theme.backgroundColor,
      surfaceColor: theme.surfaceColor,
    });
    setTicketDesign(
      getTicketDesignFromEvent(ev) ||
        defaultTicketDesign(`${ev.name} ticket`)
    );
    setTicketTypesForm(
      (ev.ticketTypes || []).map((t) => ({
        ...t,
        validFrom: undefined,
        validTo: undefined,
        discounts: (t.discounts || []).map((d) => ({
          ...d,
          id: `${d.id}-dup-${Date.now().toString(36)}`,
        })),
      }))
    );
    setBuyerFormFields(
      (ev.buyerFormFields || []).map((f) => ({ ...f }))
    );
    setDiscountCodesForm(
      (ev.discountCodes || []).map((dc) => ({
        ...dc,
        id: `dc-dup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      }))
    );
    setSeatDaysForm(
      (ev.seatDays || []).map((s) => ({
        date: s.date,
        capacity: s.capacity,
      }))
    );
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
    parseEventTime(ev);
    setShowEventModal(true);
    toast.message("Event duplicated - set name & dates, then Save", {
      description:
        "Ticket types, promo codes, and discounts are copied. Ticket valid dates cleared.",
    });
  }

  // Open modal to edit existing
  function openEditEvent(ev: EventConfig) {
    setEditingEvent(ev);
    const theme = readThemeFromMetadata(
      ev.metadata as Record<string, unknown> | undefined
    );
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
      donationEnabled: Boolean(ev.donationEnabled),
      donationDefaultAmount: Math.max(
        0,
        Number(ev.donationDefaultAmount) || 50
      ),
      primaryColor: theme.primaryColor,
      secondaryColor: theme.secondaryColor,
      backgroundColor: theme.backgroundColor,
      surfaceColor: theme.surfaceColor,
    });
    setTicketDesign(
      getTicketDesignFromEvent(ev) ||
        defaultTicketDesign(`${ev.name} ticket`)
    );
    setTicketTypesForm([...(ev.ticketTypes || [])]);
    setBuyerFormFields([...(ev.buyerFormFields || [])]);
    setDiscountCodesForm([...(ev.discountCodes || [])]);
    setSeatDaysForm(
      (ev.seatDays || []).map((s) => ({
        date: s.date,
        capacity: s.capacity,
      }))
    );
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

    parseEventTime(ev);

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

  /**
   * Upload admin assets.
   * - Small images: can go through server
   * - PDFs / larger files: signed URL → browser uploads straight to Supabase (avoids Vercel 413 ~4.5MB)
   */
  async function uploadAdminAsset(
    file: File
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    const slugForName = eventForm.slug || editingEvent?.slug || "event";
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    // Prefer signed direct upload for PDFs and anything over ~3MB
    const useSigned = isPdf || file.size > 3 * 1024 * 1024;

    if (useSigned) {
      try {
        const contentType =
          file.type ||
          (isPdf
            ? "application/pdf"
            : file.name.toLowerCase().endsWith(".png")
              ? "image/png"
              : "image/jpeg");

        const signRes = await fetch("/api/admin/upload", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "sign",
            filename: file.name || (isPdf ? "template.pdf" : "banner.jpg"),
            contentType,
            slug: slugForName,
            size: file.size,
          }),
        });

        const signData = await signRes.json().catch(() => ({}));
        if (!signRes.ok || !signData.success) {
          return {
            success: false,
            error:
              signData.error ||
              `Could not start upload (HTTP ${signRes.status})`,
          };
        }

        // Direct to Supabase - does not pass through Vercel body limit
        const putRes = await fetch(signData.signedUrl as string, {
          method: "PUT",
          headers: {
            "Content-Type": signData.contentType || contentType,
          },
          body: file,
        });

        if (!putRes.ok) {
          const t = await putRes.text().catch(() => "");
          console.error("[upload] signed PUT failed", putRes.status, t);
          return {
            success: false,
            error:
              `Direct storage upload failed (HTTP ${putRes.status}). ` +
              `Allow application/pdf on bucket event-assets if this is a PDF.`,
          };
        }

        if (!signData.publicUrl) {
          return {
            success: false,
            error: "Upload OK but missing public URL",
          };
        }
        return { success: true, path: signData.publicUrl as string };
      } catch (err) {
        console.error(err);
        return {
          success: false,
          error:
            err instanceof Error ? err.message : "Signed upload failed",
        };
      }
    }

    // Small non-PDF: multipart through our API
    const formData = new FormData();
    formData.append("file", file);
    formData.append("slug", slugForName);

    const res = await fetch("/api/admin/upload", {
      method: "POST",
      body: formData,
      credentials: "same-origin",
    });

    let data: {
      success?: boolean;
      path?: string;
      error?: string;
      code?: string;
    } = {};
    try {
      data = await res.json();
    } catch {
      // 413 often returns empty/HTML body
      if (res.status === 413) {
        return {
          success: false,
          error:
            "File too large for server hop (Vercel 413). Retry - large files should use direct storage upload.",
        };
      }
      return {
        success: false,
        error: `Upload failed (HTTP ${res.status}). Sign in again or check storage.`,
      };
    }

    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || `Upload failed (HTTP ${res.status})`,
      };
    }
    return { success: true, path: data.path };
  }

  async function uploadCroppedBanner(file: File) {
    try {
      const result = await uploadAdminAsset(file);
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
      toast.error(
        "Template too large (max 10MB) - file is " +
          (file.size / (1024 * 1024)).toFixed(1) +
          "MB"
      );
      e.target.value = "";
      return;
    }

    try {
      const result = await uploadAdminAsset(file);
      if (result.success && result.path) {
        setEventForm((prev) => ({ ...prev, ticketTemplate: result.path! }));
        toast.success("Ticket template background uploaded");
      } else {
        toast.error(result.error || "Upload failed");
      }
    } catch (err: any) {
      console.error(err);
      toast.error(
        "Failed to upload template: " + (err?.message || "unknown error")
      );
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
      timeValue = `${startTime} - ${endTime}`;
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
      donationEnabled: Boolean(eventForm.donationEnabled),
      donationDefaultAmount: eventForm.donationEnabled
        ? Math.max(0, Number(eventForm.donationDefaultAmount) || 0)
        : undefined,
      seatDays:
        seatDaysForm.length > 0
          ? seatDaysForm
              .map((s) => ({
                date: String(s.date || "").slice(0, 10),
                capacity: Math.max(0, Number(s.capacity) || 0),
              }))
              .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date))
          : undefined,
      // Always send arrays so remove/add persists (never leave undefined)
      ticketTypes: [...ticketTypesForm],
      buyerFormFields: [...buyerFormFields],
      discountCodes: [...discountCodesForm],
      metadata: {
        ...mergeThemeMetadata(
          (editingEvent?.metadata as Record<string, unknown>) || {},
          {
            primaryColor: eventForm.primaryColor,
            secondaryColor: eventForm.secondaryColor,
            backgroundColor: eventForm.backgroundColor,
            surfaceColor: eventForm.surfaceColor,
          }
        ),
        // Visual ticket designer (draft or published)
        ...(ticketDesign
          ? { ticketDesign: { ...ticketDesign, updatedAt: new Date().toISOString() } }
          : {}),
      },
    };

    try {
      const result = await adminSaveEventDetailed(newEvent);
      if (!result.ok) {
        toast.error(result.error || "Could not save event.");
        alert(result.error || "Could not save event.");
        return;
      }
      const saved = result.event;
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
            "Saved to memory only - will disappear after refresh. Check Supabase keys + restart."
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
    if (
      !confirm(
        `Delete event "${slug}" permanently?\n\nThis also deletes ALL purchases, tickets, and statistics for this event slug. Recreating the event later starts with empty stats.\n\nDisable the event instead if you only want to hide it.`
      )
    ) {
      return;
    }
    const res = await adminDeleteEvent(slug);
    if (!res || (typeof res === "object" && res.ok === false)) {
      toast.error(
        (typeof res === "object" && res?.error) || "Failed to delete event"
      );
      return;
    }
    await loadEvents();
    await loadPurchases();
    if (dashEventSlug === slug) setDashEventSlug("");
    const n =
      typeof res === "object" && typeof res.deletedPurchases === "number"
        ? res.deletedPurchases
        : 0;
    toast.success(
      n > 0
        ? `Event deleted (and ${n} purchase record${n === 1 ? "" : "s"} cleared)`
        : "Event deleted"
    );
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
      description: newTicket.description || "",
      enabled: newTicket.enabled !== false,
      isFree: Boolean(newTicket.isFree),
      discounts: newTicket.discounts
        ? newTicket.discounts.map((d) => ({ ...d }))
        : undefined,
    };
    if (ticketTypesForm.some((x) => x.id === t.id)) {
      alert(`Ticket ID "${t.id}" already exists. Choose another ID.`);
      return;
    }
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
      isFree: false,
      discounts: undefined,
      description: "",
    });
  }

  function removeTicketType(id: string) {
    setTicketTypesForm(ticketTypesForm.filter((t) => t.id !== id));
  }

  /**
   * Load a ticket type into the “Add new” form (not added to the list yet).
   * Copies price/stock/redemptions/discounts; leaves name + valid dates empty for you.
   */
  function duplicateTicketType(id: string) {
    const src = ticketTypesForm.find((t) => t.id === id);
    if (!src) return;

    const used = new Set(ticketTypesForm.map((t) => t.id));
    let suggestId = `${src.id}-copy`;
    let n = 2;
    while (used.has(suggestId)) {
      suggestId = `${src.id}-copy-${n}`;
      n += 1;
    }

    setNewTicket({
      id: suggestId,
      name: "", // you set the name
      price: src.price,
      currency: src.currency || "HKD",
      maxPerOrder: src.maxPerOrder ?? 6,
      quantityAvailable: src.quantityAvailable,
      redemptionLimit: src.redemptionLimit ?? 1,
      validFrom: "",
      validTo: "",
      enabled: src.enabled !== false,
      isFree: Boolean(src.isFree),
      discounts: (src.discounts || []).map((d) => ({
        ...d,
        id: `${d.id}-dup-${Date.now().toString(36)}`,
      })),
      description: src.description || "",
    });

    toast.message("Ticket details copied into the form below", {
      description:
        "Enter a name (and ID if you want), set valid dates if needed, then click “+ Add ticket type”.",
    });

    // Scroll to add form
    requestAnimationFrame(() => {
      document
        .getElementById("add-ticket-type-form")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function toggleTicketType(id: string) {
    setTicketTypesForm(
      ticketTypesForm.map((t) =>
        t.id === id ? { ...t, enabled: !(t.enabled !== false) } : t
      )
    );
  }

  function toggleTicketTypeFree(id: string) {
    setTicketTypesForm(
      ticketTypesForm.map((t) =>
        t.id === id ? { ...t, isFree: !t.isFree } : t
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
            <h1 className="text-3xl font-semibold tracking-tighter">Connect Events</h1>
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

      {/* Tabs - scroll on small screens */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6">
        <div className="flex border-b overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 gap-0">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`shrink-0 px-3 sm:px-6 py-3 font-medium text-xs sm:text-sm border-b-2 transition-all whitespace-nowrap ${activeTab === "dashboard" ? "border-violet-600 text-violet-800" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab("purchases")}
            className={`shrink-0 px-3 sm:px-6 py-3 font-medium text-xs sm:text-sm border-b-2 transition-all whitespace-nowrap ${activeTab === "purchases" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            Purchases
          </button>
          <button
            onClick={() => setActiveTab("donations")}
            className={`shrink-0 px-3 sm:px-6 py-3 font-medium text-xs sm:text-sm border-b-2 transition-all whitespace-nowrap ${activeTab === "donations" ? "border-rose-600 text-rose-800" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            Donations
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
          <button
            onClick={() => {
              setActiveTab("issue");
              setIssueResult(null);
            }}
            className={`shrink-0 px-3 sm:px-6 py-3 font-medium text-xs sm:text-sm border-b-2 transition-all whitespace-nowrap ${activeTab === "issue" ? "border-amber-600 text-amber-800" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            Issue tickets
          </button>
          <button
            onClick={() => setActiveTab("checkin-staff")}
            className={`shrink-0 px-3 sm:px-6 py-3 font-medium text-xs sm:text-sm border-b-2 transition-all whitespace-nowrap ${activeTab === "checkin-staff" ? "border-teal-600 text-teal-800" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
          >
            Check-in staff
          </button>
        </div>
      </div>

      {/* DASHBOARD: per-event stats + charts (glass) */}
      {activeTab === "dashboard" && (() => {
        const dash = dashEventSlug
          ? buildEventDashboard(dashEventSlug)
          : null;
        const pieTotal =
          dash?.typeRows.reduce((s, t) => s + t.sold, 0) || 0;
        const maxDayTickets = Math.max(
          1,
          ...(dash?.timeline.map((d) => d.tickets) || [1])
        );
        const maxDayRevenue = Math.max(
          1,
          ...(dash?.timeline.map(
            (d) => (d.revenue || 0) + (d.donations || 0)
          ) || [1])
        );


        // Donut (modern ring) slices
        const donutCx = 100;
        const donutCy = 100;
        const rOut = 78;
        const rIn = 50;
        const gap = 0.04; // radians gap between slices
        let pieAngle = -Math.PI / 2;
        const pieSlices =
          dash?.typeRows
            .filter((t) => t.sold > 0)
            .map((t) => {
              const frac = pieTotal > 0 ? t.sold / pieTotal : 0;
              const sweep = Math.max(0, frac * Math.PI * 2 - gap);
              const start = pieAngle + gap / 2;
              const end = start + sweep;
              pieAngle += frac * Math.PI * 2;
              const polar = (a: number, r: number) => ({
                x: donutCx + r * Math.cos(a),
                y: donutCy + r * Math.sin(a),
              });
              const o1 = polar(start, rOut);
              const o2 = polar(end, rOut);
              const i1 = polar(end, rIn);
              const i2 = polar(start, rIn);
              const large = sweep > Math.PI ? 1 : 0;
              const d =
                frac >= 0.999
                  ? `M ${donutCx} ${donutCy - rOut} A ${rOut} ${rOut} 0 1 1 ${donutCx - 0.01} ${donutCy - rOut} L ${donutCx - 0.01} ${donutCy - rIn} A ${rIn} ${rIn} 0 1 0 ${donutCx} ${donutCy - rIn} Z`
                  : `M ${o1.x} ${o1.y} A ${rOut} ${rOut} 0 ${large} 1 ${o2.x} ${o2.y} L ${i1.x} ${i1.y} A ${rIn} ${rIn} 0 ${large} 0 ${i2.x} ${i2.y} Z`;
              return { ...t, d, frac };
            }) || [];

        // Timeline chart geometry (area + bars) - taller so graph fills the card
        const tl = dash?.timeline || [];
        const chartW = Math.max(480, tl.length * 56);
        const chartH = 300;
        const padL = 44;
        const padR = 16;
        const padT = 28;
        const padB = 40;
        const plotW = chartW - padL - padR;
        const plotH = chartH - padT - padB;
        const n = Math.max(1, tl.length);
        const xAt = (i: number) =>
          padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
        const yTickets = (v: number) =>
          padT + plotH - (v / maxDayTickets) * plotH;
        const yRevenue = (v: number) =>
          padT + plotH - (v / maxDayRevenue) * plotH;
        const ticketPoints = tl.map((d, i) => ({
          x: xAt(i),
          y: yTickets(d.tickets),
          ...d,
        }));
        const areaPath =
          ticketPoints.length === 0
            ? ""
            : `M ${ticketPoints[0].x} ${padT + plotH} ` +
              ticketPoints.map((p) => `L ${p.x} ${p.y}`).join(" ") +
              ` L ${ticketPoints[ticketPoints.length - 1].x} ${padT + plotH} Z`;
        const linePath =
          ticketPoints.length === 0
            ? ""
            : `M ${ticketPoints.map((p) => `${p.x} ${p.y}`).join(" L ")}`;
        const barSlot = plotW / n;
        const barW = Math.min(28, Math.max(8, barSlot * 0.55));
        const gridYs = [0, 0.25, 0.5, 0.75, 1].map(
          (f) => padT + plotH * (1 - f)
        );

        return (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            <div className="dash-glass-shell p-4 sm:p-6 lg:p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-violet-700/80">
                    Analytics
                  </p>
                  <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900 mt-1">
                    Event dashboard
                  </h2>
                  <p className="text-sm text-zinc-600 mt-1 max-w-xl">
                    Tickets, inventory, ticket revenue, donations, and charts.
                    Admin only. Does not change checkout.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={dashEventSlug}
                    onChange={(e) => {
                      setDashEventSlug(e.target.value);
                      setDashTip(null);
                    }}
                    className="dash-glass-card-soft rounded-xl px-3 py-2.5 text-sm min-w-[12rem] outline-none focus:ring-2 focus:ring-violet-300/50"
                  >
                    <option value="">
                      {eventsLoading ? "Loading events..." : "Select event..."}
                    </option>
                    {events.map((ev) => (
                      <option key={ev.slug} value={ev.slug}>
                        {ev.name} ({ev.slug})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      loadPurchases();
                      loadDonations();
                      loadEvents();
                    }}
                    disabled={loading || eventsLoading || donationsLoading}
                    className="dash-glass-card-soft flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-700 hover:bg-white/70 transition-colors"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${loading || eventsLoading || donationsLoading ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </button>
                </div>
              </div>

              {!dashEventSlug && (
                <div className="dash-glass-card p-12 text-center text-zinc-500 text-sm">
                  Select an event to see stats.
                </div>
              )}

              {dashEventSlug && dash && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {[
                      {
                        label: "Tickets sold",
                        value: String(dash.ticketsSold),
                        sub: `${dash.orderCount} order${dash.orderCount === 1 ? "" : "s"}`,
                      },
                      {
                        label: "Ticket revenue",
                        value: `HKD ${dash.revenue.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`,
                        sub: "Ticket purchases only",
                      },
                      {
                        label: "Donations",
                        value: `HKD ${dash.donationTotal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`,
                        sub: `${dash.donationCount} donation${dash.donationCount === 1 ? "" : "s"}${
                          dash.donationCount > 0
                            ? ` · avg HKD ${dash.donationAvg.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`
                            : dash.donationEnabled
                              ? " · enabled on event"
                              : " · not enabled"
                        }`,
                      },
                      {
                        label: "Combined total",
                        value: `HKD ${dash.combinedTotal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`,
                        sub: "Tickets + donations",
                      },
                      {
                        label: "Ticket types",
                        value: String(
                          dash.typeRows.filter((t) => t.id !== "_order").length
                        ),
                        sub: "On this event",
                      },
                      {
                        label: "Inventory left",
                        value: (() => {
                          const capped = dash.typeRows.filter((t) => t.cap != null);
                          if (capped.length === 0) return "Unlimited";
                          return String(
                            capped.reduce((s, t) => s + (t.left ?? 0), 0)
                          );
                        })(),
                        sub: "Types with a sales limit only",
                      },
                      {
                        label: "Donation rate",
                        value:
                          dash.orderCount > 0
                            ? `${((dash.donationCount / dash.orderCount) * 100).toLocaleString(
                                undefined,
                                { maximumFractionDigits: 1 }
                              )}%`
                            : dash.donationCount > 0
                              ? "—"
                              : "0%",
                        sub:
                          dash.orderCount > 0
                            ? "Donations ÷ orders"
                            : "No ticket orders yet",
                      },
                      {
                        label: "% of combined",
                        value:
                          dash.combinedTotal > 0
                            ? `${((dash.donationTotal / dash.combinedTotal) * 100).toLocaleString(
                                undefined,
                                { maximumFractionDigits: 1 }
                              )}%`
                            : "0%",
                        sub: "Donations share of total money",
                      },
                    ].map((stat) => (
                      <div key={stat.label} className="dash-glass-card p-4 sm:p-5">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                          {stat.label}
                        </div>
                        <div className="mt-1.5 text-2xl sm:text-3xl font-semibold tabular-nums dash-stat-value leading-tight">
                          {stat.value}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-1.5">{stat.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* FR 6.6: per event-day seating */}
                  {dash.dayCapacityRows && dash.dayCapacityRows.length > 0 && (
                    <div className="dash-glass-card p-4 sm:p-6">
                      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
                        <div>
                          <h3 className="font-semibold text-sm text-zinc-900">
                            Seating by event day
                          </h3>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            Shared capacity. Multi-day tickets count on every day they cover.
                            Remaining = capacity minus sold (derived, not a stored counter).
                          </p>
                        </div>
                        <span className="text-[11px] text-zinc-500">
                          Low stock under 10% remaining
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[520px]">
                          <thead>
                            <tr className="text-left text-xs text-zinc-500 border-b">
                              <th className="py-2 pr-3 font-medium">Day</th>
                              <th className="py-2 pr-3 font-medium text-right">Capacity</th>
                              <th className="py-2 pr-3 font-medium text-right">Sold</th>
                              <th className="py-2 pr-3 font-medium text-right">Remaining</th>
                              <th className="py-2 pr-3 font-medium">Status</th>
                              <th className="py-2 font-medium">By ticket type</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {dash.dayCapacityRows.map((d) => (
                              <tr key={d.date} className="align-top">
                                <td className="py-2.5 pr-3 font-mono text-xs">
                                  {d.date}
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums">
                                  {d.capacity}
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums font-medium">
                                  {d.sold}
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums font-semibold">
                                  {d.remaining}
                                </td>
                                <td className="py-2.5 pr-3">
                                  {d.status === "sold_out" ? (
                                    <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                                      Sold out
                                    </span>
                                  ) : d.status === "low" ? (
                                    <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                                      Low stock
                                    </span>
                                  ) : (
                                    <span className="text-xs text-emerald-700">OK</span>
                                  )}
                                </td>
                                <td className="py-2.5 text-xs text-zinc-600">
                                  {d.byType.length === 0
                                    ? "—"
                                    : d.byType
                                        .map((t) => `${t.name}: ${t.sold}`)
                                        .join(" · ")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="dash-glass-card p-4 sm:p-6">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-sm text-zinc-900">
                            Sold by ticket type
                          </h3>
                          <p className="text-xs text-zinc-500 mt-0.5">Share of tickets sold</p>
                        </div>
                      </div>
                      {pieTotal === 0 ? (
                        <p className="mt-8 text-sm text-zinc-400 text-center">
                          No sales yet for this event.
                        </p>
                      ) : (
                        <div className="mt-5 flex flex-col sm:flex-row items-center gap-6 relative">
                          <div
                            className="relative shrink-0"
                            onMouseLeave={() =>
                              setDashTip((t) => (t?.chart === "donut" ? null : t))
                            }
                          >
                            <svg
                              viewBox="0 0 200 200"
                              className="w-56 h-56 sm:w-64 sm:h-64 drop-shadow-md"
                            >
                              <defs>
                                <filter id="donutGlow" x="-20%" y="-20%" width="140%" height="140%">
                                  <feDropShadow
                                    dx="0"
                                    dy="4"
                                    stdDeviation="4"
                                    floodColor="#7c3aed"
                                    floodOpacity="0.15"
                                  />
                                </filter>
                              </defs>
                              <circle
                                cx={donutCx}
                                cy={donutCy}
                                r={(rOut + rIn) / 2}
                                fill="none"
                                stroke="rgba(255,255,255,0.5)"
                                strokeWidth={rOut - rIn + 4}
                              />
                              <g filter="url(#donutGlow)">
                                {pieSlices.map((s) => (
                                  <path
                                    key={s.id}
                                    d={s.d}
                                    fill={s.color}
                                    className="transition-opacity cursor-pointer"
                                    style={{
                                      opacity:
                                        dashTip?.chart === "donut" &&
                                        dashTip.title !== s.name
                                          ? 0.45
                                          : 1,
                                    }}
                                    onMouseEnter={() =>
                                      setDashTip({
                                        chart: "donut",
                                        leftPct: 52,
                                        topPct: 18,
                                        title: s.name,
                                        rows: [
                                          {
                                            label: "Tickets sold",
                                            value: String(s.sold),
                                          },
                                          {
                                            label: "Share",
                                            value: `${Math.round(s.frac * 100)}%`,
                                          },
                                          {
                                            label: "Of total",
                                            value: `${s.sold} / ${pieTotal}`,
                                          },
                                        ],
                                      })
                                    }
                                  />
                                ))}
                              </g>
                              <circle
                                cx={donutCx}
                                cy={donutCy}
                                r={rIn - 2}
                                fill="rgba(255,255,255,0.85)"
                              />
                              <text
                                x={donutCx}
                                y={donutCy - 6}
                                textAnchor="middle"
                                className="fill-zinc-900"
                                style={{ fontSize: 22, fontWeight: 700 }}
                              >
                                {pieTotal}
                              </text>
                              <text
                                x={donutCx}
                                y={donutCy + 14}
                                textAnchor="middle"
                                className="fill-zinc-500"
                                style={{ fontSize: 10, fontWeight: 500 }}
                              >
                                tickets
                              </text>
                            </svg>
                            {dashTip?.chart === "donut" && (
                              <div
                                className="pointer-events-none absolute z-20 min-w-[10.5rem] rounded-xl border border-white/80 bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur-md"
                                style={{
                                  left: `${dashTip.leftPct}%`,
                                  top: `${dashTip.topPct}%`,
                                }}
                              >
                                <div className="text-xs font-semibold text-zinc-900 truncate">
                                  {dashTip.title}
                                </div>
                                <dl className="mt-1.5 space-y-1">
                                  {dashTip.rows.map((r) => (
                                    <div
                                      key={r.label}
                                      className="flex justify-between gap-3 text-[11px]"
                                    >
                                      <dt className="text-zinc-500">{r.label}</dt>
                                      <dd className="font-medium tabular-nums text-zinc-800">
                                        {r.value}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>
                            )}
                          </div>
                          <ul className="space-y-2 text-sm w-full min-w-0">
                            {dash.typeRows
                              .filter((t) => t.sold > 0)
                              .map((t) => {
                                const pct = pieTotal
                                  ? Math.round((t.sold / pieTotal) * 100)
                                  : 0;
                                return (
                                  <li key={t.id} className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white shadow-sm"
                                        style={{ background: t.color }}
                                      />
                                      <span className="truncate flex-1 text-zinc-800 text-xs sm:text-sm font-medium">
                                        {t.name}
                                      </span>
                                      <span className="tabular-nums text-zinc-600 shrink-0 text-xs font-semibold">
                                        {t.sold}
                                        <span className="text-zinc-400 font-normal">
                                          {" "}
                                          ({pct}%)
                                        </span>
                                      </span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-zinc-200/60 overflow-hidden ml-4">
                                      <div
                                        className="h-full rounded-full transition-all duration-500"
                                        style={{
                                          width: `${pct}%`,
                                          background: `linear-gradient(90deg, ${t.color}, ${t.color}cc)`,
                                        }}
                                      />
                                    </div>
                                  </li>
                                );
                              })}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="dash-glass-card p-4 sm:p-6">
                      <h3 className="font-semibold text-sm text-zinc-900">Inventory by type</h3>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Left = limit - sold (Unlimited if no limit on the type)
                      </p>
                      <div className="mt-4 space-y-3">
                        {dash.typeRows.length === 0 ? (
                          <p className="py-6 text-center text-zinc-400 text-sm">
                            No ticket types on this event.
                          </p>
                        ) : (
                          dash.typeRows.map((t) => {
                            const fillPct =
                              t.cap != null && t.cap > 0
                                ? Math.min(100, Math.round((t.sold / t.cap) * 100))
                                : t.sold > 0
                                  ? 40
                                  : 0;
                            return (
                              <div
                                key={t.id}
                                className="dash-glass-card-soft rounded-xl px-3 py-2.5"
                              >
                                <div className="flex items-center justify-between gap-2 text-sm">
                                  <span className="inline-flex items-center gap-2 min-w-0">
                                    <span
                                      className="w-2.5 h-2.5 rounded-full shrink-0"
                                      style={{ background: t.color }}
                                    />
                                    <span className="truncate font-medium text-zinc-800">
                                      {t.name}
                                    </span>
                                  </span>
                                  <span className="text-xs tabular-nums text-zinc-600 shrink-0">
                                    {t.sold}
                                    <span className="text-zinc-400">
                                      {" "}
                                      / {t.cap == null ? "∞" : t.cap}
                                    </span>
                                    <span
                                      className={`ml-2 font-semibold ${
                                        t.left === 0
                                          ? "text-red-600"
                                          : t.left != null && t.left <= 50
                                            ? "text-amber-600"
                                            : "text-emerald-700"
                                      }`}
                                    >
                                      {t.left == null
                                        ? "Unlimited"
                                        : `${t.left} left`}
                                    </span>
                                  </span>
                                </div>
                                <div className="mt-2 h-2 rounded-full bg-zinc-200/70 overflow-hidden">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${fillPct}%`,
                                      background: `linear-gradient(90deg, ${t.color}99, ${t.color})`,
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="dash-glass-card p-4 sm:p-6">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-sm text-zinc-900">
                          Ticket sales over time
                        </h3>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          Daily volume with trend line
                        </p>
                      </div>
                      {tl.length > 0 && (
                        <div className="flex gap-3 text-[11px] text-zinc-500">
                          <span>
                            Peak{" "}
                            <strong className="text-zinc-800">{maxDayTickets}</strong>{" "}
                            tickets
                          </span>
                        </div>
                      )}
                    </div>
                    {!tl.length ? (
                      <p className="mt-8 text-sm text-zinc-400 text-center">
                        No dated sales to chart yet.
                      </p>
                    ) : (
                      <div
                        className="mt-4 relative overflow-x-auto -mx-1"
                        onMouseLeave={() =>
                          setDashTip((t) => (t?.chart === "sales" ? null : t))
                        }
                      >
                        <svg
                          viewBox={`0 0 ${chartW} ${chartH}`}
                          className="w-full min-w-[400px] h-[280px] sm:h-[320px]"
                          preserveAspectRatio="xMidYMid meet"
                        >
                          <defs>
                            <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.45" />
                              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
                            </linearGradient>
                            <linearGradient id="lineStroke" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#a78bfa" />
                              <stop offset="100%" stopColor="#6d28d9" />
                            </linearGradient>
                          </defs>
                          {gridYs.map((gy, i) => (
                            <g key={i}>
                              <line
                                x1={padL}
                                y1={gy}
                                x2={chartW - padR}
                                y2={gy}
                                stroke="rgba(24,24,27,0.06)"
                                strokeWidth="1"
                              />
                              <text
                                x={padL - 8}
                                y={gy + 3}
                                textAnchor="end"
                                fill="#a1a1aa"
                                style={{ fontSize: 10 }}
                              >
                                {Math.round(maxDayTickets * (1 - i / 4))}
                              </text>
                            </g>
                          ))}
                          <path d={areaPath} fill="url(#areaFill)" />
                          <path
                            d={linePath}
                            fill="none"
                            stroke="url(#lineStroke)"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {ticketPoints.map((p) => {
                            const active =
                              dashTip?.chart === "sales" &&
                              dashTip.title === p.date;
                            return (
                              <g
                                key={p.date}
                                className="cursor-pointer"
                                onMouseEnter={() =>
                                  setDashTip({
                                    chart: "sales",
                                    leftPct: Math.min(
                                      78,
                                      Math.max(8, (p.x / chartW) * 100 - 8)
                                    ),
                                    topPct: Math.max(
                                      6,
                                      (p.y / chartH) * 100 - 18
                                    ),
                                    title: p.date,
                                    rows: [
                                      {
                                        label: "Tickets sold",
                                        value: String(p.tickets),
                                      },
                                      {
                                        label: "Ticket revenue",
                                        value: `HKD ${(p.revenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                                      },
                                      {
                                        label: "Donations",
                                        value: `HKD ${(p.donations || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                                      },
                                      {
                                        label: "Orders",
                                        value: String(p.orders),
                                      },
                                      {
                                        label: "Donation count",
                                        value: String(p.donationCount || 0),
                                      },
                                    ],
                                  })
                                }
                              >
                                <circle cx={p.x} cy={p.y} r="16" fill="transparent" />
                                {active && (
                                  <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r="10"
                                    fill="rgba(124,58,237,0.15)"
                                  />
                                )}
                                <circle
                                  cx={p.x}
                                  cy={p.y}
                                  r={active ? 6 : 5}
                                  fill="#fff"
                                  stroke="#7c3aed"
                                  strokeWidth="2.5"
                                />
                                <text
                                  x={p.x}
                                  y={chartH - 14}
                                  textAnchor="middle"
                                  fill="#71717a"
                                  style={{ fontSize: 10 }}
                                >
                                  {p.date.slice(5)}
                                </text>
                              </g>
                            );
                          })}
                        </svg>
                        {dashTip?.chart === "sales" && (
                          <div
                            className="pointer-events-none absolute z-20 min-w-[11.5rem] rounded-xl border border-violet-100 bg-white/95 px-3 py-2.5 shadow-xl backdrop-blur-md"
                            style={{
                              left: `${dashTip.leftPct}%`,
                              top: `${dashTip.topPct}%`,
                            }}
                          >
                            <div className="text-[11px] font-semibold text-violet-800">
                              {dashTip.title}
                            </div>
                            <dl className="mt-1.5 space-y-1">
                              {dashTip.rows.map((r) => (
                                <div
                                  key={r.label}
                                  className="flex justify-between gap-4 text-[11px]"
                                >
                                  <dt className="text-zinc-500">{r.label}</dt>
                                  <dd className="font-semibold tabular-nums text-zinc-900">
                                    {r.value}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {tl.length > 0 && (
                    <div className="dash-glass-card p-4 sm:p-6">
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-sm text-zinc-900">
                            Money over time
                          </h3>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            HKD per day — green = tickets, rose = donations (stacked)
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                            Tickets
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />
                            Donations
                          </span>
                          <span>
                            Peak{" "}
                            <strong className="text-zinc-800">
                              HKD{" "}
                              {maxDayRevenue.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </strong>
                          </span>
                        </div>
                      </div>
                      <div
                        className="mt-4 relative overflow-x-auto -mx-1"
                        onMouseLeave={() =>
                          setDashTip((t) => (t?.chart === "revenue" ? null : t))
                        }
                      >
                        <svg
                          viewBox={`0 0 ${chartW} ${chartH}`}
                          className="w-full min-w-[400px] h-[280px] sm:h-[320px]"
                          preserveAspectRatio="xMidYMid meet"
                        >
                          <defs>
                            <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#34d399" />
                              <stop offset="100%" stopColor="#059669" />
                            </linearGradient>
                            <linearGradient id="barGradHot" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#6ee7b7" />
                              <stop offset="100%" stopColor="#047857" />
                            </linearGradient>
                            <linearGradient id="barDon" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#fb7185" />
                              <stop offset="100%" stopColor="#e11d48" />
                            </linearGradient>
                            <linearGradient id="barDonHot" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#fda4af" />
                              <stop offset="100%" stopColor="#be123c" />
                            </linearGradient>
                          </defs>
                          {gridYs.map((gy, i) => (
                            <g key={i}>
                              <line
                                x1={padL}
                                y1={gy}
                                x2={chartW - padR}
                                y2={gy}
                                stroke="rgba(24,24,27,0.06)"
                                strokeWidth="1"
                                strokeDasharray="4 4"
                              />
                              <text
                                x={padL - 8}
                                y={gy + 3}
                                textAnchor="end"
                                fill="#a1a1aa"
                                style={{ fontSize: 10 }}
                              >
                                {Math.round(maxDayRevenue * (1 - i / 4))}
                              </text>
                            </g>
                          ))}
                          {tl.map((d, i) => {
                            const x = padL + barSlot * i + (barSlot - barW) / 2;
                            const ticketRev = d.revenue || 0;
                            const donRev = d.donations || 0;
                            const combined = ticketRev + donRev;
                            const yTop = yRevenue(combined);
                            const yMid = yRevenue(ticketRev);
                            const hTickets = Math.max(
                              ticketRev > 0 ? 2 : 0,
                              padT + plotH - yMid
                            );
                            const hDon = Math.max(
                              donRev > 0 ? 2 : 0,
                              yMid - yTop
                            );
                            const active =
                              dashTip?.chart === "revenue" &&
                              dashTip.title === d.date;
                            return (
                              <g
                                key={d.date}
                                className="cursor-pointer"
                                onMouseEnter={() =>
                                  setDashTip({
                                    chart: "revenue",
                                    leftPct: Math.min(
                                      78,
                                      Math.max(8, ((x + barW / 2) / chartW) * 100 - 8)
                                    ),
                                    topPct: Math.max(6, (yTop / chartH) * 100 - 12),
                                    title: d.date,
                                    rows: [
                                      {
                                        label: "Tickets",
                                        value: `HKD ${ticketRev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                                      },
                                      {
                                        label: "Donations",
                                        value: `HKD ${donRev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${d.donationCount || 0})`,
                                      },
                                      {
                                        label: "Combined",
                                        value: `HKD ${combined.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                                      },
                                      {
                                        label: "Ticket qty",
                                        value: String(d.tickets),
                                      },
                                      {
                                        label: "Orders",
                                        value: String(d.orders),
                                      },
                                    ],
                                  })
                                }
                              >
                                {/* Ticket revenue (bottom) */}
                                {ticketRev > 0 && (
                                  <rect
                                    x={x}
                                    y={yMid}
                                    width={barW}
                                    height={hTickets}
                                    rx={donRev > 0 ? 0 : 8}
                                    ry={donRev > 0 ? 0 : 8}
                                    fill={
                                      active ? "url(#barGradHot)" : "url(#barGrad)"
                                    }
                                    opacity={
                                      dashTip?.chart === "revenue" && !active
                                        ? 0.45
                                        : 0.95
                                    }
                                  />
                                )}
                                {/* Donations (top of stack) */}
                                {donRev > 0 && (
                                  <rect
                                    x={x}
                                    y={yTop}
                                    width={barW}
                                    height={hDon}
                                    rx={8}
                                    ry={8}
                                    fill={
                                      active ? "url(#barDonHot)" : "url(#barDon)"
                                    }
                                    opacity={
                                      dashTip?.chart === "revenue" && !active
                                        ? 0.45
                                        : 0.95
                                    }
                                  />
                                )}
                                {/* Invisible hit target if both zero-ish */}
                                {combined <= 0 && (
                                  <rect
                                    x={x}
                                    y={padT + plotH - 4}
                                    width={barW}
                                    height={4}
                                    rx={2}
                                    fill="#e4e4e7"
                                  />
                                )}
                                <text
                                  x={x + barW / 2}
                                  y={chartH - 14}
                                  textAnchor="middle"
                                  fill="#71717a"
                                  style={{ fontSize: 10 }}
                                >
                                  {d.date.slice(5)}
                                </text>
                              </g>
                            );
                          })}
                        </svg>
                        {dashTip?.chart === "revenue" && (
                          <div
                            className="pointer-events-none absolute z-20 min-w-[11.5rem] rounded-xl border border-emerald-100 bg-white/95 px-3 py-2.5 shadow-xl backdrop-blur-md"
                            style={{
                              left: `${dashTip.leftPct}%`,
                              top: `${dashTip.topPct}%`,
                            }}
                          >
                            <div className="text-[11px] font-semibold text-emerald-800">
                              {dashTip.title}
                            </div>
                            <dl className="mt-1.5 space-y-1">
                              {dashTip.rows.map((r) => (
                                <div
                                  key={r.label}
                                  className="flex justify-between gap-4 text-[11px]"
                                >
                                  <dt className="text-zinc-500">{r.label}</dt>
                                  <dd className="font-semibold tabular-nums text-zinc-900">
                                    {r.value}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* DONATIONS TAB (separate from ticket purchases) */}
      {activeTab === "donations" && (() => {
        const filt = donationEventFilter.trim().toLowerCase();
        const shown = filt
          ? donations.filter((d) =>
              (d.event_slug || "").toLowerCase().includes(filt)
            )
          : donations;
        return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Donations</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Tracked separately from ticket purchases. Run the donations table SQL
                in Supabase if this list stays empty after real donations.
              </p>
            </div>
            <button
              onClick={loadDonations}
              disabled={donationsLoading}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-zinc-100 self-start"
            >
              <RefreshCw
                className={`h-4 w-4 ${donationsLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
          <div className="mb-4">
            <input
              value={donationEventFilter}
              onChange={(e) => setDonationEventFilter(e.target.value)}
              placeholder="Filter by event slug"
              className="rounded-xl border py-2.5 px-4 bg-white w-full sm:w-72"
            />
          </div>
          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b bg-rose-50/60 text-left">
                  <th className="p-3 sm:p-4 font-medium whitespace-nowrap">Date</th>
                  <th className="p-3 sm:p-4 font-medium">Name</th>
                  <th className="p-3 sm:p-4 font-medium">Email / Phone</th>
                  <th className="p-3 sm:p-4 font-medium text-right">Amount</th>
                  <th className="p-3 sm:p-4 font-medium">Event</th>
                  <th className="p-3 sm:p-4 font-medium">Order ref</th>
                  <th className="p-3 sm:p-4 font-medium">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {donationsLoading && (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-zinc-400">
                      Loading donations...
                    </td>
                  </tr>
                )}
                {!donationsLoading && shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-zinc-400">
                      No donations found.
                    </td>
                  </tr>
                )}
                {shown.map((d, idx) => (
                  <tr key={d.id ?? idx} className="hover:bg-rose-50/30">
                    <td className="p-3 sm:p-4 text-xs text-zinc-500 whitespace-nowrap">
                      {formatHkDateTime(d.donated_at)}
                    </td>
                    <td className="p-3 sm:p-4 font-medium">{d.name}</td>
                    <td className="p-3 sm:p-4">
                      <div className="break-all">{d.email}</div>
                      <div className="text-xs text-zinc-500">{d.phone}</div>
                    </td>
                    <td className="p-3 sm:p-4 text-right font-semibold tabular-nums text-rose-800 whitespace-nowrap">
                      {d.currency || "HKD"}{" "}
                      {Number(d.amount).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="p-3 sm:p-4">
                      <span className="font-mono text-xs rounded bg-zinc-100 px-2 py-0.5">
                        {d.event_slug}
                      </span>
                    </td>
                    <td className="p-3 sm:p-4 font-mono text-xs text-zinc-600 break-all">
                      {d.order_reference || d.payment_reference || "—"}
                    </td>
                    <td className="p-3 sm:p-4 text-xs text-zinc-600">
                      {d.payment_method || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > 0 && (
            <div className="mt-4 text-sm text-zinc-600">
              Total shown:{" "}
              <span className="font-semibold text-rose-800 tabular-nums">
                HKD{" "}
                {shown
                  .reduce((s, d) => s + (Number(d.amount) || 0), 0)
                  .toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
              </span>{" "}
              · {shown.length} donation{shown.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
        );
      })()}

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
                  <th className="p-3 sm:p-4 font-medium">Ticket type</th>
                  <th className="p-3 sm:p-4 font-medium hidden md:table-cell">Order Ref</th>
                  <th className="p-3 sm:p-4 font-medium min-w-[10rem] hidden lg:table-cell">Per-ticket check-ins</th>
                  <th className="p-3 sm:p-4 font-medium">Summary</th>
                  <th className="p-3 sm:p-4 font-medium whitespace-nowrap">Tickets</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading && (
                  <tr><td colSpan={11} className="p-10 text-center text-zinc-400">Loading purchases...</td></tr>
                )}
                {!loading && purchases.length === 0 && (
                  <tr><td colSpan={11} className="p-10 text-center text-zinc-400">No purchases found.</td></tr>
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
                    <td className="p-3 sm:p-4 text-xs text-zinc-800 max-w-[12rem]">
                      <span className="leading-snug">{formatPurchaseTicketTypes(purchase)}</span>
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
                              (no serials - re-purchase after serial fix for per-ticket tracking)
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
                    <td className="p-3 sm:p-4 whitespace-nowrap">
                      {(() => {
                        const key = purchaseRowKey(purchase);
                        const busy = downloadingTicketsKey === key;
                        const units = purchase.ticket_breakdown || [];
                        const n = units.some((u: any) => u.serial)
                          ? units.filter((u: any) => u.serial).length
                          : units.length > 0
                            ? 1
                            : 0;
                        if (n === 0) {
                          return (
                            <span className="text-xs text-zinc-400">No tickets</span>
                          );
                        }
                        return (
                          <button
                            type="button"
                            disabled={busy || downloadingTicketsKey !== null}
                            onClick={() => handleAdminDownloadTickets(purchase)}
                            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                            title="Download ticket PDF(s) to send if buyer did not get email"
                          >
                            <Download
                              className={`h-3.5 w-3.5 ${busy ? "animate-pulse" : ""}`}
                            />
                            {busy
                              ? "…"
                              : n > 1
                                ? `Download (${n})`
                                : "Download"}
                          </button>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-zinc-500">
            Data from memory or Supabase. Use Download if a buyer did not receive their email - then send the PDF manually.
          </p>
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
                  <th className="p-4 text-left">Ticketing URL</th>
                  <th className="p-4 text-center">Ticket Types</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {eventsLoading && (
                  <tr><td colSpan={6} className="p-8 text-center text-zinc-400">Loading events...</td></tr>
                )}
                {!eventsLoading && events.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-zinc-400">
                    No events yet.<br />
                    Click "Add New Event" or use the "Seed Demo" button above to get started.
                  </td></tr>
                )}
                {events.map((ev) => {
                  const isEnabled = ev.enabled !== false;
                  const url = publicEventUrl(ev.slug);
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
                      <td className="p-4">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 max-w-xs">
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[11px] text-blue-700 hover:underline break-all"
                          >
                            {url}
                          </a>
                          <button
                            type="button"
                            onClick={() => copyText("Ticketing URL", url)}
                            className="inline-flex items-center gap-1 self-start text-xs px-2 py-1 rounded-lg border hover:bg-zinc-50 text-zinc-700 shrink-0"
                            title="Copy ticketing page URL"
                          >
                            <Copy className="h-3 w-3" />
                            Copy
                          </button>
                        </div>
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
                        <div className="flex justify-end gap-1 sm:gap-2">
                          <button
                            onClick={() => openEditEvent(ev)}
                            className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-600"
                            title="Edit"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openDuplicateEvent(ev)}
                            className="p-2 rounded-lg hover:bg-blue-50 text-blue-700"
                            title="Duplicate (same tickets & discounts; set new name & dates)"
                          >
                            <Copy className="h-4 w-4" />
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

      {/* SCANNER TAB - Admin-only redemption / check-in */}
      {activeTab === "scanner" && (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="mb-6">
            <h2 className="text-xl sm:text-2xl font-semibold">Ticket Scanner</h2>
            <p className="text-sm text-zinc-600 mt-1">
              Full admin scanner. Door staff should use{" "}
              <a href="/check-in" className="text-emerald-700 underline font-medium">
                /check-in
              </a>{" "}
              (limited accounts - no dashboard access).
            </p>
          </div>

          <div className="bg-white rounded-2xl border p-4 sm:p-8">
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">
                Ticket ID or Order Ref (from PDF QR - prefer KPY-…-001)
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
              <div className="mt-3">
                <label className="block text-xs font-medium text-zinc-500 mb-1">
                  Remarks (optional - saved with check-in)
                </label>
                <input
                  type="text"
                  value={scanRemark}
                  onChange={(e) => setScanRemark(e.target.value)}
                  placeholder="e.g. VIP guest, special note"
                  maxLength={500}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
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

      {/* ATTENDANCE TAB - derived from purchases (no separate Supabase table) */}
      {activeTab === "attendance" && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Attendance</h2>
              <p className="text-sm text-zinc-600 mt-1">
                Check-ins from the Scanner. One row per ticket serial when available.
                Data comes from the <strong>purchases</strong> table (ticket_breakdown + redeemed_at)  - {" "}
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
                  <th className="p-4 font-medium">Check-in time</th>
                  <th className="p-4 font-medium">Ticket details</th>
                  <th className="p-4 font-medium">Name</th>
                  <th className="p-4 font-medium">Phone</th>
                  <th className="p-4 font-medium">Checked in by</th>
                  <th className="p-4 font-medium">Remark</th>
                  <th className="p-4 font-medium hidden sm:table-cell">Email</th>
                  <th className="p-4 font-medium">Event</th>
                  <th className="p-4 font-medium hidden md:table-cell">Order Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(() => {
                  // Flatten to one attendance row per redeemed serial (or legacy order)
                  type AttRow = {
                    key: string;
                    redeemedAt: string;
                    ticketId: string;
                    ticketTypeLabel: string;
                    name: string;
                    email: string;
                    phone: string;
                    event: string;
                    orderRef: string;
                    checkedInBy: string;
                    remark: string;
                  };
                  const rows: AttRow[] = [];
                  for (const p of purchases) {
                    const units = p.ticket_breakdown || [];
                    const hasSerials = units.some((u: any) => u.serial);
                    if (hasSerials) {
                      for (const u of units as any[]) {
                        const last = u.redemptions?.[u.redemptions.length - 1];
                        if (!last) continue;
                        const at = redemptionAt(last);
                        if (!at) continue;
                        const typeName =
                          getTicketType(p.event_slug, u.ticketTypeId)?.name ||
                          u.ticketTypeId ||
                          "-";
                        rows.push({
                          key: `${p.id}-${u.serial}-${at}`,
                          redeemedAt: at,
                          ticketId: u.serial,
                          ticketTypeLabel: typeName,
                          name: p.name,
                          email: p.email,
                          phone: p.phone,
                          event: p.event_slug,
                          orderRef: p.order_reference || p.payment_reference || "",
                          checkedInBy: redemptionByName(last) || "-",
                          remark: redemptionRemark(last) || "-",
                        });
                      }
                    } else if (getCurrentRedemptionCount(p) > 0) {
                      const latest =
                        p.redemptions?.[p.redemptions.length - 1] || p.redeemed_at || "";
                      const at = redemptionAt(latest as any) || String(latest);
                      rows.push({
                        key: String(p.id ?? p.order_reference),
                        redeemedAt: at,
                        ticketId: p.order_reference || "-",
                        ticketTypeLabel: formatPurchaseTicketTypes(p),
                        name: p.name,
                        email: p.email,
                        phone: p.phone,
                        event: p.event_slug,
                        orderRef: p.order_reference || p.payment_reference || "",
                        checkedInBy: redemptionByName(latest as any) || "-",
                        remark: redemptionRemark(latest as any) || "-",
                      });
                    }
                  }
                  rows.sort((a, b) => b.redeemedAt.localeCompare(a.redeemedAt));

                  if (rows.length === 0) {
                    return (
                      <tr>
                        <td colSpan={9} className="p-10 text-center text-zinc-400">
                          {loading ? "Loading..." : "No redeemed tickets yet. Use Scanner or /check-in."}
                        </td>
                      </tr>
                    );
                  }
                  return rows.map((row) => (
                    <tr key={row.key} className="hover:bg-zinc-50/50">
                      <td className="p-4 text-xs text-emerald-700 font-medium whitespace-nowrap">
                        {formatDateTime(row.redeemedAt)}
                      </td>
                      <td className="p-4 text-xs">
                        <div className="font-medium text-zinc-900">{row.ticketTypeLabel}</div>
                        <div className="font-mono text-[11px] text-zinc-600 mt-0.5 break-all">
                          {row.ticketId}
                        </div>
                      </td>
                      <td className="p-4 font-medium">{row.name}</td>
                      <td className="p-4 text-sm font-medium text-zinc-800 whitespace-nowrap">
                        {row.phone || "-"}
                      </td>
                      <td className="p-4 text-sm text-zinc-700">{row.checkedInBy}</td>
                      <td className="p-4 text-sm text-zinc-600 max-w-[10rem] truncate" title={row.remark}>
                        {row.remark}
                      </td>
                      <td className="p-4 text-sm text-zinc-600 hidden sm:table-cell break-all">
                        {row.email || "-"}
                      </td>
                      <td className="p-4">
                        <span className="font-mono text-xs rounded bg-zinc-100 px-2 py-0.5">{row.event}</span>
                      </td>
                      <td className="p-4 font-mono text-xs text-zinc-600 hidden md:table-cell break-all">
                        {row.orderRef}
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-zinc-500">
            Door staff: share <strong>/check-in</strong>. Who / remarks appear after this deploy for new check-ins.
          </p>
        </div>
      )}

      {/* CHECK-IN STAFF ACCOUNTS */}
      {activeTab === "checkin-staff" && (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          <div>
            <h2 className="text-xl font-semibold">Check-in staff</h2>
            <p className="text-sm text-zinc-600 mt-1">
              Create accounts for door staff. They only use{" "}
              <a href="/check-in" className="text-teal-700 underline font-medium" target="_blank" rel="noreferrer">
                /check-in
              </a>{" "}
              - scan/check-in, remarks, and counts. No admin dashboard.
            </p>
          </div>

          <form
            onSubmit={handleCreateCheckinStaff}
            className="rounded-2xl border bg-white p-4 sm:p-6 space-y-3 shadow-sm"
          >
            <h3 className="font-medium text-sm">Create account</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-500">Username</label>
                <input
                  value={staffUser}
                  onChange={(e) => setStaffUser(e.target.value)}
                  required
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="door1"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Display name</label>
                <input
                  value={staffDisplay}
                  onChange={(e) => setStaffDisplay(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Alex (Gate A)"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-zinc-500">Password</label>
                <input
                  type="password"
                  value={staffPass}
                  onChange={(e) => setStaffPass(e.target.value)}
                  required
                  minLength={6}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={staffBusy}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-600 disabled:opacity-50"
            >
              {staffBusy ? "Creating…" : "Create check-in account"}
            </button>
          </form>

          <div className="rounded-2xl border bg-white overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-left">
                  <th className="p-3 font-medium">Username</th>
                  <th className="p-3 font-medium">Display name</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {checkinStaffList.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-zinc-400">
                      No check-in accounts yet. Create one above (run SQL for checkin_staff if create fails).
                    </td>
                  </tr>
                ) : (
                  checkinStaffList.map((s) => (
                    <tr key={s.id}>
                      <td className="p-3 font-mono text-xs">{s.username}</td>
                      <td className="p-3">{s.display_name}</td>
                      <td className="p-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            s.enabled
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {s.enabled ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <button
                          type="button"
                          className="text-xs underline text-zinc-600"
                          onClick={async () => {
                            await adminSetCheckinStaffEnabled(s.id, !s.enabled);
                            await loadCheckinStaff();
                          }}
                        >
                          {s.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          className="text-xs underline text-zinc-600"
                          onClick={async () => {
                            const pw = window.prompt("New password (min 6 chars)");
                            if (!pw) return;
                            const r = await adminResetCheckinStaffPassword(s.id, pw);
                            if (r.ok) toast.success("Password updated");
                            else toast.error(r.error || "Failed");
                          }}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          className="text-xs underline text-red-600"
                          onClick={async () => {
                            if (!window.confirm(`Delete ${s.username}?`)) return;
                            await adminDeleteCheckinStaff(s.id);
                            await loadCheckinStaff();
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ISSUE TICKETS - cash / offline payment after proof */}
      {activeTab === "issue" && (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="mb-6">
            <h2 className="text-xl font-semibold">Issue tickets manually</h2>
            <p className="text-sm text-zinc-600 mt-1">
              For cash, bank transfer, FPS, or any channel not on KPay. Verify payment proof first,
              then enter buyer + ticket details. Same fulfillment as online: order row, serials, confirmation email.
            </p>
          </div>

          {issueResult && (
            <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
              <p className="font-semibold text-emerald-900">Tickets issued</p>
              <dl className="mt-2 grid gap-1 text-sm text-emerald-900/90">
                <div>
                  <span className="text-emerald-700">Order ref: </span>
                  <span className="font-mono font-medium">{issueResult.orderReference}</span>
                </div>
                {issueResult.paymentReference && (
                  <div>
                    <span className="text-emerald-700">Payment ref: </span>
                    <span className="font-mono text-xs">{issueResult.paymentReference}</span>
                  </div>
                )}
                <div>
                  <span className="text-emerald-700">Tickets: </span>
                  {issueResult.ticketCount} ·{" "}
                  <span className="text-emerald-700">Amount: </span>
                  {issueResult.amount === 0
                    ? "Free / complimentary"
                    : `HKD ${issueResult.amount.toLocaleString()}`}
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`/${issueResult.eventSlug}/success?ref=${encodeURIComponent(issueResult.orderReference)}&amount=${issueResult.amount}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white hover:bg-emerald-800"
                >
                  Open ticket / success page
                </a>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(issueResult.orderReference);
                    toast.success("Order ref copied");
                  }}
                  className="inline-flex items-center rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm text-emerald-900 hover:bg-emerald-50"
                >
                  Copy order ref
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("purchases")}
                  className="inline-flex items-center rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm text-emerald-900 hover:bg-emerald-50"
                >
                  View purchases
                </button>
              </div>
            </div>
          )}

          <form
            onSubmit={handleIssueTickets}
            className="rounded-2xl border bg-white p-4 sm:p-6 space-y-6 shadow-sm"
          >
            <div>
              <label className="text-xs font-medium text-zinc-500">Event</label>
              <select
                value={issueEventSlug}
                onChange={(e) => {
                  setIssueEventSlug(e.target.value);
                  setIssueQtys({});
                  setIssueAmountOverride("");
                  setIssueResult(null);
                }}
                required
                className="mt-1 w-full border rounded-lg px-3 py-2.5 text-sm bg-white"
              >
                <option value="">
                  {eventsLoading ? "Loading events..." : "Select event..."}
                </option>
                {events.map((ev) => (
                  <option key={ev.slug} value={ev.slug}>
                    {ev.name} ({ev.slug})
                    {ev.enabled === false ? " - disabled" : ""}
                  </option>
                ))}
              </select>
            </div>

            {issueEvent && (
              <div>
                <label className="text-xs font-medium text-zinc-500">Tickets</label>
                <div className="mt-2 space-y-2">
                  {(issueEvent.ticketTypes || []).length === 0 ? (
                    <p className="text-sm text-amber-700">
                      This event has no ticket types. Add them under Events first.
                    </p>
                  ) : (
                    (issueEvent.ticketTypes || []).map((tt) => (
                      <div
                        key={tt.id}
                        className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${
                          tt.enabled === false ? "opacity-50 bg-zinc-50" : "bg-zinc-50/50"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm">{tt.name}</div>
                          <div className="text-xs text-zinc-500 font-mono">
                            {tt.id} · {tt.currency || "HKD"} {Number(tt.price) || 0}
                            {tt.enabled === false ? " · disabled" : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-zinc-500">Qty</label>
                          <input
                            type="number"
                            min={0}
                            max={50}
                            disabled={tt.enabled === false}
                            value={issueQtys[tt.id] ?? 0}
                            onChange={(e) =>
                              setIssueQtys((prev) => ({
                                ...prev,
                                [tt.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                              }))
                            }
                            className="w-20 border rounded-lg px-2 py-1.5 text-sm text-center"
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {issueTicketCount > 0 && (
                  <p className="mt-2 text-sm text-zinc-600">
                    Catalog total:{" "}
                    <strong>
                      {issueEvent.ticketTypes?.[0]?.currency || "HKD"}{" "}
                      {issueCatalogTotal.toLocaleString()}
                    </strong>{" "}
                    · {issueTicketCount} ticket{issueTicketCount === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-zinc-500">Buyer name</label>
                <input
                  value={issueBuyerName}
                  onChange={(e) => setIssueBuyerName(e.target.value)}
                  required
                  placeholder="Full name"
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Phone</label>
                <input
                  value={issueBuyerPhone}
                  onChange={(e) => setIssueBuyerPhone(e.target.value)}
                  required
                  type="tel"
                  placeholder="+852 …"
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Email</label>
                <input
                  value={issueBuyerEmail}
                  onChange={(e) => setIssueBuyerEmail(e.target.value)}
                  required
                  type="email"
                  placeholder="for ticket confirmation"
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-zinc-500">Payment method</label>
                <select
                  value={issuePaymentMethod}
                  onChange={(e) => setIssuePaymentMethod(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 py-2.5 text-sm bg-white"
                >
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="fps">FPS</option>
                  <option value="alipay_offline">Alipay (offline / proof)</option>
                  <option value="wechat_offline">WeChat Pay (offline / proof)</option>
                  <option value="other">Other</option>
                  <option value="free">Free / complimentary</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">
                  Amount override (optional)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={issueAmountOverride}
                  onChange={(e) => setIssueAmountOverride(e.target.value)}
                  placeholder={
                    issuePaymentMethod === "free"
                      ? "0 (free)"
                      : `Default ${issueCatalogTotal}`
                  }
                  disabled={issuePaymentMethod === "free"}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm disabled:bg-zinc-100"
                />
                <p className="mt-1 text-[11px] text-zinc-400">
                  Leave blank to use catalog total. Free method forces 0.
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-zinc-500">
                  Payment proof note (optional)
                </label>
                <input
                  value={issueNote}
                  onChange={(e) => setIssueNote(e.target.value)}
                  placeholder="e.g. FPS ref, bank last 4 digits, receipt no."
                  maxLength={120}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
              <button
                type="submit"
                disabled={issueSubmitting || !issueEventSlug || issueTicketCount === 0}
                className="rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {issueSubmitting ? "Issuing…" : "Issue tickets"}
              </button>
              <button
                type="button"
                onClick={resetIssueForm}
                className="rounded-lg border px-4 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                Clear form
              </button>
              <p className="text-xs text-zinc-500 w-full sm:w-auto sm:ml-auto">
                Creates a <span className="font-mono">MAN-…</span> order. Buyer gets the usual confirmation email when possible.
              </p>
            </div>
          </form>
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

                {/* Full page theme (public ticketing page) */}
                <div className="md:col-span-2 rounded-xl border bg-zinc-50/80 p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-medium text-zinc-600">
                        Ticketing page theme
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        Optional full theme. Leave empty for default white-gold. Body text stays
                        dark for readability.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-zinc-500 hover:text-black underline shrink-0"
                      onClick={() =>
                        setEventForm({
                          ...eventForm,
                          primaryColor: "",
                          secondaryColor: "",
                          backgroundColor: "",
                          surfaceColor: "",
                        })
                      }
                    >
                      Reset all to default
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {(
                      [
                        {
                          key: "primaryColor" as const,
                          label: "Primary (buttons / accents)",
                          fallback: DEFAULT_PRIMARY,
                        },
                        {
                          key: "secondaryColor" as const,
                          label: "Secondary (labels / muted)",
                          fallback: DEFAULT_SECONDARY,
                        },
                        {
                          key: "backgroundColor" as const,
                          label: "Page background",
                          fallback: DEFAULT_PAGE_BG,
                        },
                        {
                          key: "surfaceColor" as const,
                          label: "Cards / panels",
                          fallback: DEFAULT_SURFACE,
                        },
                      ] as const
                    ).map((field) => (
                      <div key={field.key}>
                        <label className="text-xs font-medium text-zinc-500">
                          {field.label}
                        </label>
                        <div className="mt-1 flex items-center gap-2">
                          <input
                            type="color"
                            value={
                              /^#[0-9A-Fa-f]{6}$/.test(eventForm[field.key])
                                ? eventForm[field.key]
                                : field.fallback
                            }
                            onChange={(e) =>
                              setEventForm({
                                ...eventForm,
                                [field.key]: e.target.value,
                              })
                            }
                            className="h-10 w-12 cursor-pointer rounded border bg-white p-0.5"
                          />
                          <input
                            type="text"
                            value={eventForm[field.key]}
                            onChange={(e) =>
                              setEventForm({
                                ...eventForm,
                                [field.key]: e.target.value,
                              })
                            }
                            placeholder={field.fallback}
                            className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
                          />
                          {eventForm[field.key] && (
                            <button
                              type="button"
                              className="text-xs text-zinc-500 hover:text-black underline"
                              onClick={() =>
                                setEventForm({ ...eventForm, [field.key]: "" })
                              }
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div
                    className="rounded-lg border p-3 text-xs"
                    style={{
                      background:
                        eventForm.backgroundColor || DEFAULT_PAGE_BG,
                      borderColor: "#e4e4e7",
                    }}
                  >
                    <div
                      className="rounded-md border p-3"
                      style={{
                        background: eventForm.surfaceColor || DEFAULT_SURFACE,
                        borderColor: "#e4e4e7",
                      }}
                    >
                      <div
                        className="font-medium"
                        style={{
                          color: eventForm.secondaryColor || DEFAULT_SECONDARY,
                        }}
                      >
                        Label preview
                      </div>
                      <div className="mt-2 text-[#2C2520]">Body text stays dark</div>
                      <div
                        className="mt-2 inline-block rounded px-3 py-1.5 text-white text-[11px] font-medium"
                        style={{
                          background:
                            eventForm.primaryColor || DEFAULT_PRIMARY,
                        }}
                      >
                        Button preview
                      </div>
                    </div>
                  </div>
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

                {/* Shared seating by day (accumulated inventory) */}
                <div className="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50/40 p-4 space-y-3">
                  <div>
                    <div className="text-sm font-medium">
                      Event days and seating capacity
                    </div>
                    <p className="text-xs text-zinc-600 mt-1">
                      Define each admission day with its max seats (can differ by
                      day). Capacity is shared across ticket types. Selling one
                      multi-day ticket deducts one seat from every covered day.
                      You can raise capacity anytime; you cannot set it below
                      seats already sold. Leave empty for no shared day pool
                      (per-type stock only).
                    </p>
                  </div>
                  {seatDaysForm.length > 0 && (
                    <div className="space-y-2">
                      {seatDaysForm.map((sd, idx) => (
                        <div
                          key={idx}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <label className="text-xs text-zinc-500">
                            Date
                            <input
                              type="date"
                              value={sd.date}
                              onChange={(e) => {
                                const next = [...seatDaysForm];
                                next[idx] = {
                                  ...next[idx],
                                  date: e.target.value,
                                };
                                setSeatDaysForm(next);
                              }}
                              className="mt-0.5 block border rounded-lg px-2 py-1.5 text-sm"
                            />
                          </label>
                          <label className="text-xs text-zinc-500">
                            Capacity (seats)
                            <input
                              type="number"
                              min={0}
                              value={sd.capacity}
                              onChange={(e) => {
                                const next = [...seatDaysForm];
                                next[idx] = {
                                  ...next[idx],
                                  capacity: Math.max(
                                    0,
                                    parseInt(e.target.value) || 0
                                  ),
                                };
                                setSeatDaysForm(next);
                              }}
                              className="mt-0.5 block w-28 border rounded-lg px-2 py-1.5 text-sm"
                            />
                          </label>
                          <button
                            type="button"
                            className="text-xs text-red-600 border border-red-200 rounded-lg px-2 py-1.5 hover:bg-red-50"
                            onClick={() =>
                              setSeatDaysForm(
                                seatDaysForm.filter((_, i) => i !== idx)
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-xs border rounded-lg px-3 py-1.5 hover:bg-white bg-white/80"
                      onClick={() =>
                        setSeatDaysForm([
                          ...seatDaysForm,
                          {
                            date: eventForm.date || "",
                            capacity: 600,
                          },
                        ])
                      }
                    >
                      + Add seat day
                    </button>
                    {eventForm.date && eventForm.endDate && eventForm.endDate !== eventForm.date && (
                      <button
                        type="button"
                        className="text-xs border rounded-lg px-3 py-1.5 hover:bg-white bg-white/80"
                        onClick={() => {
                          // Fill from event start..end (calendar range, max 14 days)
                          const start = eventForm.date;
                          const end = eventForm.endDate;
                          if (!start || !end || end < start) return;
                          const days: SeatDayCapacity[] = [];
                          const d = new Date(start + "T12:00:00");
                          const endD = new Date(end + "T12:00:00");
                          let n = 0;
                          while (d <= endD && n < 14) {
                            const ymd = d.toISOString().slice(0, 10);
                            if (!seatDaysForm.some((s) => s.date === ymd)) {
                              days.push({ date: ymd, capacity: 600 });
                            }
                            d.setDate(d.getDate() + 1);
                            n++;
                          }
                          if (days.length) {
                            setSeatDaysForm(
                              [...seatDaysForm, ...days].sort((a, b) =>
                                a.date.localeCompare(b.date)
                              )
                            );
                          }
                        }}
                      >
                        + Fill from event dates (600 each)
                      </button>
                    )}
                  </div>
                </div>

                {/* Optional donation at checkout */}
                <div className="md:col-span-2 rounded-xl border border-rose-100 bg-rose-50/40 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="donationEnabled"
                      checked={eventForm.donationEnabled}
                      onChange={(e) =>
                        setEventForm({
                          ...eventForm,
                          donationEnabled: e.target.checked,
                        })
                      }
                    />
                    <label htmlFor="donationEnabled" className="text-sm font-medium">
                      Enable optional donation at checkout
                    </label>
                  </div>
                  <p className="text-xs text-zinc-600 pl-6">
                    On the ticket selection step, buyers can check a donation box
                    and edit the amount (default below; any amount allowed). For
                    events with tickets, a ticket is still required; donation is
                    optional. Free events with no tickets can donate only.
                    Charged with the order; stored in the donations table.
                  </p>
                  {eventForm.donationEnabled && (
                    <div className="pl-6 max-w-xs">
                      <label className="text-xs font-medium text-zinc-500">
                        Default donation amount (HKD)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={eventForm.donationDefaultAmount}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            donationDefaultAmount: Math.max(
                              0,
                              Number(e.target.value) || 0
                            ),
                          })
                        }
                        className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  )}
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
                  <p className="text-[10px] text-zinc-500 mt-1">
                    Legacy full-page background (used only when no design is published). Prefer the visual designer below.
                  </p>
                </div>

                {/* Visual ticket designer (PRD) */}
                <div className="md:col-span-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <label className="text-sm font-semibold">Ticket design</label>
                      <p className="text-[11px] text-zinc-500">
                        Size, orientation, background, text, dynamic fields, QR. Publish to use on live PDFs; draft keeps legacy layout.
                      </p>
                    </div>
                  </div>
                  <TicketDesignEditor
                    value={ticketDesign}
                    onChange={setTicketDesign}
                    onUploadImage={async (file) => {
                      try {
                        const formData = new FormData();
                        formData.append("file", file);
                        formData.append("slug", eventForm.slug || "ticket-design");
                        formData.append("kind", "banner");
                        const res = await fetch("/api/admin/upload", {
                          method: "POST",
                          body: formData,
                        });
                        const json = await res.json();
                        if (json?.path) return json.path as string;
                        // fallback data URL
                        return await new Promise<string>((resolve) => {
                          const r = new FileReader();
                          r.onload = () => resolve(String(r.result));
                          r.readAsDataURL(file);
                        });
                      } catch {
                        return null;
                      }
                    }}
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
                      <div key={idx} className="p-3 sm:p-4 flex flex-col gap-3 text-sm">
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500 flex-1 min-w-[12rem]">
                            Ticket name
                            <input
                              type="text"
                              value={t.name}
                              onChange={(e) =>
                                setTicketTypesForm(
                                  ticketTypesForm.map((tt) =>
                                    tt.id === t.id
                                      ? { ...tt, name: e.target.value }
                                      : tt
                                  )
                                )
                              }
                              className="w-full border rounded-lg px-2 py-1.5 text-sm text-zinc-900 font-medium"
                              placeholder="Ticket name"
                            />
                          </label>
                          <span className="font-mono text-xs text-zinc-400 pb-2">
                            ID: {t.id}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                          <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                            Price ({t.currency || "HKD"})
                            <input
                              type="number"
                              value={t.price}
                              onChange={(e) =>
                                updateTicketPrice(t.id, parseFloat(e.target.value) || 0)
                              }
                              className="w-full border rounded-lg px-2 py-1.5 text-sm text-zinc-900 text-right"
                            />
                          </label>
                          <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                            Max per order
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
                              className="w-full border rounded-lg px-2 py-1.5 text-sm text-zinc-900 text-center"
                              min="1"
                            />
                          </label>
                          <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                            Stock (empty = unlimited)
                            <input
                              type="number"
                              value={t.quantityAvailable ?? ""}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const val =
                                  raw === ""
                                    ? undefined
                                    : Math.max(0, parseInt(raw) || 0);
                                setTicketTypesForm(
                                  ticketTypesForm.map((tt) =>
                                    tt.id === t.id
                                      ? { ...tt, quantityAvailable: val }
                                      : tt
                                  )
                                );
                              }}
                              className="w-full border rounded-lg px-2 py-1.5 text-sm text-zinc-900 text-center"
                              min="0"
                              placeholder="∞"
                            />
                          </label>
                          <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                            Scan redemptions allowed
                            <input
                              type="number"
                              value={t.redemptionLimit ?? 1}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 1;
                                setTicketTypesForm(
                                  ticketTypesForm.map((tt) =>
                                    tt.id === t.id
                                      ? { ...tt, redemptionLimit: val }
                                      : tt
                                  )
                                );
                              }}
                              className="w-full border rounded-lg px-2 py-1.5 text-sm text-zinc-900 text-center"
                              min="1"
                            />
                          </label>
                          <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                            Valid from (HK)
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
                              className="w-full border rounded-lg px-2 py-1.5 text-sm text-zinc-900"
                            />
                          </label>
                          <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                            Valid to (HK)
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
                              className="w-full border rounded-lg px-2 py-1.5 text-sm text-zinc-900"
                            />
                          </label>
                          {seatDaysForm.length > 0 && (
                            <div className="sm:col-span-2 md:col-span-3 lg:col-span-4">
                              <div className="text-[11px] text-zinc-500 mb-1">
                                Day coverage (select event days this type admits to).
                                After sales of this type, coverage is locked: archive
                                (hide) the type and create a new one to change it.
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {seatDaysForm.map((sd) => {
                                  const checked = (t.coveredDays || []).includes(
                                    sd.date
                                  );
                                  return (
                                    <label
                                      key={sd.date}
                                      className={`inline-flex items-center gap-1.5 text-xs border rounded-lg px-2 py-1 cursor-pointer ${
                                        checked
                                          ? "bg-blue-50 border-blue-300 text-blue-900"
                                          : "bg-white border-zinc-200"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          setTicketTypesForm(
                                            ticketTypesForm.map((tt) => {
                                              if (tt.id !== t.id) return tt;
                                              const cur = new Set(
                                                tt.coveredDays || []
                                              );
                                              if (e.target.checked) cur.add(sd.date);
                                              else cur.delete(sd.date);
                                              const list = [...cur].sort();
                                              // Keep validFrom/to in sync with min/max coverage
                                              return {
                                                ...tt,
                                                coveredDays: list,
                                                validFrom: list[0] || tt.validFrom,
                                                validTo:
                                                  list[list.length - 1] ||
                                                  tt.validTo,
                                              };
                                            })
                                          );
                                        }}
                                      />
                                      {sd.date}
                                      <span className="text-zinc-400">
                                        ({sd.capacity})
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleTicketType(t.id)}
                            className={`px-3 py-1.5 rounded text-xs font-medium ${t.enabled !== false ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-600"}`}
                            title="Show or hide this type on the public ticketing page"
                          >
                            {t.enabled !== false ? "Visible" : "Hidden"}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleTicketTypeFree(t.id)}
                            className={`px-3 py-1.5 rounded text-xs font-medium ${t.isFree ? "bg-sky-100 text-sky-800" : "bg-zinc-100 text-zinc-600 border"}`}
                            title="Free types never call KPay; tickets issue immediately when the cart is free"
                          >
                            {t.isFree ? "Free (no payment)" : "Paid"}
                          </button>
                          <button
                            type="button"
                            onClick={() => addDiscountToTicket(t.id)}
                            className="text-xs px-2 py-1.5 border rounded hover:bg-white"
                          >
                            + Ticket discount rule
                          </button>
                          <button
                            type="button"
                            onClick={() => duplicateTicketType(t.id)}
                            className="text-xs px-2 py-1.5 border rounded hover:bg-blue-50 text-blue-700 inline-flex items-center gap-1"
                            title="Copy into form below (not added until you click Add)"
                          >
                            <Copy className="h-3 w-3" /> Copy to form
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTicketType(t.id)}
                            className="text-red-500 text-xs px-2 py-1.5"
                          >
                            Remove type
                          </button>
                          {!t.validFrom && !t.validTo && (
                            <span className="text-[11px] text-zinc-400">
                              Scanner: valid any day
                            </span>
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
                                <button onClick={() => removeDiscount(t.id, d.id)} className="ml-auto text-red-400 hover:text-red-600">x</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new ticket type (also used when duplicating) */}
                <div
                  id="add-ticket-type-form"
                  className="border rounded-xl p-4 bg-zinc-50"
                >
                  <p className="text-xs font-medium text-zinc-700 mb-1">
                    Add new ticket type
                  </p>
                  {(newTicket.discounts?.length || 0) > 0 && (
                    <p className="text-[11px] text-blue-700 mb-2">
                      Copied from another type - including{" "}
                      {newTicket.discounts!.length} discount rule(s). Fill in{" "}
                      <strong>name</strong> (and dates if needed), then add.
                    </p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                      Type ID (unique, e.g. d-1)
                      <input
                        placeholder="d-1"
                        value={newTicket.id}
                        onChange={(e) => setNewTicket({ ...newTicket, id: e.target.value })}
                        className="border px-3 py-2 rounded-lg text-sm text-zinc-900 font-mono"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                      Display name
                      <input
                        placeholder="Day 1"
                        value={newTicket.name}
                        onChange={(e) => setNewTicket({ ...newTicket, name: e.target.value })}
                        className="border px-3 py-2 rounded-lg text-sm text-zinc-900"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                      Price (HKD)
                      <input
                        type="number"
                        placeholder="0"
                        value={newTicket.price}
                        onChange={(e) =>
                          setNewTicket({
                            ...newTicket,
                            price: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="border px-3 py-2 rounded-lg text-sm text-zinc-900"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                      Max per order
                      <input
                        type="number"
                        placeholder="6"
                        value={newTicket.maxPerOrder ?? 6}
                        onChange={(e) =>
                          setNewTicket({
                            ...newTicket,
                            maxPerOrder: Math.max(1, parseInt(e.target.value) || 6),
                          })
                        }
                        className="border px-3 py-2 rounded-lg text-sm text-zinc-900"
                        min="1"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                      Stock total (empty = unlimited)
                      <input
                        type="number"
                        placeholder="∞"
                        value={newTicket.quantityAvailable ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setNewTicket({
                            ...newTicket,
                            quantityAvailable:
                              raw === ""
                                ? undefined
                                : Math.max(0, parseInt(raw) || 0),
                          });
                        }}
                        className="border px-3 py-2 rounded-lg text-sm text-zinc-900"
                        min="0"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                      Scan redemptions allowed
                      <input
                        type="number"
                        placeholder="1"
                        value={newTicket.redemptionLimit ?? 1}
                        onChange={(e) =>
                          setNewTicket({
                            ...newTicket,
                            redemptionLimit: parseInt(e.target.value) || 1,
                          })
                        }
                        className="border px-3 py-2 rounded-lg text-sm text-zinc-900"
                        min="1"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-zinc-700 sm:col-span-2 pt-2">
                      <input
                        type="checkbox"
                        checked={newTicket.isFree === true}
                        onChange={(e) =>
                          setNewTicket({ ...newTicket, isFree: e.target.checked })
                        }
                      />
                      Free ticket type (no KPay - issues ticket codes immediately)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-zinc-700 sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={newTicket.enabled !== false}
                        onChange={(e) =>
                          setNewTicket({ ...newTicket, enabled: e.target.checked })
                        }
                      />
                      Visible to public on ticketing page
                    </label>
                    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                      Valid from (HK date)
                      <input
                        type="date"
                        value={newTicket.validFrom || ""}
                        onChange={(e) =>
                          setNewTicket({ ...newTicket, validFrom: e.target.value })
                        }
                        className="border px-3 py-2 rounded-lg text-sm text-zinc-900"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                      Valid to (HK date)
                      <input
                        type="date"
                        value={newTicket.validTo || ""}
                        onChange={(e) =>
                          setNewTicket({ ...newTicket, validTo: e.target.value })
                        }
                        className="border px-3 py-2 rounded-lg text-sm text-zinc-900"
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={addTicketType}
                        className="w-full bg-white border rounded-lg text-sm py-2 hover:bg-zinc-50 font-medium"
                      >
                        + Add ticket type
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-3 leading-relaxed">
                    <strong>Type ID</strong> must be unique per event.{" "}
                    <strong>Stock</strong> = total for sale (empty = unlimited).{" "}
                    <strong>Scan redemptions</strong> = how many times door can scan one ticket.{" "}
                    <strong>Valid from/to</strong> = scanner only accepts on those days (HK). Leave empty = any day.
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
