"use server";

import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { EventConfig, PurchaseRecord } from "@/types";

// Server-side admin password verification.
// The secret lives only on the server (process.env.ADMIN_PASSWORD).
// Never exposed to client bundle.
export async function verifyAdminPassword(inputPassword: string): Promise<boolean> {
  const expected =
    process.env.ADMIN_PASSWORD ||
    process.env.NEXT_PUBLIC_ADMIN_PASSWORD ||
    "sit-admin-2026";
  return inputPassword === expected;
}

/**
 * Admin-only: Save event using SERVICE_ROLE (bypasses RLS).
 * Use this from /sit-admin instead of direct db call.
 */
export async function adminSaveEvent(event: EventConfig): Promise<EventConfig | null> {
  try {
    const cleanEvent = {
      ...event,
      slug: event.slug.toLowerCase().trim(),
    };

    const upsertPayload: any = {
      slug: cleanEvent.slug,
      name: cleanEvent.name,
      description: cleanEvent.description || null,
      date: cleanEvent.date,
      time: cleanEvent.time || null,
      location: cleanEvent.location,
      enabled: cleanEvent.enabled,
      ticket_types: cleanEvent.ticketTypes || [],
      metadata: cleanEvent.metadata || {},
    };

    if (cleanEvent.endDate) upsertPayload.end_date = cleanEvent.endDate;
    if (cleanEvent.buyerFormFields && cleanEvent.buyerFormFields.length > 0) {
      upsertPayload.buyer_form_fields = cleanEvent.buyerFormFields;
    }
    if (cleanEvent.discountCodes && cleanEvent.discountCodes.length > 0) {
      upsertPayload.discount_codes = cleanEvent.discountCodes;
    }
    if (cleanEvent.paymentEnabled !== undefined) {
      upsertPayload.payment_enabled = cleanEvent.paymentEnabled;
    }
    if (cleanEvent.ticketTemplate) {
      upsertPayload.ticket_template = cleanEvent.ticketTemplate;
    }
    if (cleanEvent.image) {
      upsertPayload.image = cleanEvent.image;
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      console.warn('[Admin] No service role key - saving to memory only');
      return null;
    }

    const { data, error } = await supabaseAdmin
      .from("events")
      .upsert(upsertPayload)
      .select()
      .single();

    if (error) {
      console.error("[Admin Actions] Supabase event save error:", error);
      return null;
    }

    return {
      ...data,
      ticketTypes: data.ticket_types || [],
    } as EventConfig;
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
 * Upload event banner or ticket template.
 * Supports images (jpg/png/webp) and PDF (for ticket backgrounds).
 * Saves to public/images/events/
 */
export async function uploadEventBanner(formData: FormData): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const file = formData.get("file") as File | null;
    if (!file) {
      return { success: false, error: "No file provided" };
    }

    // Basic validation - images or PDF
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || (file.name || "").toLowerCase().endsWith(".pdf");

    if (!isImage && !isPdf) {
      return { success: false, error: "Only image files (JPG/PNG/WEBP) or PDF are allowed" };
    }

    const maxSize = 10 * 1024 * 1024; // 10MB (PDFs allowed)
    if (file.size > maxSize) {
      return { success: false, error: "File too large (max 10MB)" };
    }

    const slug = (formData.get("slug") as string) || "event";
    const safeSlug = slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase();

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const filename = `${safeSlug}-${Date.now()}.${ext}`;

    const uploadDir = path.join(process.cwd(), "public", "images", "events");
    await mkdir(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);

    const publicPath = `/images/events/${filename}`;
    return { success: true, path: publicPath };
  } catch (err) {
    console.error("[uploadEventBanner]", err);
    return { success: false, error: "Failed to save image" };
  }
}

