-- Supabase table for Ticketing System SIT purchases
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS purchases (
  id BIGSERIAL PRIMARY KEY,
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recommended: Enable Row Level Security later for production
-- For development you can start without RLS.

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
  time TEXT,
  location TEXT NOT NULL,
  image TEXT,
  enabled BOOLEAN DEFAULT true,
  ticket_types JSONB NOT NULL DEFAULT '[]',
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_enabled ON events(enabled);
