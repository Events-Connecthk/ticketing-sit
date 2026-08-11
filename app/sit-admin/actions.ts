"use server";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { EventConfig, PurchaseRecord } from "@/types";
import {
  clearAdminSession,
  createAdminSession,
  getExpectedAdminPassword,
  isAdminSessionValid,
  requireAdmin,
  safeEqual,
} from "@/lib/security/admin-session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  createCheckinStaff,
  deleteCheckinStaff,
  listCheckinStaff,
  resetCheckinStaffPassword,
  setCheckinStaffEnabled,
  type CheckinStaffPublic,
} from "@/lib/db/checkin-staff";
import {
  performCheckIn,
  type CheckInResult,
} from "@/lib/tickets/checkin-service";

/**
 * Login: verify password (rate-limited) and set httpOnly session cookie.
 * Do not use NEXT_PUBLIC_* for the real password.
 */
export async function verifyAdminPassword(
  inputPassword: string
): Promise<boolean> {
  const rl = checkRateLimit("admin-login", { limit: 8, windowMs: 15 * 60 * 1000 });
  if (!rl.ok) {
    console.warn("[Admin] Login rate limited");
    return false;
  }

  const expected = getExpectedAdminPassword();
  if (!expected) {
    console.error(
      "[Admin] ADMIN_PASSWORD is not set. Refusing login in production-safe mode."
    );
    return false;
  }

  const ok = safeEqual(String(inputPassword || ""), expected);
  if (ok) {
    await createAdminSession();
  }
  return ok;
}

/** Restore UI login state after refresh if cookie still valid. */
export async function checkAdminSession(): Promise<boolean> {
  return isAdminSessionValid();
}

export async function logoutAdmin(): Promise<void> {
  await clearAdminSession();
}

function mapRowToEventConfig(data: any): EventConfig {
  const meta = (data.metadata || {}) as Record<string, unknown>;
  return {
    slug: data.slug,
    name: data.name,
    description: data.description || "",
    date: data.date,
    endDate: data.end_date || data.endDate || undefined,
    time: data.time || "",
    location: data.location,
    image: data.image || undefined,
    enabled: data.enabled !== false,
    paymentEnabled: data.payment_enabled !== false && data.paymentEnabled !== false,
    ticketTemplate: data.ticket_template || data.ticketTemplate || undefined,
    donationEnabled:
      meta.donationEnabled === true || data.donation_enabled === true,
    donationDefaultAmount:
      meta.donationDefaultAmount != null
        ? Number(meta.donationDefaultAmount)
        : data.donation_default_amount != null
          ? Number(data.donation_default_amount)
          : undefined,
    seatDays: (() => {
      const raw = Array.isArray(meta.seatDays)
        ? meta.seatDays
        : Array.isArray(data.seatDays)
          ? data.seatDays
          : [];
      const days = raw
        .map((s: any) => ({
          date: String(s?.date || "").slice(0, 10),
          capacity: Math.max(0, Number(s?.capacity) || 0),
        }))
        .filter((s: { date: string }) => /^\d{4}-\d{2}-\d{2}$/.test(s.date));
      return days.length ? days : undefined;
    })(),
    hideSeatCounts: meta.hideSeatCounts === true ? true : undefined,
    adminNotifyEmail:
      typeof meta.adminNotifyEmail === "string" && meta.adminNotifyEmail.trim()
        ? String(meta.adminNotifyEmail).trim()
        : undefined,
    termsEnabled: meta.termsEnabled === true ? true : undefined,
    termsUrl:
      typeof meta.termsUrl === "string" && meta.termsUrl.trim()
        ? String(meta.termsUrl).trim()
        : undefined,
    ticketTypes: (data.ticket_types || data.ticketTypes || []).map((t: any) => ({
      ...t,
      enabled: t.enabled !== false,
      discounts: t.discounts || [],
    })),
    buyerFormFields: data.buyer_form_fields || data.buyerFormFields || [],
    discountCodes: data.discount_codes || data.discountCodes || [],
    metadata: data.metadata,
  };
}

/**
 * Public: sold counts per ticket type for an event (for inventory UI).
 * Uses service role so it works with RLS blocking anon SELECT on purchases.
 */
export async function getEventTicketSoldCounts(
  eventSlug: string
): Promise<Record<string, number>> {
  const inv = await getEventInventory(eventSlug);
  return inv.soldByType;
}

/**
 * Public inventory: sold by ticket type + sold by seat day (shared capacity).
 */
export async function getEventInventory(eventSlug: string): Promise<{
  soldByType: Record<string, number>;
  soldByDay: Record<string, number>;
}> {
  const empty = { soldByType: {}, soldByDay: {} };
  if (!eventSlug) return empty;
  try {
    const { countSoldByTicketType, countSoldBySeatDay } = await import(
      "@/lib/tickets/inventory"
    );
    const { loadEventBySlug } = await import("@/lib/config/events");
    const event = await loadEventBySlug(eventSlug);

    let rows: any[] = [];
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      const { getAllPurchases } = await import("@/lib/db/purchases");
      rows = await getAllPurchases({ eventSlug });
    } else {
      const { data, error } = await supabaseAdmin
        .from("purchases")
        .select("ticket_breakdown, number_of_tickets")
        .eq("event_slug", eventSlug);
      if (error) {
        console.error("[Admin Actions] getEventInventory:", error);
        return empty;
      }
      rows = data || [];
    }

    const soldByType = countSoldByTicketType(rows);
    const soldByDay = countSoldBySeatDay(
      rows,
      event?.ticketTypes || [],
      event?.seatDays
    );
    return { soldByType, soldByDay };
  } catch (err) {
    console.error("[Admin Actions] getEventInventory error:", err);
    return empty;
  }
}

/**
 * Admin-only: list events with service role (always fresh after save).
 */
export async function adminGetAllEvents(): Promise<EventConfig[]> {
  try {
    await requireAdmin();
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      const { getAllEvents } = await import("@/lib/db/events");
      return getAllEvents();
    }
    const { data, error } = await supabaseAdmin
      .from("events")
      .select("*")
      .order("name", { ascending: true });
    if (error) {
      console.error("[Admin Actions] adminGetAllEvents error:", error);
      return [];
    }
    return (data || []).map(mapRowToEventConfig);
  } catch (err) {
    console.error("[Admin Actions] adminGetAllEvents error:", err);
    return [];
  }
}

export type AdminSaveEventResult = {
  ok: boolean;
  event?: EventConfig | null;
  error?: string;
};

/**
 * Admin-only: Save event using SERVICE_ROLE (bypasses RLS).
 * Enforces FR 6.1 capacity floor and 6.2 coverage immutability after sales.
 */
export async function adminSaveEvent(
  event: EventConfig
): Promise<EventConfig | null> {
  const res = await adminSaveEventDetailed(event);
  return res.ok ? res.event ?? null : null;
}

export async function adminSaveEventDetailed(
  event: EventConfig
): Promise<AdminSaveEventResult> {
  try {
    await requireAdmin();
    const cleanEvent = {
      ...event,
      slug: event.slug.toLowerCase().trim(),
      ticketTypes: event.ticketTypes || [],
      buyerFormFields: event.buyerFormFields || [],
      discountCodes: event.discountCodes || [],
    };

    // Load prior event + sold counts for FR validation
    let previous: EventConfig | null = null;
    try {
      const { loadEventBySlug } = await import("@/lib/config/events");
      previous = await loadEventBySlug(cleanEvent.slug);
    } catch {
      /* new event */
    }

    const {
      validateSeatDayCapacityChanges,
      validateTicketCoverageImmutable,
      buildCapacityAuditEntries,
      filterValidPurchases,
    } = await import("@/lib/tickets/capacity");
    const { countSoldBySeatDay, countSoldByTicketType } = await import(
      "@/lib/tickets/inventory"
    );

    let purchases: any[] = [];
    try {
      const supabaseAdmin = getSupabaseAdmin();
      if (supabaseAdmin) {
        const { data } = await supabaseAdmin
          .from("purchases")
          .select("ticket_breakdown, number_of_tickets, payment_method")
          .eq("event_slug", cleanEvent.slug);
        purchases = data || [];
      } else {
        const { getAllPurchases } = await import("@/lib/db/purchases");
        purchases = await getAllPurchases({ eventSlug: cleanEvent.slug });
      }
    } catch {
      purchases = [];
    }
    const validPurchases = filterValidPurchases(purchases);
    const soldByDay = countSoldBySeatDay(
      validPurchases,
      previous?.ticketTypes || cleanEvent.ticketTypes,
      previous?.seatDays || cleanEvent.seatDays
    );
    const soldByType = countSoldByTicketType(validPurchases);

    const capCheck = validateSeatDayCapacityChanges(
      previous?.seatDays,
      cleanEvent.seatDays,
      soldByDay
    );
    if (!capCheck.ok) {
      return { ok: false, error: capCheck.error };
    }

    const covCheck = validateTicketCoverageImmutable(
      previous?.ticketTypes,
      cleanEvent.ticketTypes,
      soldByType,
      cleanEvent.seatDays || previous?.seatDays
    );
    if (!covCheck.ok) {
      return { ok: false, error: covCheck.error };
    }

    // Ticket types with seat days must have non-empty coverage
    if (cleanEvent.seatDays && cleanEvent.seatDays.length > 0) {
      const daySet = new Set(cleanEvent.seatDays.map((s) => s.date));
      for (const t of cleanEvent.ticketTypes) {
        if (t.enabled === false || t.archived) continue;
        const cov = (t.coveredDays || []).filter((d) => daySet.has(d));
        const hasRange = Boolean(t.validFrom || t.validTo);
        if (cov.length === 0 && !hasRange) {
          return {
            ok: false,
            error: `Ticket type "${t.name}" needs day coverage (select event days or set valid from/to).`,
          };
        }
      }
    }

    const meta = {
      ...((cleanEvent.metadata || {}) as Record<string, unknown>),
    };
    if (cleanEvent.donationEnabled) {
      meta.donationEnabled = true;
      meta.donationDefaultAmount = Math.max(
        0,
        Number(cleanEvent.donationDefaultAmount) || 0
      );
    } else {
      delete meta.donationEnabled;
      delete meta.donationDefaultAmount;
    }

    if (cleanEvent.seatDays && cleanEvent.seatDays.length > 0) {
      meta.seatDays = cleanEvent.seatDays
        .map((s) => ({
          date: String(s.date || "").slice(0, 10),
          capacity: Math.max(0, Number(s.capacity) || 0),
        }))
        .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date));
      if (!(meta.seatDays as unknown[]).length) delete meta.seatDays;
    } else {
      delete meta.seatDays;
    }

    if (cleanEvent.hideSeatCounts) {
      meta.hideSeatCounts = true;
    } else {
      delete meta.hideSeatCounts;
    }

    if (
      cleanEvent.adminNotifyEmail &&
      String(cleanEvent.adminNotifyEmail).trim()
    ) {
      meta.adminNotifyEmail = String(cleanEvent.adminNotifyEmail)
        .trim()
        .slice(0, 500);
    } else {
      delete meta.adminNotifyEmail;
    }

    if (cleanEvent.termsEnabled) {
      meta.termsEnabled = true;
      if (cleanEvent.termsUrl && String(cleanEvent.termsUrl).trim()) {
        meta.termsUrl = String(cleanEvent.termsUrl).trim().slice(0, 2000);
      } else {
        delete meta.termsUrl; // use platform default PDF
      }
    } else {
      delete meta.termsEnabled;
      delete meta.termsUrl;
    }

    // FR 6.1 audit log for capacity changes
    const auditEntries = buildCapacityAuditEntries(
      previous?.seatDays,
      cleanEvent.seatDays,
      "admin"
    );
    if (auditEntries.length) {
      const prevLog = Array.isArray(meta.capacityAudit)
        ? (meta.capacityAudit as unknown[])
        : [];
      meta.capacityAudit = [...prevLog, ...auditEntries].slice(-200);
    }

    const upsertPayload: Record<string, unknown> = {
      slug: cleanEvent.slug,
      name: cleanEvent.name,
      description: cleanEvent.description || null,
      date: cleanEvent.date,
      end_date: cleanEvent.endDate || null,
      time: cleanEvent.time || null,
      location: cleanEvent.location,
      enabled: cleanEvent.enabled !== false,
      payment_enabled: cleanEvent.paymentEnabled !== false,
      ticket_types: cleanEvent.ticketTypes,
      buyer_form_fields: cleanEvent.buyerFormFields,
      discount_codes: cleanEvent.discountCodes,
      ticket_template: cleanEvent.ticketTemplate || null,
      image: cleanEvent.image || null,
      metadata: meta,
    };

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      console.warn("[Admin] No service role key - saving to memory only");
      const { saveEvent } = await import("@/lib/db/events");
      const saved = await saveEvent({
        ...cleanEvent,
        metadata: meta,
      } as EventConfig);
      return { ok: true, event: saved };
    }

    let { data, error } = await supabaseAdmin
      .from("events")
      .upsert(upsertPayload)
      .select()
      .single();

    if (error && (error.code === "PGRST204" || error.message?.includes("column"))) {
      console.warn(
        "[Admin Actions] Event upsert missing columns, retrying minimal payload:",
        error.message
      );
      const minimal = {
        slug: upsertPayload.slug,
        name: upsertPayload.name,
        description: upsertPayload.description,
        date: upsertPayload.date,
        time: upsertPayload.time,
        location: upsertPayload.location,
        enabled: upsertPayload.enabled,
        ticket_types: upsertPayload.ticket_types,
        metadata: upsertPayload.metadata,
      };
      const retry = await supabaseAdmin
        .from("events")
        .upsert(minimal)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error("[Admin Actions] Supabase event save error:", error);
      return { ok: false, error: error.message };
    }

    return { ok: true, event: mapRowToEventConfig(data) };
  } catch (err) {
    console.error("[Admin Actions] adminSaveEvent error:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Save failed",
    };
  }
}

/**
 * Admin-only: Delete event using SERVICE_ROLE.
 * Also deletes all purchases for that event_slug so dashboard stats
 * and recreated events with the same slug start clean.
 * (Disable/inactive does NOT delete purchases - only hard delete.)
 */
export async function adminDeleteEvent(
  slug: string
): Promise<{ ok: boolean; deletedPurchases?: number; error?: string }> {
  try {
    await requireAdmin();
    const clean = String(slug || "")
      .trim()
      .toLowerCase();
    if (!clean) return { ok: false, error: "Missing event slug" };

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      // Memory fallback
      const { deleteEvent } = await import("@/lib/db/events");
      const { deletePurchasesByEventSlug } = await import("@/lib/db/purchases");
      const n = await deletePurchasesByEventSlug(clean);
      await deleteEvent(clean);
      return { ok: true, deletedPurchases: n };
    }

    // 1) Remove purchase history for this slug (stats, attendance, etc.)
    const { data: removed, error: purchErr } = await supabaseAdmin
      .from("purchases")
      .delete()
      .eq("event_slug", clean)
      .select("id");

    if (purchErr) {
      console.error("[Admin Actions] Delete event purchases error:", purchErr);
      return {
        ok: false,
        error: `Could not delete purchases: ${purchErr.message}`,
      };
    }

    // 1b) Remove donations for this slug (separate table)
    try {
      await supabaseAdmin.from("donations").delete().eq("event_slug", clean);
    } catch {
      /* table may not exist yet */
    }

    // 2) Remove pending KPay carts for this event if table exists
    try {
      await supabaseAdmin
        .from("pending_kpay_payments")
        .delete()
        .contains("cart", { eventSlug: clean });
    } catch {
      /* optional table / filter may not match - ignore */
    }
    // Broader cleanup for pending rows that store event in JSON differently
    try {
      const { data: pending } = await supabaseAdmin
        .from("pending_kpay_payments")
        .select("id, cart");
      const ids = (pending || [])
        .filter((row: any) => row?.cart?.eventSlug === clean)
        .map((row: any) => row.id);
      if (ids.length) {
        await supabaseAdmin.from("pending_kpay_payments").delete().in("id", ids);
      }
    } catch {
      /* ignore */
    }

    // 3) Delete the event row
    const { error } = await supabaseAdmin
      .from("events")
      .delete()
      .eq("slug", clean);
    if (error) {
      console.error("[Admin Actions] Delete event error:", error);
      return { ok: false, error: error.message };
    }

    const deletedPurchases = Array.isArray(removed) ? removed.length : 0;
    console.log(
      `[Admin Actions] Deleted event "${clean}" and ${deletedPurchases} purchase(s)`
    );
    return { ok: true, deletedPurchases };
  } catch (err) {
    console.error("[Admin Actions] adminDeleteEvent error:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Delete failed",
    };
  }
}

/**
 * Admin-only: Get all purchases using SERVICE_ROLE (bypasses RLS).
 */
export async function adminGetAllPurchases(filters?: {
  eventSlug?: string;
  email?: string;
  search?: string;
}): Promise<PurchaseRecord[]> {
  try {
    await requireAdmin();
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return [];

    let query = supabaseAdmin.from("purchases").select("*").order("bought_at", { ascending: false });

    if (filters?.eventSlug) {
      query = query.eq("event_slug", filters.eventSlug);
    }
    if (filters?.email) {
      query = query.ilike("email", `%${filters.email}%`);
    }
    if (filters?.search) {
      const s = filters.search;
      query = query.or(
        `name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%,order_reference.ilike.%${s}%,payment_reference.ilike.%${s}%`
      );
    }

    const { data, error } = await query;

    if (error) {
      console.error("[Admin Actions] getAllPurchases error:", error);
      return [];
    }

    return (data || []) as PurchaseRecord[];
  } catch (err) {
    console.error("[Admin Actions] adminGetAllPurchases error:", err);
    return [];
  }
}

/**
 * Admin-only: list donations (separate from ticket purchases).
 */
export async function adminGetAllDonations(filters?: {
  eventSlug?: string;
}): Promise<import("@/types").DonationRecord[]> {
  try {
    await requireAdmin();
    const { getAllDonations } = await import("@/lib/db/donations");
    return getAllDonations({ eventSlug: filters?.eventSlug });
  } catch (err) {
    console.error("[Admin Actions] adminGetAllDonations error:", err);
    return [];
  }
}

/**
 * Admin-only: Save/update purchase (e.g. for redemption) using SERVICE_ROLE.
 * Only whitelisted columns are written (avoids PGRST errors on unknown fields).
 */
export async function adminSavePurchase(input: Partial<PurchaseRecord> & { id?: string | number }): Promise<PurchaseRecord | null> {
  try {
    await requireAdmin();
    const hasId = input.id != null;

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return null;

    if (hasId) {
      const id = input.id;
      // Only fields we intentionally update on redeem / admin edit
      const updateData: Record<string, unknown> = {};
      if (input.ticket_breakdown !== undefined) {
        updateData.ticket_breakdown = input.ticket_breakdown;
      }
      if (input.redeemed_at !== undefined) {
        updateData.redeemed_at = input.redeemed_at;
      }
      if (input.redemptions !== undefined) {
        updateData.redemptions = input.redemptions;
      }
      if (input.number_of_tickets !== undefined) {
        updateData.number_of_tickets = input.number_of_tickets;
      }

      let { data, error } = await supabaseAdmin
        .from("purchases")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      // Retry without redemptions column if schema missing it
      if (error && (error.message || "").includes("redemptions")) {
        const { redemptions: _r, ...without } = updateData;
        const retry = await supabaseAdmin
          .from("purchases")
          .update(without)
          .eq("id", id)
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        console.error("[Admin Actions] adminSavePurchase update error:", error);
        return null;
      }
      return data as PurchaseRecord;
    } else {
      const { data, error } = await supabaseAdmin
        .from("purchases")
        .insert(input)
        .select()
        .single();

      if (error) {
        console.error("[Admin Actions] adminSavePurchase insert error:", error);
        return null;
      }
      return data as PurchaseRecord;
    }
  } catch (err) {
    console.error("[Admin Actions] adminSavePurchase error:", err);
    return null;
  }
}

/**
 * Change one ticket unit's type on a purchase (by serial, or by index for legacy).
 * PDF re-download uses updated ticket_breakdown.
 */
export async function adminChangeTicketType(input: {
  purchaseId: string | number;
  /** Prefer serial when present */
  serial?: string;
  /** Fallback if no serials */
  unitIndex?: number;
  newTicketTypeId: string;
  note?: string;
}): Promise<{ success: boolean; error?: string; purchase?: PurchaseRecord }> {
  try {
    await requireAdmin();
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return { success: false, error: "Database not configured." };
    }

    const { data: purchase, error: fetchErr } = await supabaseAdmin
      .from("purchases")
      .select("*")
      .eq("id", input.purchaseId)
      .single();
    if (fetchErr || !purchase) {
      return { success: false, error: "Purchase not found." };
    }

    const { loadEventBySlug } = await import("@/lib/config/events");
    const event = await loadEventBySlug(purchase.event_slug);
    if (!event) return { success: false, error: "Event not found." };

    const newType = (event.ticketTypes || []).find(
      (t) => t.id === input.newTicketTypeId
    );
    if (!newType) {
      return { success: false, error: "Unknown ticket type." };
    }
    if (newType.enabled === false || newType.archived) {
      return { success: false, error: "That ticket type is not available." };
    }

    const units: any[] = Array.isArray(purchase.ticket_breakdown)
      ? [...purchase.ticket_breakdown]
      : [];
    if (units.length === 0) {
      return { success: false, error: "No tickets on this purchase." };
    }

    let idx = -1;
    if (input.serial) {
      idx = units.findIndex((u) => u.serial === input.serial);
    } else if (input.unitIndex != null) {
      idx = Number(input.unitIndex);
    }
    if (idx < 0 || idx >= units.length) {
      return { success: false, error: "Ticket unit not found." };
    }

    const oldTypeId = units[idx].ticketTypeId;
    if (oldTypeId === input.newTicketTypeId) {
      return { success: false, error: "Already that ticket type." };
    }
    const oldTypeName =
      event.ticketTypes.find((t) => t.id === oldTypeId)?.name || oldTypeId;

    // Capacity check: remove old unit from consideration by temporarily
    // validating as if we issue 1 of new type without the old unit
    const { assertCanIssueTickets } = await import("@/lib/tickets/capacity");
    const { data: allPurchases } = await supabaseAdmin
      .from("purchases")
      .select(
        "id, ticket_breakdown, number_of_tickets, payment_method, order_reference"
      )
      .eq("event_slug", purchase.event_slug);

    // Simulate: count without this unit, then add new type
    const simulated = (allPurchases || []).map((p: any) => {
      if (String(p.id) !== String(purchase.id)) return p;
      const bd = (p.ticket_breakdown || []).filter(
        (_: any, i: number) => i !== idx
      );
      return { ...p, ticket_breakdown: bd };
    });
    const capErr = assertCanIssueTickets(
      event,
      [{ ticketTypeId: input.newTicketTypeId, quantity: 1 }],
      simulated as any
    );
    if (capErr) {
      return { success: false, error: capErr };
    }

    units[idx] = { ...units[idx], ticketTypeId: input.newTicketTypeId };
    const ticketCount = units.reduce(
      (s, u) => s + (u.serial ? 1 : Math.max(1, Number(u.quantity) || 1)),
      0
    );

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("purchases")
      .update({
        ticket_breakdown: units,
        number_of_tickets: ticketCount,
      })
      .eq("id", purchase.id)
      .select()
      .single();

    if (upErr || !updated) {
      return {
        success: false,
        error: upErr?.message || "Failed to update purchase.",
      };
    }

    try {
      const { sendAdminTicketChangeNotification } = await import(
        "@/lib/integrations/email"
      );
      await sendAdminTicketChangeNotification({
        kind: "changed",
        eventName: event.name,
        eventSlug: event.slug,
        orderReference:
          purchase.order_reference || purchase.payment_reference || String(purchase.id),
        serial: units[idx].serial,
        buyerName: purchase.name,
        buyerEmail: purchase.email,
        buyerPhone: purchase.phone,
        fromTypeName: oldTypeName,
        toTypeName: newType.name,
        note: input.note,
        notifyEmails: event.adminNotifyEmail,
      });
    } catch (e) {
      console.error("[Admin] change notify failed:", e);
    }

    return { success: true, purchase: updated as PurchaseRecord };
  } catch (err) {
    console.error("[Admin] adminChangeTicketType:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Change failed",
    };
  }
}

/**
 * Delete one ticket unit from a purchase. If none left, delete the purchase row.
 */
export async function adminDeleteTicketUnit(input: {
  purchaseId: string | number;
  serial?: string;
  unitIndex?: number;
  note?: string;
}): Promise<{
  success: boolean;
  error?: string;
  purchaseDeleted?: boolean;
  purchase?: PurchaseRecord | null;
}> {
  try {
    await requireAdmin();
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return { success: false, error: "Database not configured." };
    }

    const { data: purchase, error: fetchErr } = await supabaseAdmin
      .from("purchases")
      .select("*")
      .eq("id", input.purchaseId)
      .single();
    if (fetchErr || !purchase) {
      return { success: false, error: "Purchase not found." };
    }

    const { loadEventBySlug } = await import("@/lib/config/events");
    const event = await loadEventBySlug(purchase.event_slug);

    const units: any[] = Array.isArray(purchase.ticket_breakdown)
      ? [...purchase.ticket_breakdown]
      : [];
    let idx = -1;
    if (input.serial) {
      idx = units.findIndex((u) => u.serial === input.serial);
    } else if (input.unitIndex != null) {
      idx = Number(input.unitIndex);
    }
    if (idx < 0 || idx >= units.length) {
      return { success: false, error: "Ticket unit not found." };
    }

    const removed = units[idx];
    const fromTypeName =
      event?.ticketTypes?.find((t) => t.id === removed.ticketTypeId)?.name ||
      removed.ticketTypeId;

    units.splice(idx, 1);

    if (units.length === 0) {
      const { error: delErr } = await supabaseAdmin
        .from("purchases")
        .delete()
        .eq("id", purchase.id);
      if (delErr) {
        return { success: false, error: delErr.message };
      }
      try {
        const { sendAdminTicketChangeNotification } = await import(
          "@/lib/integrations/email"
        );
        await sendAdminTicketChangeNotification({
          kind: "deleted",
          eventName: event?.name || purchase.event_slug,
          eventSlug: purchase.event_slug,
          orderReference:
            purchase.order_reference ||
            purchase.payment_reference ||
            String(purchase.id),
          serial: removed.serial,
          buyerName: purchase.name,
          buyerEmail: purchase.email,
          buyerPhone: purchase.phone,
          fromTypeName,
          note: input.note || "Last ticket on order removed; purchase deleted.",
          notifyEmails: event?.adminNotifyEmail,
        });
      } catch (e) {
        console.error("[Admin] delete notify failed:", e);
      }
      return { success: true, purchaseDeleted: true, purchase: null };
    }

    const ticketCount = units.reduce(
      (s, u) => s + (u.serial ? 1 : Math.max(1, Number(u.quantity) || 1)),
      0
    );
    const { data: updated, error: upErr } = await supabaseAdmin
      .from("purchases")
      .update({
        ticket_breakdown: units,
        number_of_tickets: ticketCount,
      })
      .eq("id", purchase.id)
      .select()
      .single();

    if (upErr || !updated) {
      return {
        success: false,
        error: upErr?.message || "Failed to update purchase.",
      };
    }

    try {
      const { sendAdminTicketChangeNotification } = await import(
        "@/lib/integrations/email"
      );
      await sendAdminTicketChangeNotification({
        kind: "deleted",
        eventName: event?.name || purchase.event_slug,
        eventSlug: purchase.event_slug,
        orderReference:
          purchase.order_reference ||
          purchase.payment_reference ||
          String(purchase.id),
        serial: removed.serial,
        buyerName: purchase.name,
        buyerEmail: purchase.email,
        buyerPhone: purchase.phone,
        fromTypeName,
        note: input.note,
        notifyEmails: event?.adminNotifyEmail,
      });
    } catch (e) {
      console.error("[Admin] delete notify failed:", e);
    }

    return {
      success: true,
      purchaseDeleted: false,
      purchase: updated as PurchaseRecord,
    };
  } catch (err) {
    console.error("[Admin] adminDeleteTicketUnit:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Delete failed",
    };
  }
}

export type ManualIssueInput = {
  eventSlug: string;
  tickets: Array<{ ticketTypeId: string; quantity: number }>;
  buyer: { name: string; phone: string; email: string };
  /** cash | bank_transfer | fps | alipay_offline | wechat_offline | free | other */
  paymentMethod: string;
  /** Optional proof note (FPS ref, receipt no., etc.) */
  note?: string;
  /** Leave undefined to use catalog price × qty */
  amountOverride?: number;
  currency?: string;
};

/**
 * Admin-only: issue tickets for cash / offline payments after verifying proof.
 * Runs the same fulfillment pipeline as KPay (purchase row + email + serials).
 */
export async function adminIssueManualTickets(
  input: ManualIssueInput
): Promise<{
  success: boolean;
  orderReference?: string;
  paymentReference?: string;
  error?: string;
  amount?: number;
  ticketCount?: number;
}> {
  try {
    await requireAdmin();

    const eventSlug = String(input.eventSlug || "").trim();
    const name = String(input.buyer?.name || "").trim();
    const phone = String(input.buyer?.phone || "").trim();
    const email = String(input.buyer?.email || "").trim();
    const paymentMethod = String(input.paymentMethod || "cash")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .slice(0, 40);
    const note = String(input.note || "").trim().slice(0, 120);

    if (!eventSlug) {
      return { success: false, error: "Select an event." };
    }
    if (!name) {
      return { success: false, error: "Buyer name is required." };
    }
    if (!email || !email.includes("@")) {
      return { success: false, error: "Valid buyer email is required (for ticket delivery)." };
    }
    if (!phone) {
      return { success: false, error: "Buyer phone is required." };
    }

    const tickets = (input.tickets || [])
      .map((t) => ({
        ticketTypeId: String(t.ticketTypeId || "").trim(),
        quantity: Math.max(0, Math.floor(Number(t.quantity) || 0)),
      }))
      .filter((t) => t.ticketTypeId && t.quantity > 0);

    if (tickets.length === 0) {
      return { success: false, error: "Add at least one ticket with quantity > 0." };
    }

    const { loadEventBySlug } = await import("@/lib/config/events");
    const event = await loadEventBySlug(eventSlug);
    if (!event) {
      return { success: false, error: "Event not found." };
    }

    // FR 6.4: same capacity rules as public sales (atomic re-check at issue)
    {
      const { assertCanIssueTickets } = await import("@/lib/tickets/capacity");
      let purchases: any[] = [];
      const supabaseAdmin = getSupabaseAdmin();
      if (supabaseAdmin) {
        const { data } = await supabaseAdmin
          .from("purchases")
          .select(
            "ticket_breakdown, number_of_tickets, payment_method, order_reference"
          )
          .eq("event_slug", eventSlug);
        purchases = data || [];
      } else {
        const { getAllPurchases } = await import("@/lib/db/purchases");
        purchases = await getAllPurchases({ eventSlug });
      }
      const capErr = assertCanIssueTickets(event, tickets, purchases);
      if (capErr) {
        return { success: false, error: capErr };
      }
    }

    const typeMap = new Map(
      (event.ticketTypes || []).map((t) => [t.id, t])
    );
    let catalogTotal = 0;
    let ticketCount = 0;
    const currency =
      String(input.currency || "").trim() ||
      event.ticketTypes?.[0]?.currency ||
      "HKD";

    for (const line of tickets) {
      const tt = typeMap.get(line.ticketTypeId);
      if (!tt) {
        return {
          success: false,
          error: `Unknown ticket type: ${line.ticketTypeId}`,
        };
      }
      if (tt.enabled === false) {
        return {
          success: false,
          error: `Ticket type "${tt.name}" is disabled.`,
        };
      }
      catalogTotal += (Number(tt.price) || 0) * line.quantity;
      ticketCount += line.quantity;
    }

    if (ticketCount > 50) {
      return {
        success: false,
        error: "Max 50 tickets per manual issue. Split into multiple orders if needed.",
      };
    }

    let totalAmount =
      input.amountOverride != null && !Number.isNaN(Number(input.amountOverride))
        ? Math.max(0, Number(input.amountOverride))
        : catalogTotal;

    // Free / complimentary force zero amount
    if (paymentMethod === "free" || paymentMethod === "complimentary") {
      totalAmount = 0;
    }

    const paymentReference = [
      "MAN",
      Date.now().toString(36).toUpperCase(),
      Math.random().toString(36).slice(2, 6).toUpperCase(),
      note ? note.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) : "",
    ]
      .filter(Boolean)
      .join("-");

    const cart = {
      eventSlug,
      tickets,
      buyer: { name, phone, email },
      totalAmount,
      currency: totalAmount === 0 ? "FREE" : currency,
    };

    const { processSuccessfulPurchase } = await import(
      "@/lib/integrations/order.service"
    );
    const result = await processSuccessfulPurchase(cart, paymentReference, {
      paymentMethod:
        paymentMethod === "free" || paymentMethod === "complimentary"
          ? "free"
          : paymentMethod || "manual",
      orderPrefix: "MAN",
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Failed to create tickets.",
      };
    }

    return {
      success: true,
      orderReference: result.orderReference,
      paymentReference,
      amount: totalAmount,
      ticketCount,
    };
  } catch (err: any) {
    console.error("[Admin Actions] adminIssueManualTickets error:", err);
    const msg = String(err?.message || err || "");
    if (msg.toLowerCase().includes("admin") || msg.toLowerCase().includes("session")) {
      return {
        success: false,
        error: "Admin session expired. Sign out and sign in again.",
      };
    }
    return { success: false, error: msg || "Unexpected error issuing tickets." };
  }
}

/**
 * Public-friendly server action to fetch a purchase by order ref, payment ref, or ticket serial.
 * Uses service role so it works even with strict RLS on SELECT for anon.
 */
export async function getPurchaseByReference(ref: string): Promise<any> {
  if (!ref || ref === "N/A") return null;
  const r = ref.trim();

  // Public scan page — soft rate limit only (not admin-gated)
  const rl = checkRateLimit(`public-lookup:${r.slice(0, 32)}`, {
    limit: 60,
    windowMs: 60 * 1000,
  });
  if (!rl.ok) return null;

  const { purchaseMatchesRef } = await import("@/lib/tickets/serials");

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    const { getAllPurchases } = await import("@/lib/db/purchases");
    const purchases = await getAllPurchases();
    return purchases.find((p: any) => purchaseMatchesRef(p, r)) || null;
  }

  try {
    // 1) Fast path: order / payment reference
    const { data: byOrder } = await supabaseAdmin
      .from("purchases")
      .select("*")
      .or(`order_reference.eq.${r},payment_reference.eq.${r}`)
      .limit(1)
      .maybeSingle();

    if (byOrder) return byOrder;

    // 2) Ticket serial (KPY-…-001): load recent rows and match JSON serials
    const { data: recent, error } = await supabaseAdmin
      .from("purchases")
      .select("*")
      .order("bought_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("[Admin Actions] getPurchaseByReference error:", error);
      return null;
    }

    return (recent || []).find((p: any) => purchaseMatchesRef(p, r)) || null;
  } catch (err) {
    console.error("[Admin Actions] getPurchaseByReference error:", err);
    return null;
  }
}

/**
 * Upload event banner or ticket template (server action).
 * Prefer /api/admin/upload for PDFs (more reliable on Vercel).
 */
export async function uploadEventBanner(
  formData: FormData
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    try {
      await requireAdmin();
    } catch {
      return {
        success: false,
        error:
          "Admin session expired. Sign out and sign in again, then retry upload.",
      };
    }

    const file = formData.get("file") as File | null;
    if (!file) {
      return { success: false, error: "No file provided" };
    }

    const isImage = (file.type || "").startsWith("image/");
    const isPdf =
      file.type === "application/pdf" ||
      (file.name || "").toLowerCase().endsWith(".pdf");

    if (!isImage && !isPdf) {
      return {
        success: false,
        error: "Only image files (JPG/PNG/WEBP) or PDF are allowed",
      };
    }

    const slug = String(formData.get("slug") || "event");
    const bytes = await file.arrayBuffer();
    const { uploadEventAsset } = await import("@/lib/uploads/event-assets");
    return uploadEventAsset({
      bytes,
      filename: file.name || (isPdf ? "template.pdf" : "banner.jpg"),
      contentType:
        file.type ||
        (isPdf ? "application/pdf" : "image/jpeg"),
      slug,
    });
  } catch (err) {
    console.error("[uploadEventBanner]", err);
    const msg = err instanceof Error ? err.message : "Failed to save image";
    return { success: false, error: msg };
  }
}


// ——— Check-in staff management + admin redeem (P3)
// Defined here (not re-exported) - Next/Turbopack rejects re-export of server actions.

export async function adminListCheckinStaff(): Promise<CheckinStaffPublic[]> {
  await requireAdmin();
  return listCheckinStaff();
}

export async function adminCreateCheckinStaff(input: {
  username: string;
  displayName: string;
  password: string;
}): Promise<{ ok: boolean; error?: string; staff?: CheckinStaffPublic }> {
  await requireAdmin();
  const res = await createCheckinStaff(input);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, staff: res.staff };
}

export async function adminSetCheckinStaffEnabled(
  id: string,
  enabled: boolean
): Promise<boolean> {
  await requireAdmin();
  return setCheckinStaffEnabled(id, enabled);
}

export async function adminDeleteCheckinStaff(id: string): Promise<boolean> {
  await requireAdmin();
  return deleteCheckinStaff(id);
}

export async function adminResetCheckinStaffPassword(
  id: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  return resetCheckinStaffPassword(id, newPassword);
}

export async function adminPerformCheckIn(
  ref: string,
  remark?: string
): Promise<CheckInResult> {
  try {
    await requireAdmin();
    return await performCheckIn(
      ref,
      { byId: "admin", byName: "Admin" },
      remark
    );
  } catch {
    return {
      ok: false,
      message: "Admin session expired. Sign in again.",
      tone: "error",
    };
  }
}
