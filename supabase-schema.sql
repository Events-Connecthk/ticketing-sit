-- Supabase table for Ticketing System SIT purchases
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS purchases (
  id BIGSERIAL PRIMARY KEY,
  -- NOTE about "id":
  -- BIGSERIAL auto-increments and does NOT reset when you DELETE rows.
  -- This is normal Postgres behavior. Deleted rows do not "free up" low numbers.
  -- After many tests/deletes you will see high numbers like 700+.
  -- The important user-facing identifier is "order_reference" (generated as KPY-...).
  bought_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  number_of_tickets INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT DEFAULT 'HKD',
  event_slug TEXT NOT NULL,
  ticket_breakdown JSONB,
  order_reference TEXT,
  payment_reference TEXT,
  redeemed_at TIMESTAMPTZ,
  applied_discount_code TEXT,
  discount_amount NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- IMPORTANT: Row Level Security (RLS)
-- =========================================
-- By default with the anon key, anyone knowing your Supabase URL + anon key can read/write.
-- Enable RLS + policies before going to production.

-- Example for purchases (run in Supabase SQL editor):

-- Scanner / attendance (no separate attendance table — use purchases)
ALTER TABLE purchases 
ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ;

-- Optional order-level multi-scan log (per-ticket times live in ticket_breakdown JSON)
ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS redemptions JSONB DEFAULT '[]';

-- For applied discount codes (from checkout promo codes):
ALTER TABLE purchases 
ADD COLUMN IF NOT EXISTS applied_discount_code TEXT,
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC;

-- Clean up any duplicate/old policies first (run this to fix conflicts)
DROP POLICY IF EXISTS "Allow public insert purchases" ON purchases;
DROP POLICY IF EXISTS "Block anon select purchases" ON purchases;
DROP POLICY IF EXISTS "Block anon update purchases" ON purchases;
DROP POLICY IF EXISTS "Block anon delete purchases" ON purchases;
DROP POLICY IF EXISTS "Block anon reads on purchases" ON purchases;

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- Public (anon key from browser) can INSERT new purchases from checkout
CREATE POLICY "Allow public insert purchases" 
ON purchases 
FOR INSERT 
TO anon 
WITH CHECK (true);

-- Block anon from reading/updating/deleting (admin uses service_role on server)
CREATE POLICY "Block anon reads on purchases" 
ON purchases 
FOR SELECT 
TO anon 
USING (false);

CREATE POLICY "Block anon update purchases" 
ON purchases 
FOR UPDATE 
TO anon 
USING (false);

CREATE POLICY "Block anon delete purchases" 
ON purchases 
FOR DELETE 
TO anon 
USING (false);

-- For admin dashboard you will later need proper auth (Supabase Auth users with admin role)
-- or use Supabase service_role key ONLY on server (never NEXT_PUBLIC).

-- For events: public can read (app filters enabled), admin writes now use service_role
-- Clean up first (safe to run multiple times)
DROP POLICY IF EXISTS "Allow public read events" ON events;
DROP POLICY IF EXISTS "anon can select events" ON events;
DROP POLICY IF EXISTS "anon can insert events" ON events;
DROP POLICY IF EXISTS "anon can update events" ON events;
DROP POLICY IF EXISTS "anon can delete events" ON events;

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Public can still read all events (frontend code filters by enabled = true)
CREATE POLICY "Allow public read events" 
ON events 
FOR SELECT 
TO anon 
USING (true);

-- No anon writes anymore (admin uses SUPABASE_SERVICE_ROLE_KEY via server actions)

-- For development you can start without RLS (current default).

-- Optional: Index for common queries
CREATE INDEX IF NOT EXISTS idx_purchases_event_slug ON purchases(event_slug);
CREATE INDEX IF NOT EXISTS idx_purchases_email ON purchases(email);

-- =========================================
-- EVENTS TABLE (for admin-managed events + ticket types)
-- =========================================
CREATE TABLE IF NOT EXISTS events (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  date TEXT NOT NULL,
  end_date TEXT,
  time TEXT,
  location TEXT NOT NULL,
  image TEXT,
  enabled BOOLEAN DEFAULT true,
  payment_enabled BOOLEAN DEFAULT true,
  ticket_template TEXT,
  ticket_types JSONB NOT NULL DEFAULT '[]',
  buyer_form_fields JSONB DEFAULT '[]',
  discount_codes JSONB DEFAULT '[]',
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_enabled ON events(enabled);

-- Add new columns for end date (sales close) and custom per-event buyer form fields.
-- REQUIRED for the new event form features (endDate + custom buyer fields + discounts metadata).
-- Run this in Supabase SQL Editor if you have an existing table:

ALTER TABLE events 
ADD COLUMN IF NOT EXISTS end_date TEXT,
ADD COLUMN IF NOT EXISTS buyer_form_fields JSONB DEFAULT '[]';

-- After running, re-save your events in the admin panel to populate the fields.
-- Note: Discounts are stored inside the existing ticket_types JSONB, no new column needed for them.

-- =========================================
-- RUN THESE AFTER ADDING NEW FEATURES (e.g. discount codes)
-- =========================================
-- After adding features like discount codes, buyer form fields, end_date, image etc.
-- run the following in Supabase SQL Editor (once):

ALTER TABLE events 
ADD COLUMN IF NOT EXISTS end_date TEXT,
ADD COLUMN IF NOT EXISTS buyer_form_fields JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS discount_codes JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS image TEXT,
ADD COLUMN IF NOT EXISTS payment_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS ticket_template TEXT;

-- Then re-save your events from the admin panel.
-- Without running these, you will get PGRST204 "Could not find the 'xxx' column" errors.
-- The app falls back to in-memory storage for those fields.

-- For purchases table (applied discount codes):
ALTER TABLE purchases 
ADD COLUMN IF NOT EXISTS applied_discount_code TEXT,
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_payment_reference_unique
  ON purchases (payment_reference)
  WHERE payment_reference IS NOT NULL AND payment_reference <> '';

-- =========================================
-- PENDING KPAY PAYMENTS (required on Vercel)
-- =========================================
-- Serverless instances do not share memory. Webhook + return URL need a durable cart.
-- App uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).

CREATE TABLE IF NOT EXISTS pending_kpay_payments (
  out_trade_no TEXT PRIMARY KEY,
  cart JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_url TEXT,
  managed_order_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_kpay_status ON pending_kpay_payments(status);
CREATE INDEX IF NOT EXISTS idx_pending_kpay_created ON pending_kpay_payments(created_at);

ALTER TABLE pending_kpay_payments ENABLE ROW LEVEL SECURITY;

-- No anon access — only service_role from server
DROP POLICY IF EXISTS "Block anon pending kpay" ON pending_kpay_payments;
CREATE POLICY "Block anon pending kpay"
  ON pending_kpay_payments
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- =========================================
-- RESETTING PURCHASE IDs (BIGSERIAL)
-- =========================================
-- Why your purchase "id" starts at 702 (or high numbers):
-- - BIGSERIAL uses an internal sequence that keeps counting even after DELETE.
-- - This is by design (guarantees unique IDs forever).
-- - Deleting rows does NOT make the counter go back to 1.
--
-- If you want the next purchase id to start from 1 again (for testing):
--
-- Option 1: Truncate (deletes ALL rows + resets the counter)
-- WARNING: This deletes every purchase record permanently.
TRUNCATE TABLE purchases RESTART IDENTITY;
--
-- Option 2: Keep the data but reset the counter anyway (advanced)
-- First find your exact sequence name:
--   SELECT pg_get_serial_sequence('purchases', 'id');
-- Then (replace purchases_id_seq with the real name):
--   ALTER SEQUENCE purchases_id_seq RESTART WITH 1;
--
-- After resetting, do a new purchase — the id should now be low (1, 2, ...).
--
-- RECOMMENDATION:
-- Do NOT rely on the numeric "id" for users or tickets.
-- The app already uses "order_reference" (e.g. KPY-1720000000000) as the public ID.
-- That field is generated fresh for every purchase in lib/integrations/order.service.ts.
