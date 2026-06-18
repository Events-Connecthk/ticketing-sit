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

interface SavePurchaseInput extends Omit<PurchaseRecord, "id"> {}

export async function savePurchase(input: SavePurchaseInput): Promise<PurchaseRecord> {
  const client = getSupabase();

  const record: PurchaseRecord = {
    ...input,
    bought_at: input.bought_at || new Date().toISOString(),
  };

  if (client) {
    const { data, error } = await client
      .from("purchases")
      .insert(record)
      .select()
      .single();

    if (error) {
      console.error("[DB] Supabase insert failed for purchase:", error);
      console.warn("[DB] Purchase saved to memory only (check RLS on 'purchases' table).");
      // Continue to memory fallback
    } else if (data) {
      // Also keep in memory for the merge logic (helps if some queries have issues)
      const withId: PurchaseRecord = { ...data, id: data.id ?? memoryStore.length + 1 } as PurchaseRecord;
      // avoid dups in memory
      if (!memoryStore.some(m => m.email === withId.email && m.bought_at === withId.bought_at)) {
        memoryStore.push(withId);
      }
      return data as PurchaseRecord;
    }
  }

  // Memory path
  const withId: PurchaseRecord = {
    ...record,
    id: memoryStore.length + 1,
  };
  memoryStore.push(withId);
  return withId;
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

  if (client) {
    let query = client.from("purchases").select("*").order("bought_at", { ascending: false });

    if (filters?.eventSlug) {
      query = query.eq("event_slug", filters.eventSlug);
    }
    if (filters?.email) {
      query = query.ilike("email", `%${filters.email}%`);
    }
    if (filters?.search) {
      // Search across name / email / phone
      const s = filters.search;
      query = query.or(`name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[DB] Supabase fetch error:", error);
    } else if (data) {
      const supabaseResults = data as PurchaseRecord[];
      // Merge memory purchases (e.g. ones that failed to insert due to RLS or config issues)
      // so they still appear until the table is properly set up
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
            p.phone.toLowerCase().includes(s)
        );
      }

      // re-sort
      combined.sort((a, b) =>
        (b.bought_at || "").localeCompare(a.bought_at || "")
      );

      return combined;
    }
  }

  // Memory fallback with filtering (when no Supabase client)
  let results = [...memoryStore].sort((a, b) =>
    (b.bought_at || "").localeCompare(a.bought_at || "")
  );

  if (filters?.eventSlug) {
    results = results.filter((p) => p.event_slug === filters.eventSlug);
  }
  if (filters?.email) {
    results = results.filter((p) => p.email.toLowerCase().includes(filters.email!.toLowerCase()));
  }
  if (filters?.search) {
    const s = filters.search.toLowerCase();
    results = results.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        p.email.toLowerCase().includes(s) ||
        p.phone.toLowerCase().includes(s)
    );
  }

  return results;
}

/**
 * Export helper: returns data ready for CSV / Excel generation.
 */
export async function getPurchasesForExport(filters?: { eventSlug?: string }): Promise<PurchaseRecord[]> {
  return getAllPurchases(filters);
}
