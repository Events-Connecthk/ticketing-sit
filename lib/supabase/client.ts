import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared Supabase browser client.
 *
 * Creating the client only once prevents the "Multiple GoTrueClient instances detected"
 * warning from Supabase and avoids potential race conditions.
 */

// For client-side (browser) code, Next.js only exposes vars prefixed with NEXT_PUBLIC_
// We strongly prefer those. Non-prefixed may only work server-side.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    if (!supabaseInstance) {
      console.warn(
        "[Supabase] Not configured. You MUST set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (the non-NEXT_PUBLIC_ versions are invisible to the browser). Then FULLY restart `npm run dev`."
      );
    }
    return null;
  }

  if (!supabaseInstance) {
    // Robust singleton to avoid "Multiple GoTrueClient instances" warning
    console.log("[Supabase] Creating client with URL:", SUPABASE_URL ? SUPABASE_URL.substring(0, 30) + '...' : 'MISSING');
    const globalKey = '__SUPABASE_CLIENT__';
    if (typeof window !== 'undefined' && (window as any)[globalKey]) {
      supabaseInstance = (window as any)[globalKey];
    } else {
      supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          storageKey: 'sb-ticketing-sit-auth-token', // fixed key to reduce duplicates
        },
      });
      if (typeof window !== 'undefined') {
        (window as any)[globalKey] = supabaseInstance;
      }
    }
  }

  return supabaseInstance;
}

export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Convenience aliases so existing imports in db/events.ts and db/purchases.ts continue to work
