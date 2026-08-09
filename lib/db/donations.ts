/**
 * Donations persistence (separate from ticket purchases).
 */
import type { DonationRecord } from "@/types";
import { getSupabaseClient as getSupabase } from "@/lib/supabase/client";

const memoryDonations: DonationRecord[] = [];

export async function saveDonation(
  input: Omit<DonationRecord, "id">
): Promise<DonationRecord> {
  const record: DonationRecord = {
    ...input,
    donated_at: input.donated_at || new Date().toISOString(),
  };

  try {
    const { getSupabaseAdmin } = await import("@/lib/supabase/server");
    const admin = getSupabaseAdmin();
    if (admin) {
      const { data, error } = await admin
        .from("donations")
        .insert({
          donated_at: record.donated_at,
          name: record.name,
          phone: record.phone,
          email: record.email,
          amount: record.amount,
          currency: record.currency || "HKD",
          event_slug: record.event_slug,
          order_reference: record.order_reference || null,
          payment_reference: record.payment_reference || null,
          payment_method: record.payment_method || null,
        })
        .select()
        .single();
      if (error) {
        console.error("[Donations] insert error:", error.message);
        // fall through to memory
      } else if (data) {
        return data as DonationRecord;
      }
    }
  } catch (e) {
    console.error("[Donations] save:", e);
  }

  const withId = { ...record, id: memoryDonations.length + 1 };
  memoryDonations.push(withId);
  return withId;
}

export async function getAllDonations(filters?: {
  eventSlug?: string;
}): Promise<DonationRecord[]> {
  try {
    const { getSupabaseAdmin } = await import("@/lib/supabase/server");
    const admin = getSupabaseAdmin();
    if (admin) {
      let q = admin
        .from("donations")
        .select("*")
        .order("donated_at", { ascending: false });
      if (filters?.eventSlug) {
        q = q.eq("event_slug", filters.eventSlug);
      }
      const { data, error } = await q;
      if (!error && data) {
        return data as DonationRecord[];
      }
      if (error) {
        console.error("[Donations] list:", error.message);
      }
    }
  } catch {
    /* ignore */
  }

  return memoryDonations.filter(
    (d) => !filters?.eventSlug || d.event_slug === filters.eventSlug
  );
}
