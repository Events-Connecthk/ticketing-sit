# Ticketing System SIT

Professional, production-ready, highly modular ticketing platform built with Next.js 15, TypeScript, and Tailwind.

**Standalone first.** A button on any WordPress (or other) site can simply redirect users here to complete their purchase. Optional integration exists to push the resulting order back into WooCommerce.

## Key Principles

- **Standalone by default**: Core ticketing flow works with zero external dependencies.
- **Modular by design**: All external integrations (payment, orders, email, DB) are abstracted.
- **Configuration driven**: Events are fully managed in the Admin UI. Environment variables drive integrations.
- **No vendor lock-in**: Can support different WordPress sites or replace Wonder with another provider.

## Demo Event

**At The Peak** is the initial demo event (accessible at `/at-the-peak`).

It can be fully edited or deleted in the Admin → Manage Events tab. You can start with a completely empty set of events if you want.

## Core User Flow (Standalone)

Users typically arrive via a redirect from your WordPress "Buy Ticket" button.

1. `/{eventSlug}` (e.g. `/at-the-peak`)
   - Event details loaded from DB (or demo fallback)
   - Only **enabled** events and ticket types are shown
   - User selects quantities (real-time total)
   - Fills buyer form (name, phone, email) with validation

2. `/[eventSlug]/checkout`
   - Order summary
   - "Pay with Wonder" button (currently simulated)

3. Simulated payment → full post-payment pipeline runs:
   - (Optional) Create order in WooCommerce (if WP keys configured)
   - Save purchase record (Supabase or in-memory)
   - Generate PDF ticket (via @react-pdf/renderer)
   - Send confirmation email with PDF (Resend or console sim)
   - Redirect to success page with order reference

4. `/[eventSlug]/success` — Shows confirmation + order ref. PDF can be re-downloaded.

5. Admin (`/admin`, password-protected)
   - Purchases tab: view, search, export (Excel/CSV)
   - Manage Events tab: full CRUD + per-event enable/disable + per-ticket-type enable/disable
   - "At The Peak" (or any event) can be completely deleted

The entire platform runs independently. WooCommerce sync is purely optional.

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
    woocommerce.ts
    wonder.ts            ← Stubbed (see note below)
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

**Wonder.app Payment Integration**

The actual payment integration with Wonder.app is **intentionally stubbed**.

The current checkout page has a "Simulate Successful Payment" flow that:
- Calls the stub in `lib/integrations/wonder.ts`
- Runs the full post-payment pipeline via `order.service.ts`

To enable the real integration:
- Ask the developer to implement the real Wonder flow
- Provide the real API keys and any required webhook endpoints

**WooCommerce (Optional)**

When `WP_SITE_URL`, `WC_CONSUMER_KEY`, and `WC_CONSUMER_SECRET` are set, real orders are created in your external WordPress site after payment.
If the keys are missing, a simulated `DEV-` order reference is used so the rest of the flow (PDF, email, purchase record) can still be tested.

The platform is designed to be used standalone. WP is only needed if you want order data mirrored back into your original site.

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

## Production Checklist

- [ ] Replace simple admin auth with proper authentication
- [ ] Configure real Wonder.app integration + webhooks
- [ ] Set up Supabase table + Row Level Security (or equivalent)
- [ ] Configure production email domain + Resend
- [ ] Add rate limiting / CSRF on sensitive routes
- [ ] Set proper CORS / allowed origins for WordPress redirects
- [ ] Add logging / error monitoring (Sentry, etc.)

## License

Internal project.
