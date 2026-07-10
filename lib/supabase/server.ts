import { createClient, SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side Supabase client using SERVICE_ROLE_KEY.
 * This key bypasses RLS and should ONLY be used in server actions / API routes.
 * NEVER import this in client components.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

let supabaseAdminInstance: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!supabaseUrl || !serviceRoleKey) {
    if (!supabaseAdminInstance) {
      console.warn('[Supabase Server] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Admin operations will fall back to memory.')
    }
    return null
  }

  if (!supabaseAdminInstance) {
    supabaseAdminInstance = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return supabaseAdminInstance
}

// Keep the old export for backward compat in actions (but it will be lazy now)
// For code that still does `import { supabaseAdmin }`, this gives a clear error.
// Prefer using getSupabaseAdmin() and checking for null.
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(target, prop) {
    const client = getSupabaseAdmin()
    if (!client) {
      throw new Error('supabaseKey is required. Please set SUPABASE_SERVICE_ROLE_KEY in .env.local and restart.')
    }
    return (client as any)[prop]
  }
})
