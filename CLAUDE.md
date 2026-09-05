# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Next.js 14 (App Router) storefront + admin panel for a saree wholesale/retail business. Public catalog with WhatsApp-based lead capture (no e-commerce checkout — inquiries and WhatsApp are the conversion path), backed by Supabase (Postgres + Auth), Cloudinary for images, Upstash Redis for rate limiting, Resend for email notifications, and Sentry for error tracking.

**Two data sources, on purpose.** As of Sept 2026 the customer-facing storefront (`src/app/(public)/**`) is **file-driven** — it reads from `src/data/products.ts` / `src/data/collections.ts` with media in `public/media/<slug>/`, and adds a client-side enquiry cart that hands off to WhatsApp. The **admin panel and import pipeline (`src/app/admin/**`, `src/lib/queries.ts`, all Supabase/Cloudinary) are unchanged** and still run against Postgres. See [docs/storefront-catalogue.md](docs/storefront-catalogue.md) for the storefront (product data, media pipeline, cart, WhatsApp handoff, env vars, the "nothing is invented" claims rule). The Supabase sections below still describe the admin half.

## Commands

```bash
npm run dev              # Start dev server
npm run build             # Production build
npm run start              # Run production build
npm run lint                # ESLint
npm run types                # TypeScript check (tsc --noEmit)
npm test                      # Run vitest unit tests (src/__tests__/**/*.test.ts)
npm run test:e2e               # Playwright e2e tests (e2e/, builds+starts prod server on :3000)
npm run check:env               # Validate required env vars are set (scripts/check-env.mjs --production)
npx vitest run src/__tests__/whatsapp-route.test.ts   # Run a single test file
```

Local Supabase (requires Docker + Supabase CLI):

```bash
supabase start
supabase db reset     # Reapplies all supabase/migrations/*.sql in order + seed data
supabase gen types typescript --local > src/lib/supabase/types.ts   # Regenerate DB types after schema changes
```

```bash
node scripts/prepare-media.mjs "<source folder>"   # (re)build public/media from the raw photo/video library
node scripts/optimize-video.mjs                      # re-encode public/media/**/*.mp4 (H.264 CRF 28, audio stripped)
```

See [docs/storefront-catalogue.md](docs/storefront-catalogue.md) for the file-driven storefront (products, media, cart, WhatsApp), [docs/setup.md](docs/setup.md) for full local setup, [docs/deployment.md](docs/deployment.md) for deploy steps, [docs/admin-guide.md](docs/admin-guide.md) / [docs/content-guide.md](docs/content-guide.md) for content/admin usage, and [docs/import-pipeline.md](docs/import-pipeline.md) for the bulk media import system.

## Architecture

**Route groups**: `src/app/(public)/` is the storefront (catalog, product pages, collections, cart, `/enquiry`, static pages) — file-driven, see [docs/storefront-catalogue.md](docs/storefront-catalogue.md); `src/app/admin/` is the admin panel, split into `admin/login` (unauthenticated) and `admin/(dashboard)/` (authenticated CRUD for products, variants, categories, collections, inquiries, contacts, subscribers).

**Auth**: Single Supabase Auth email/password account gates the admin — there is no multi-user role system. Signups are disabled; the admin user is created out-of-band via the Supabase CLI/Studio. Two layers of defense:
- `src/middleware.ts` — edge guard on `/admin/:path*`, refreshes the session cookie and redirects unauthenticated requests to `/admin/login`.
- `src/lib/admin-auth.ts` — `requireAdmin()` (Server Components/Actions, redirects on failure) and `assertAdmin()` (throws instead, for use inside actions) additionally check the user's email against the `ADMIN_EMAILS` allowlist and return the service-role admin client.

**Supabase clients** (`src/lib/supabase/`): `client.ts` is the browser client, `server.ts` exposes `createClient()` (anon, RLS-respecting, cookie-based session) and `createAdminClient()` (service-role, bypasses RLS — only ever used after an admin check). `types.ts` is a hand-maintained mirror of the SQL schema; regenerate it with the Supabase CLI after migration changes rather than hand-editing when possible.

**Data model** (see `supabase/migrations/001_schema.sql` for the source of truth): `products` → `product_variants` (color/status/price per variant) → `variant_images`. Products have a `status` (`draft`/`published`/`archived`) and `stock_type` (`held`/`supplier`). Separate `categories` and `collections` (with a join table) organize the catalog. `contacts` is a lightweight CRM (customers/resellers/suppliers/weavers) fed by manual entry, inquiries, and subscribers. `admin_upload_sessions` and `whatsapp_ingest_events` support image upload flow and WhatsApp webhook processing respectively. Migrations are numbered and additive — never edit an applied migration; add a new one (see `supabase/migrations/008_harden_public_policies.sql` for the RLS-hardening pattern).

**Lead capture flow**: There's no payment/checkout. The storefront has an enquiry cart (`src/lib/cart/CartContext.tsx`, `localStorage` `wcs.cart.v1`, synchronous persist) → `/enquiry` form → opens a pre-filled `wa.me` message **synchronously inside the click gesture** (before any `await`, or popup blockers kill it) → `/enquiry/sent` (clears the cart only when the customer clicks through). The WhatsApp number lives in one place: `NEXT_PUBLIC_WHATSAPP_NUMBER` → `src/lib/whatsapp.ts` (`WHATSAPP_CONFIGURED`, falls back to `/contact` when unset). Product pages also drive users to WhatsApp directly (`WhatsAppCTA`, `WhatsAppFloat`, `WhatsAppBanner`) or an inquiry form (`InquiryForm` → `POST /api/inquiries`). `/api/whatsapp` is a webhook receiver — verify its signature via `src/lib/webhook-security.ts` (`verifyWhatsAppSignature`, HMAC-SHA256 over `WHATSAPP_APP_SECRET`, timing-safe compare) before trusting payloads, and check the sender against `WHATSAPP_ADMIN_NUMBERS` via `isAllowedWhatsAppAdmin`. `src/lib/source-tracking.ts` + `SourceTracker` attribute inquiries/subscribers to their referral source.

**Rate limiting**: `src/lib/rate-limit.ts` wraps Upstash Redis (`Ratelimit.slidingWindow`, keyed by `x-forwarded-for`) — used on public-facing POST endpoints (`/api/inquiries`, `/api/subscribe`, `/api/whatsapp`) to throttle abuse.

**Images**: Cloudinary (`src/lib/cloudinary.ts`, `ImageUploader`) handles all product/variant image uploads and delivery; there's no local image storage.

**Validation**: Zod schemas in `src/lib/validation.ts` are the source of truth for input shapes on both API routes and admin forms/actions — validate at the API boundary, not just in the UI.

**Observability**: Sentry (`@sentry/nextjs`) is wired via `src/instrumentation.ts` / `src/instrumentation-client.ts` / `sentry.*.config.ts`; `global-error.tsx` reports unhandled errors.

**Product media import pipeline** (`/admin/import`, `supabase/migrations/009_import_pipeline.sql`): bulk desktop/mobile photo & video ingestion — direct-to-Cloudinary signed uploads (`/api/import/sign`, `/api/import/complete`), heuristic grouping into proposed products (`src/lib/import/grouping.ts`), and fail-closed collection assignment (`src/lib/import/collection-classification.ts`) that only ever reaches `confirmed` via a deterministic source or explicit admin action — AI can only produce a `suggested` state requiring confirmation. AI suggestions go through a small provider abstraction (`src/lib/ai/`, Anthropic by default, always safely degrading to a no-op provider). Imported products are always `draft` with `review_status = 'pending_review'` and are blocked from publishing (in both `saveProduct` and `updateProductStatus`) until `approveImportedProductReview` is called; pre-existing products are unaffected (`review_status = 'not_required'`). See [docs/import-pipeline.md](docs/import-pipeline.md) for the full design and known gaps (video assets aren't attached to the product yet; visual-similarity grouping isn't implemented).

## Testing

- Unit tests (Vitest) live in `src/__tests__/` and cover validation schemas, API routes (inquiries, whatsapp, upload), webhook security, security policies, and the WhatsApp ingestion flow (product creation + photo-append, mocked Supabase/Meta/Cloudinary) — run with `npm test`.
- E2E tests (Playwright) live in `e2e/` and run against a production build (`playwright.config.ts` builds+starts the app on port 3000). `public-site.spec.ts` has no backend dependency; `admin-auth.spec.ts` and `admin-product-crud.spec.ts` exercise real admin login/CRUD against a local Supabase stack (`supabase start` + two seeded users — see [docs/setup.md](docs/setup.md#running-the-full-e2e-suite-locally)); `enquiry.spec.ts` mocks `/api/inquiries` at the network layer and needs no backend. Cloudinary uploads are mocked in-browser via `e2e/helpers.ts`.
- When changing validation logic, webhook signature checks, or RLS policies, add/update the corresponding test in `src/__tests__/`.
