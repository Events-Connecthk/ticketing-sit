# Ticketing System SIT

Professional event ticketing platform built with Next.js 15, TypeScript, and Tailwind CSS.

A clean, standalone solution for selling and managing event tickets.

## Key Principles

- **Standalone by default**: Core ticketing flow works with zero external dependencies.
- **Modular by design**: All external integrations (payment, orders, email, DB) are abstracted.
- **Configuration driven**: Events are fully managed in the Admin UI. Environment variables drive integrations.
- **No vendor lock-in**: Can support different payment providers (currently using KPay).

## Demo Event

**At The Peak** is the initial demo event (accessible at `/at-the-peak`).

It can be fully edited or deleted in the Admin → Manage Events tab. You can start with a completely empty set of events if you want.

## Core User Flow (Standalone)

Users arrive directly via the event catalogue.

1. `/{eventSlug}` (e.g. `/at-the-peak`)
   - Event details loaded from DB (or demo fallback)
   - Only **enabled** events and ticket types are shown
   - User selects quantities (real-time total)
   - Fills buyer form (name, phone, email) with validation

2. `/[eventSlug]/checkout`
   - Order summary
   - "Pay with KPay" button (currently simulated)

3. Simulated payment → full post-payment pipeline runs:
   - Save purchase record (Supabase or in-memory)
   - Generate PDF ticket (via @react-pdf/renderer)
   - Send confirmation email with PDF (Resend or console sim)
   - Redirect to success page with order reference

4. `/[eventSlug]/success` — Shows confirmation + order ref. PDF can be re-downloaded.

5. Admin (`/sit-admin`, password-protected)
   - Purchases tab: view, search, export (Excel/CSV)
   - Manage Events tab: full CRUD + per-event enable/disable + per-ticket-type enable/disable
   - "At The Peak" (or any event) can be completely deleted

The entire platform runs independently.

## Folder Structure (as specified)

```
app/
  (public)/
    [eventSlug]/
      page.tsx
      checkout/page.tsx
      success/page.tsx
  admin/page.tsx
components/
  ticketing/
lib/
  integrations/
    order.service.ts     ← Core orchestration
    kpay.ts              ← Stubbed (see note below)
    email.ts
  config/
    events.ts
  db/
    purchases.ts
  pdf/
    generate-ticket.tsx
types/
```

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Copy env and configure
cp .env.example .env.local

# 3. Run dev server
npm run dev
```

Visit http://localhost:3000

## Environment Variables

See `.env.example`. Most integrations gracefully degrade when keys are missing (useful for development).

## Important Notes About Integrations

**KPay Payment Integration (All Hosted Checkout)**

Real Merchant Mode integration lives in `lib/integrations/kpay.ts`.

| Env | Purpose |
|-----|---------|
| `KPAY_MERCHANT_CODE` | Merchant ID (test: `852124272000001`) |
| `KPAY_API_BASE_URL` | Sandbox: `https://online-sandbox.kpay-group.com/api` |
| `KPAY_MERCHANT_PRIVATE_KEY` | PKCS#8 PEM — signs requests (SHA256-RSA) |
| `KPAY_PLATFORM_PUBLIC_KEY` | PKCS#8 PEM — verifies webhooks |
| `NEXT_PUBLIC_SITE_URL` | Return/notify URLs + email links |

Flow: `POST /v1/payment/web/managed` → `paymentUrl` → user pays on KPay → return to `/{slug}/checkout?session=<outTradeNo>` → finalize purchase. Webhook: `/api/webhooks/kpay`.

Simulation only when **not production** and merchant code is missing.

**Test cards (sandbox):** `5454 5454 5454 5454` or `4917 6100 0000 0000` — exp `03/30`, CVV `737`, 3DS password `password`.  
Simulator UI: https://online-sandbox.kpay-group.com/home

The platform is designed to be fully standalone. No external order syncing is required.

**Database**

Uses Supabase when credentials are present. Falls back to in-memory (resets on restart) otherwise.

Create a `purchases` table in Supabase using the columns defined in `lib/db/purchases.ts`.

**Email + PDF**

Uses Resend when `RESEND_API_KEY` is set. PDF generation uses `@react-pdf/renderer`.

## Admin Access

Default demo password: `sit-admin-2026`

Change via `ADMIN_PASSWORD` / `NEXT_PUBLIC_ADMIN_PASSWORD`.

## Adding a New Event

Edit `lib/config/events.ts`:

```ts
const newEvent: EventConfig = { ... };
EVENTS[newEvent.slug] = newEvent;
```

Create any additional pages or customizations under `app/(public)/[new-slug]`.

## Remaining Tasks / TODOs

### Core Features
- [x] Full checkout → payment sim → success + PDF download flow
- [x] Background PDF/email processing (immediate redirect, no stuck UI)
- [x] QR codes on tickets linking to safe public check page
- [x] Admin-only redemption via scanner (camera + manual) that updates DB + admin + exports
- [x] Real KPay All Hosted Checkout (web/managed + webhook + RSA helpers)
- [ ] Finish Canva-designed PDF template (place your exported PDF at public/ticket-template.pdf)

### Reliability & Data
- [x] Purchases always backup to memory + merge (appear even on Supabase errors)
- [x] Scanner redemptions persist via proper update (no more duplicate keys)
- [ ] Fix Supabase "Failed to fetch" errors in the browser (check your NEXT_PUBLIC_ keys + full restart)
- [ ] Resolve any lingering "Multiple GoTrueClient instances" Supabase warnings
- [x] Removed all legacy WooCommerce code/files

### Admin & Security
- [x] Public QR scan is read-only (safe for anyone)
- [x] Redemption gated behind admin password (server-side verification)
- [x] Basic security headers added
- [ ] Replace simple password gate with proper authentication (NextAuth, Supabase Auth, etc.)
- [ ] Implement proper Supabase Row Level Security (RLS) policies
- [ ] Add more loading states, error toasts, and better UX in admin/scanner

### Production Readiness
- [ ] Set up real email sending with Resend (currently simulated)
- [ ] Add rate limiting / abuse protection
- [ ] Proper logging / monitoring (e.g. Sentry)
- [ ] Full production deployment prep (env, domain, etc.)

### Polish & UX
- [x] Scanner tab with live camera QR scanning
- [ ] Make PDF generation more robust / move to server route if client issues appear
- [ ] Improve empty states, disabled events handling, better loading spinners
- [ ] Update documentation / README (in progress)

## Production Checklist

- [ ] Replace simple admin password with proper auth (middleware + sessions or Supabase Auth)
- [x] Webhook skeleton prepared at app/api/webhooks/kpay/route.ts (fill in when keys arrive)
- [ ] Enable + test Supabase RLS policies
- [ ] Configure real Resend + verified sending domain
- [ ] Add rate limiting, better input validation, CSRF where needed
- [ ] Add logging / observability
- [ ] Complete Canva ticket template
- [ ] Production build + deployment testing

## License

Internal project.
