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
  if (!eventSlug) return {};
  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      const { getAllPurchases } = await import("@/lib/db/purchases");
      const { countSoldByTicketType } = await import("@/lib/tickets/inventory");
      const rows = await getAllPurchases({ eventSlug });
      return countSoldByTicketType(rows);
    }
    const { data, error } = await supabaseAdmin
      .from("purchases")
      .select("ticket_breakdown, number_of_tickets")
      .eq("event_slug", eventSlug);
    if (error) {
      console.error("[Admin Actions] getEventTicketSoldCounts:", error);
      return {};
    }
    const { countSoldByTicketType } = await import("@/lib/tickets/inventory");
    return countSoldByTicketType(data || []);
  } catch (err) {
    console.error("[Admin Actions] getEventTicketSoldCounts error:", err);
    return {};
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

/**
 * Admin-only: Save event using SERVICE_ROLE (bypasses RLS).
 * Always writes arrays (including empty) so removals persist.
 */
export async function adminSaveEvent(event: EventConfig): Promise<EventConfig | null> {
  try {
    await requireAdmin();
    const cleanEvent = {
      ...event,
      slug: event.slug.toLowerCase().trim(),
      ticketTypes: event.ticketTypes || [],
      buyerFormFields: event.buyerFormFields || [],
      discountCodes: event.discountCodes || [],
    };

    // Always include full field set so "remove ticket type / form field" actually clears DB
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
      metadata: cleanEvent.metadata || {},
    };

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      console.warn("[Admin] No service role key - saving to memory only");
      const { saveEvent } = await import("@/lib/db/events");
      return saveEvent(cleanEvent as EventConfig);
    }

    let { data, error } = await supabaseAdmin
      .from("events")
      .upsert(upsertPayload)
      .select()
      .single();

    // Retry without newer columns if schema is behind
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
      return null;
    }

    return mapRowToEventConfig(data);
  } catch (err) {
    console.error("[Admin Actions] adminSaveEvent error:", err);
    return null;
  }
}

/**
 * Admin-only: Delete event using SERVICE_ROLE.
 */
export async function adminDeleteEvent(slug: string): Promise<boolean> {
  try {
    await requireAdmin();
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return false;

    const { error } = await supabaseAdmin.from("events").delete().eq("slug", slug);
    if (error) {
      console.error("[Admin Actions] Delete event error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Admin Actions] adminDeleteEvent error:", err);
    return false;
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

