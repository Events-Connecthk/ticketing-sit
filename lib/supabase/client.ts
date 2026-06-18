import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared Supabase browser client.
 *
 * Creating the client only once prevents the "Multiple GoTrueClient instances detected"
 * warning from Supabase and avoids potential race conditions.
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    if (!supabaseInstance) {
      console.warn(
        "[Supabase] Not configured. Make sure you have NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then FULLY restart the dev server."
      );
    }
    return null;
  }

  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  return supabaseInstance;
}

export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Convenience aliases so existing imports in db/events.ts and db/purchases.ts continue to work
