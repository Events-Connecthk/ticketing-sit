/**
 * Event Configuration - The Single Source of Truth
 *
 * Updated for admin management:
 * - Primary source is now the database (via lib/db/events)
 * - Falls back to this hardcoded default when no DB or no events exist.
 * - This allows adding/editing events from the admin UI with zero code changes.
 */

import { EventConfig, TicketType } from "@/types";
import { getEventBySlug as getDbEvent, getAllEvents as getDbEvents } from "../db/events";

// Base ticket types (used for default seed)
const generalAdmission: TicketType = {
  id: "ga",
  name: "General Admission",
  description: "Standard entry ticket",
  price: 350,
  currency: "HKD",
  maxPerOrder: 6,
  enabled: true,
};

const vipTicket: TicketType = {
  id: "vip",
  name: "VIP Experience",
  description: "Includes priority entry, exclusive lounge access & gift bag",
  price: 680,
  currency: "HKD",
  maxPerOrder: 4,
  enabled: true,
};

// Default development event (used as seed when DB is empty)
export const AT_THE_PEAK: EventConfig = {
  slug: "at-the-peak",
  name: "At The Peak",
  description:
    "An unforgettable evening at the summit. Experience breathtaking views, world-class performances, and a celebration under the stars. Join us for a night of inspiration, connection, and magic.",
  date: "2026-07-18",
  time: "18:30 – 23:00",
  location: "Victoria Peak, Hong Kong",
  image: undefined,
  enabled: true,
  ticketTypes: [generalAdmission, vipTicket],
  metadata: {
    wpEventId: "123",
    organizer: "SIT Events",
  },
};

// Synchronous fallback (used in a few places or as immediate default)
export function getEventBySlug(slug: string): EventConfig | null {
  return slug === AT_THE_PEAK.slug ? AT_THE_PEAK : null;
}

export function getAllEvents(): EventConfig[] {
  return [AT_THE_PEAK];
}

/** Helper for admin "Seed Demo" button - does not auto-run on page loads */
export const getDefaultDemoEvent = () => AT_THE_PEAK;

// ============================================
// DB-backed loaders (preferred when Supabase configured)
// ============================================

/**
 * Load a single event from the database (or memory fallback).
 * No automatic seeding of "At The Peak" occurs here.
 * If the event was deleted by the admin, it will simply return null.
 */
export async function loadEventBySlug(slug: string): Promise<EventConfig | null> {
  // Pure DB / memory lookup. No fallback to the static demo.
  // If the event was deleted in admin, this will return null and the page will show "not found".
  const dbEvent = await getDbEvent(slug);
  return dbEvent;
}

/**
 * Load all events from the database (or memory fallback).
 * Does NOT auto-seed "At The Peak".
 * Empty result is valid (user may have deleted all events).
 */
export async function loadAllEvents(): Promise<EventConfig[]> {
  // Pure DB / memory lookup. Returns whatever is stored.
  // If nothing exists (user deleted everything), returns empty array.
  return await getDbEvents();
}
