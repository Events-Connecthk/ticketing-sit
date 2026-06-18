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
    time: raw.time,
    location: raw.location,
    image: raw.image,
    enabled: raw.enabled !== false, // default true
    ticketTypes: (raw.ticketTypes || raw.ticket_types || []).map((t: any) => ({
      ...t,
      enabled: t.enabled !== false,
    })),
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

    // Merge any in-memory events (in case of recent fallback saves or mixed)
    const memoryToAdd = memoryEvents.filter(
      (m) => !results.some((r) => r.slug === m.slug)
    );
    return [...results, ...memoryToAdd.map(normalizeEvent)];
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

    if (error) {
      console.error("[Events DB] Supabase get by slug error:", error);
    }
    if (!error && data) {
      return normalizeEvent(data);
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
    ticketTypes: event.ticketTypes.map((t) => ({
      ...t,
      enabled: t.enabled !== false,
    })),
  };

  if (client) {
    // Use upsert by slug
    const { data, error } = await client
      .from("events")
      .upsert({
        slug: cleanEvent.slug,
        name: cleanEvent.name,
        description: cleanEvent.description || null,
        date: cleanEvent.date,
        time: cleanEvent.time || null,
        location: cleanEvent.location,
        image: cleanEvent.image || null,
        enabled: cleanEvent.enabled,
        ticket_types: cleanEvent.ticketTypes || [],
        metadata: cleanEvent.metadata || {},
      })
      .select()
      .single();

    if (error) {
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
