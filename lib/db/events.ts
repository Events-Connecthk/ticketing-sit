/**
 * Events & Ticket Types Persistence Layer
 *
 * Stores events in Supabase (when configured) or falls back to in-memory.
 * This allows full admin management of events + ticket types without code changes.
 *
 * Event storage strategy:
 * - ticketTypes are stored as JSONB array (simple & flexible)
 * - enabled flag at both event and ticket type level
 */

import { EventConfig, TicketType } from "@/types";

import { getSupabaseClient as getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";

// Re-export for backward compatibility with admin and other files
export { getSupabase, isSupabaseConfigured };

// In-memory fallback
let memoryEvents: EventConfig[] = [];

// Helper: normalize enabled defaults
function normalizeEvent(raw: any): EventConfig {
  return {
    slug: raw.slug,
    name: raw.name,
    description: raw.description || "",
    date: raw.date,
    endDate: raw.endDate || raw.end_date,
    time: raw.time,
    location: raw.location,
    image: raw.image,
    enabled: raw.enabled !== false,
    paymentEnabled: raw.paymentEnabled !== false && raw.payment_enabled !== false,
    ticketTemplate: raw.ticketTemplate || raw.ticket_template || undefined,
    image: raw.image,
    ticketTypes: (raw.ticketTypes || raw.ticket_types || []).map((t: any) => ({
      ...t,
      enabled: t.enabled !== false,
      discounts: t.discounts || [],
    })),
    buyerFormFields: raw.buyerFormFields || raw.buyer_form_fields || [],
    discountCodes: raw.discountCodes || raw.discount_codes || [],
    metadata: raw.metadata,
  };
}

export async function getAllEvents(): Promise<EventConfig[]> {
  const client = getSupabase();

  if (client) {
    const { data, error } = await client
      .from("events")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.error("[Events DB] Supabase fetch error:", error);
    }
    let results: EventConfig[] = [];
    if (!error && data) {
      results = data.map(normalizeEvent);
    }

    // Merge advanced fields from memory for events that couldn't save all columns to Supabase
    const mergedResults = results.map(r => {
      const mem = memoryEvents.find(m => m.slug === r.slug);
      if (mem) {
        return {
          ...r,
          paymentEnabled: mem.paymentEnabled !== false,
          ticketTemplate: mem.ticketTemplate || r.ticketTemplate,
          discountCodes: mem.discountCodes && mem.discountCodes.length > 0 ? mem.discountCodes : r.discountCodes,
          buyerFormFields: mem.buyerFormFields && mem.buyerFormFields.length > 0 ? mem.buyerFormFields : r.buyerFormFields,
          endDate: mem.endDate || r.endDate,
          image: mem.image || r.image,
        };
      }
      return r;
    });

    // Add completely new memory-only events
    const memoryToAdd = memoryEvents.filter(
      (m) => !results.some((r) => r.slug === m.slug)
    );
    return [...mergedResults, ...memoryToAdd.map(normalizeEvent)];
  }

  // Memory fallback
  return memoryEvents.map(normalizeEvent);
}

export async function getEventBySlug(slug: string): Promise<EventConfig | null> {
  const client = getSupabase();

  if (client) {
    const { data, error } = await client
      .from("events")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error("[Events DB] Supabase get by slug error:", error);
    }
    if (!error && data) {
      const r = normalizeEvent(data);
      const mem = memoryEvents.find(m => m.slug === slug);
      if (mem) {
        return {
          ...r,
          paymentEnabled: mem.paymentEnabled !== false,
          ticketTemplate: mem.ticketTemplate || r.ticketTemplate,
          discountCodes: mem.discountCodes && mem.discountCodes.length > 0 ? mem.discountCodes : r.discountCodes,
          buyerFormFields: mem.buyerFormFields && mem.buyerFormFields.length > 0 ? mem.buyerFormFields : r.buyerFormFields,
          endDate: mem.endDate || r.endDate,
          image: mem.image || r.image,
        };
      }
      return r;
    }
  }

  return memoryEvents.find((e) => e.slug === slug) || null;
}

export async function saveEvent(event: EventConfig): Promise<EventConfig> {
  const client = getSupabase();

  // Ensure ticket types have enabled
  const cleanEvent: EventConfig = {
    ...event,
    enabled: event.enabled !== false,
    endDate: event.endDate,
    buyerFormFields: event.buyerFormFields || [],
    discountCodes: event.discountCodes || [],
    paymentEnabled: event.paymentEnabled !== false,
    ticketTemplate: event.ticketTemplate,
    image: event.image,
    ticketTypes: event.ticketTypes.map((t) => ({
      ...t,
      enabled: t.enabled !== false,
      discounts: t.discounts || [],
    })),
  };

  if (client) {
    // Use upsert by slug
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

    // Only include new columns if they have values (prevents schema errors on old tables)
    // IMPORTANT: You MUST run the ALTER TABLE statements from supabase-schema.sql
    // (for end_date, buyer_form_fields, discount_codes) or new columns will cause PGRST204.
    // The code below has fallback retry logic for missing columns.
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

    const { data, error } = await client
      .from("events")
      .upsert(upsertPayload)
      .select()
      .single();

    if (error) {
      // Graceful handling for missing new columns (e.g. discount_codes not yet added via ALTER TABLE)
      if (error.code === 'PGRST204' && (error.message || '').includes('column')) {
        console.warn("[Events DB] Supabase schema cache doesn't have the new column yet. Saving core event data only. Run the ALTER TABLE from supabase-schema.sql.");
        // Retry without the advanced columns
        const corePayload = { ...upsertPayload };
        delete corePayload.discount_codes;
        delete corePayload.buyer_form_fields;
        delete corePayload.end_date;
        delete corePayload.payment_enabled;
        delete corePayload.ticket_template;
        delete corePayload.image;  // in case image column is also missing in old schemas

        const { data: coreData, error: coreError } = await client
          .from("events")
          .upsert(corePayload)
          .select()
          .single();

        if (!coreError && coreData) {
          console.log(`[Events DB] ✅ Event "${cleanEvent.slug}" saved to Supabase (core fields only). New columns saved to memory only.`);
          // Ensure full event (with advanced fields) is in memory for merging on load
          const memIndex = memoryEvents.findIndex(m => m.slug === cleanEvent.slug);
          if (memIndex >= 0) {
            memoryEvents[memIndex] = cleanEvent;
          } else {
            memoryEvents.push(cleanEvent);
          }
          // Merge the new fields back into the returned object
          const merged = { 
            ...coreData, 
            ...{ 
              discount_codes: cleanEvent.discountCodes, 
              buyer_form_fields: cleanEvent.buyerFormFields,
              payment_enabled: cleanEvent.paymentEnabled,
              ticket_template: cleanEvent.ticketTemplate,
              image: cleanEvent.image
            } 
          };
          return normalizeEvent({ ...merged, ticketTypes: merged.ticket_types || merged.ticketTypes });
        }
      }

      console.error("[Events DB] Supabase upsert error:", error);
      console.warn("[Events DB] ⚠️ FAILED to save to Supabase. Event only in memory. Check console, RLS, and keys.");
    } else if (data) {
      console.log(`[Events DB] ✅ Event "${cleanEvent.slug}" saved to Supabase successfully.`);
      return normalizeEvent({ ...data, ticketTypes: data.ticket_types });
    }
  } else {
    console.warn("[Events DB] No Supabase configured — using memory only. Set NEXT_PUBLIC_SUPABASE_* and restart.");
  }

  // Memory path
  const index = memoryEvents.findIndex((e) => e.slug === cleanEvent.slug);
  if (index >= 0) {
    memoryEvents[index] = cleanEvent;
  } else {
    memoryEvents.push(cleanEvent);
  }
  console.log(`[Events DB] Event "${cleanEvent.slug}" saved to memory (will not survive refresh).`);
  return cleanEvent;
}

export async function deleteEvent(slug: string): Promise<boolean> {
  const client = getSupabase();

  if (client) {
    const { error } = await client.from("events").delete().eq("slug", slug);
    if (error) {
      console.error("[Events DB] Delete error", error);
      return false;
    }
    return true;
  }

  memoryEvents = memoryEvents.filter((e) => e.slug !== slug);
  return true;
}

/**
 * Convenience: toggle event enabled
 */
export async function toggleEventEnabled(slug: string, enabled: boolean): Promise<boolean> {
  const existing = await getEventBySlug(slug);
  if (!existing) return false;

  await saveEvent({ ...existing, enabled });
  return true;
}

/**
 * Seed a demo event (opt-in helper, e.g. for Admin "Seed Demo Event" button).
 * Does not auto-run during normal page loads.
 */
export async function seedDemoEvent(demoEvent: EventConfig) {
  const all = await getAllEvents();
  if (all.length === 0) {
    await saveEvent(demoEvent);
    console.log("[Events] Seeded demo event:", demoEvent.slug);
  }
  return demoEvent;
}

// Backwards-compatible alias (used by older code paths if any remain)
export const seedDefaultEventIfEmpty = seedDemoEvent;
