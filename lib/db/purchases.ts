/**
 * Purchase Records Persistence Layer
 *
 * Abstraction over where purchase data lives.
 * Currently supports:
 *   1. Supabase (recommended for production)
 *   2. In-memory store (excellent for local development / demos)
 *
 * The interface is deliberately simple and can be extended with:
 * - Filtering, pagination, search for the admin dashboard
 * - Export helpers
 *
 * Table schema (Supabase / Postgres):
 *   id (serial/uuid)
 *   bought_at (timestamptz)
 *   name (text)
 *   phone (text)
 *   email (text)
 *   number_of_tickets (int)
 *   payment_method (text)
 *   amount (numeric)
 *   currency (text)
 *   event_slug (text)
 *   ticket_breakdown (jsonb)
 *   order_reference (text)
 *   payment_reference (text)
 */

import { PurchaseRecord } from "@/types";

import { getSupabaseClient as getSupabase } from "@/lib/supabase/client";

// Re-export for backward compatibility
export { getSupabase };

// In-memory fallback store (resets on server restart)
const memoryStore: PurchaseRecord[] = [];

interface SavePurchaseInput extends Partial<Omit<PurchaseRecord, "id">> {
  id?: string | number; // allow passing id for update operations (e.g. marking redeemed)
}

/** Prefer service role on server (webhook/return); fall back to anon for browser. */
async function getPurchaseWriteClient() {
  try {
    const { getSupabaseAdmin } = await import("@/lib/supabase/server");
    const admin = getSupabaseAdmin();
    if (admin) return { client: admin, isAdmin: true };
  } catch {
    // ignore
  }
  const client = getSupabase();
  return client ? { client, isAdmin: false } : null;
}

export async function savePurchase(input: SavePurchaseInput): Promise<PurchaseRecord> {
  const write = await getPurchaseWriteClient();

  const record: PurchaseRecord = {
    ...(input as any),
    bought_at: input.bought_at || new Date().toISOString(),
  } as PurchaseRecord;

  if (write) {
    const { client, isAdmin } = write;
    const hasExistingId = record.id != null;

    if (hasExistingId) {
      // This is an update (e.g. marking as redeemed via Scanner)
      const { id, ...updateData } = record as any;

      const { data, error } = await client
        .from("purchases")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("[DB] Supabase update failed for purchase:", error);
        console.warn("[DB] Purchase updated in memory only.");
      } else if (data) {
        // Update in memory too
        const idx = memoryStore.findIndex(m => m.id === id || (m.email === data.email && m.bought_at === data.bought_at));
        if (idx >= 0) {
          memoryStore[idx] = { ...data, id: data.id } as PurchaseRecord;
        } else {
          memoryStore.push({ ...data, id: data.id } as PurchaseRecord);
        }
        return data as PurchaseRecord;
      }
    } else {
      // Normal insert for new purchases (no id)
      // Strip any accidental id
      const { redeemed_at, id: _ignoreId, ...baseRecord } = record as any;
      const insertPayload: any = { ...baseRecord };
      delete insertPayload.id; // never send id on insert (let DB generate)

      // Admin can insert+select; anon insert only (RLS blocks select)
      let data: any = null;
      let error: any = null;

      if (isAdmin) {
        const res = await client
          .from("purchases")
          .insert(insertPayload)
          .select()
          .single();
        data = res.data;
        error = res.error;
      } else {
        const res = await client.from("purchases").insert(insertPayload);
        error = res.error;
        if (!error) data = { ...insertPayload };
      }

      if (error && error.code === "PGRST204" && (error.message || "").includes("column")) {
        console.warn(
          "[DB] Supabase schema missing new purchase columns. Retrying without discount fields."
        );
        const safePayload = { ...insertPayload };
        delete safePayload.applied_discount_code;
        delete safePayload.discount_amount;
        if (isAdmin) {
          const retry = await client
            .from("purchases")
            .insert(safePayload)
            .select()
            .single();
          data = retry.data;
          error = retry.error;
        } else {
          const retry = await client.from("purchases").insert(safePayload);
          error = retry.error;
          if (!error) data = { ...safePayload };
        }
      }

      // Race: webhook + browser return both insert same payment_reference
      if (error && error.code === "23505" && insertPayload.payment_reference) {
        console.log(
          "[DB] Duplicate payment_reference — loading existing purchase (idempotent)",
          insertPayload.payment_reference
        );
        const existing = await getPurchaseByPaymentReference(
          String(insertPayload.payment_reference)
        );
        if (existing) {
          if (
            !memoryStore.some(
              (m) => m.payment_reference === existing.payment_reference
            )
          ) {
            memoryStore.push(existing);
          }
          return existing;
        }
      }

      if (error) {
        console.error("[DB] Supabase insert failed for purchase:", error);
        console.warn(
          "[DB] Purchase saved to memory only (check RLS on 'purchases' table)."
        );
      } else if (data) {
        const withId: PurchaseRecord = {
          ...data,
          id: data.id ?? memoryStore.length + 1,
        } as PurchaseRecord;
        if (
          !memoryStore.some(
            (m) =>
              m.payment_reference &&
              m.payment_reference === withId.payment_reference
          )
        ) {
          memoryStore.push(withId);
        }
        return withId;
      }
    }
  }

  // Memory path (or fallback) - support both insert and update
  const existingIndex = memoryStore.findIndex(m =>
    (record.id != null && m.id === record.id) ||
    (m.email === record.email && m.bought_at === record.bought_at)
  );

  if (existingIndex >= 0) {
    // Update existing memory record (e.g. redeem)
    memoryStore[existingIndex] = {
      ...memoryStore[existingIndex],
      ...record,
      id: memoryStore[existingIndex].id, // preserve original id
    };
    return memoryStore[existingIndex];
  } else {
    const withId: PurchaseRecord = {
      ...record,
      id: memoryStore.length + 1,
    };
    memoryStore.push(withId);
    return withId;
  }
}

/**
 * Retrieve all purchases. Supports simple filtering for admin UI.
 */
export async function getAllPurchases(filters?: {
  eventSlug?: string;
  email?: string;
  search?: string;
}): Promise<PurchaseRecord[]> {
  const client = getSupabase();

  let supabaseResults: PurchaseRecord[] = [];
  if (client) {
    let query = client.from("purchases").select("*").order("bought_at", { ascending: false });

    if (filters?.eventSlug) {
      query = query.eq("event_slug", filters.eventSlug);
    }
    if (filters?.email) {
      query = query.ilike("email", `%${filters.email}%`);
    }
    if (filters?.search) {
      // Search across name / email / phone / order_reference / payment_reference
      const s = filters.search;
      query = query.or(
        `name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%,order_reference.ilike.%${s}%,payment_reference.ilike.%${s}%`
      );
    }

    try {
      const { data, error } = await query;
      if (error) {
        console.error("[DB] Supabase fetch error:", error);
      } else if (data) {
        supabaseResults = data as PurchaseRecord[];
      }
    } catch (e) {
      console.error("[DB] Supabase fetch error:", e);
    }
  }

  const memoryToAdd = memoryStore.filter(mem =>
    !supabaseResults.some(s => s.email === mem.email && s.bought_at === mem.bought_at)
  );
  let combined = [...supabaseResults, ...memoryToAdd];

  // re-apply filters
  if (filters?.eventSlug) {
    combined = combined.filter((p) => p.event_slug === filters.eventSlug);
  }
  if (filters?.email) {
    combined = combined.filter((p) => p.email.toLowerCase().includes(filters.email!.toLowerCase()));
  }
  if (filters?.search) {
    const s = filters.search.toLowerCase();
    combined = combined.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        p.email.toLowerCase().includes(s) ||
        p.phone.toLowerCase().includes(s) ||
        (p.order_reference || "").toLowerCase().includes(s) ||
        (p.payment_reference || "").toLowerCase().includes(s)
    );
  }

  // re-sort
  combined.sort((a, b) =>
    (b.bought_at || "").localeCompare(a.bought_at || "")
  );

  return combined;
}

/**
 * Export helper: returns data ready for CSV / Excel generation.
 */
export async function getPurchasesForExport(filters?: { eventSlug?: string }): Promise<PurchaseRecord[]> {
  return getAllPurchases(filters);
}

/**
 * Find purchase by KPay outTradeNo / payment_reference (webhook + return idempotency).
 * Prefers service role so it works with RLS on Vercel.
 */
export async function getPurchaseByPaymentReference(
  paymentReference: string
): Promise<PurchaseRecord | null> {
  if (!paymentReference) return null;
  const ref = paymentReference.trim();

  try {
    const { getSupabaseAdmin } = await import("@/lib/supabase/server");
    const admin = getSupabaseAdmin();
    if (admin) {
      const { data, error } = await admin
        .from("purchases")
        .select("*")
        .eq("payment_reference", ref)
        .order("bought_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data) return data as PurchaseRecord;
    }
  } catch (err) {
    console.warn("[DB] getPurchaseByPaymentReference admin lookup failed:", err);
  }

  const mem = memoryStore.find((p) => p.payment_reference === ref);
  return mem || null;
}
