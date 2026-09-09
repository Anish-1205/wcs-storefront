# Weavers Club Sarees — Complete Project Audit

**Audit date:** 9 September 2026  
**Audited revision:** `47dbde8` (working tree also contains a user-owned deletion of `Plan.txt`)  
**Scope:** application code, routes, components, configuration, database migrations, scripts, documentation, unit/E2E specifications, and repository-delivered media. This is a static/code audit with local TypeScript, ESLint, and unit-test verification. It does not include a live production penetration test, a live Supabase schema comparison, real Cloudinary/Meta/Resend calls, Lighthouse results, or execution of the backend-dependent Playwright suite.

## 1. Executive summary

This project is a polished, inquiry-led saree catalogue built with Next.js 14. It deliberately stops short of online payment: visitors discover products, add them to an **enquiry cart**, submit contact details, and continue the conversation through WhatsApp. Optional customer accounts synchronize carts and save contact details. A separate administrator system manages database-authored products, categories, collections, contacts, subscribers, inquiries, live availability signals, bulk media imports, and WhatsApp-originated product creation.

The most important architectural fact is that the application has **two catalogue data planes**:

1. The public storefront reads product and collection definitions from TypeScript files and media from `public/media`.
2. The admin application reads and writes Supabase/PostgreSQL and uploads admin media to Cloudinary.

A one-way synchronization action mirrors file-authored storefront products into the admin database, but admin edits to those mirrored records do not change the live storefront. Only availability overrides bridge back from Supabase into the public catalogue at runtime. This design makes the storefront resilient and fast, but it is also the project's largest operational complexity and its main source of possible editorial confusion.

Overall assessment: **functionally mature and strongly guarded at important trust boundaries, with moderate operational risk caused by the dual source of truth, external-service dependence, some documentation drift, and incomplete end-to-end verification in this audit environment.**

### Verification result

| Check | Result | Evidence |
|---|---:|---|
| TypeScript | Pass | `npm run types`, exit 0 |
| Unit/integration-style tests | Pass | 19 files, 113 tests, exit 0 |
| ESLint | Pass with warning | One `react-hooks/exhaustive-deps` warning in `ImportUploader.tsx` |
| Production build | Not rerun in this audit | Repository documentation reports a previous clean build; not treated as current evidence |
| Playwright E2E | Not run | Some suites require a local Supabase stack and seeded users |
| Dependency vulnerability scan | Not rerun | Documentation records five high-severity advisories; current status must be verified against the package registry |

## 2. Business purpose and user journeys

The site supports the funnel **social discovery → catalogue exploration → WhatsApp enquiry → offline sale**. It is not a conventional e-commerce checkout.

### Public visitor journey

- Land on an editorial homepage with hero content and featured products.
- Browse the full catalogue or narrow it by colour-oriented category.
- Browse curated collections.
- Search by title, WCS reference, colour, and verified product metadata.
- Open a product detail page with an image/video media viewer, role captions, product facts, price or “Price on Enquiry,” availability, related colourways, and WhatsApp/Pinterest actions.
- Add one or more products to an enquiry cart, change quantities, or remove lines.
- Enter contact and shopping details on the enquiry page.
- Open a pre-filled WhatsApp message containing product references and quantities.
- Recover from a blocked/closed WhatsApp window using the enquiry confirmation page.
- Submit a direct inquiry or subscribe for WhatsApp updates.
- Read about, wholesale, contact, guide, shipping/returns, privacy, and terms pages.
- Change light/dark theme.

### Customer-account journey

- Sign up or sign in using email/password; optionally use Google when explicitly enabled.
- Reset a forgotten password through the callback/reset flow.
- Merge a guest cart with the account's server cart and continue across devices.
- Save reusable profile/contact details and prefill the enquiry form.
- Sign out without losing the local cart.

Accounts are optional and do not grant admin capabilities.

### Administrator journey

- Sign in with Supabase Auth and pass the configured `ADMIN_EMAILS` allowlist.
- View dashboard information and manage products, variants, media, categories, collections, contacts, inquiries, and subscribers.
- Create and edit CRM contacts, roles/statuses, notes, and follow-up dates.
- Synchronize the file storefront into the admin catalogue for visibility.
- Override storefront availability without redeploying.
- Upload media directly to Cloudinary using signed upload parameters.
- Create a bulk import batch, upload assets, review proposed product groups, confirm collection classifications, request/apply AI colour-variant suggestions, approve review, and create draft products.
- Create or extend draft products by sending captioned images through an allowlisted WhatsApp Business webhook.

## 3. System architecture

### Presentation and runtime

- **Next.js 14 App Router** provides server components, client components, route handlers, metadata, static generation, dynamic rendering, caching, and server actions.
- **React 18 + TypeScript** implement interactive cart, auth, media, admin, and form behavior.
- **Tailwind CSS** and a small local UI component set provide styling.
- The root layout provides global metadata, theme bootstrapping, analytics, and shared application structure.
- The `(public)` route group wraps the storefront in authentication and cart providers.
- The `admin/(dashboard)` route group performs a second server-side admin check in addition to middleware.

### Data/storage split

| Concern | Source of truth | Notes |
|---|---|---|
| Live product content | `src/data/products.ts` | Includes references, descriptions, media mappings, price, availability, verified attributes |
| Live collections | `src/data/collections.ts` | File-authored public collection definitions |
| Product media | `public/media/<slug>` | Local images, videos, posters, dimensions, quality scores, colour extraction data |
| Admin catalogue | Supabase tables | Independent admin-authored records plus file-sync mirrors |
| Live availability overrides | Supabase | Runtime overlay keyed by public product slug |
| Customer cart/profile | Supabase + browser local storage | RLS-scoped per authenticated user; local storage remains the offline/guest copy |
| Leads/CRM/imports | Supabase | Service-role writes or authenticated admin actions depending on flow |
| Admin-uploaded media | Cloudinary | Signed direct upload/CDN flow |

### External integrations

- **Supabase:** PostgreSQL, Auth, RLS, customer data, admin data, imports, and runtime availability overrides.
- **Cloudinary:** signed media uploads and delivery for the admin catalogue and inbound WhatsApp assets.
- **Meta WhatsApp Business API:** webhook verification, inbound media download, and acknowledgement replies.
- **Resend:** asynchronous administrator email notification after inquiry persistence.
- **Upstash Redis:** IP-based sliding-window rate limiting.
- **Anthropic:** optional, fail-soft import metadata/classification/colour suggestions and offline colour extraction.
- **Sentry:** client/server/edge error monitoring with a `/monitoring` tunnel.
- **GA4, Microsoft Clarity, Pinterest Tag:** optional public analytics.
- **IndexNow:** on-demand URL submission using a key route and script.

## 4. Public route and feature inventory

| Route | Function |
|---|---|
| `/` | Homepage, hero, featured catalogue content |
| `/catalog` | Full browse/filter view using file products plus live overrides |
| `/catalog/[category]` | Category/colour-filtered catalogue |
| `/collections` | Collection directory |
| `/collections/[slug]` | Collection detail and matching products |
| `/sarees/[slug]` | Statically parameterized product page with metadata and structured data |
| `/search` | Product search, including normalized WCS reference matching |
| `/cart` | Full enquiry-cart view |
| `/enquiry` | Customer/contact form and WhatsApp handoff |
| `/enquiry/sent` | Recovery/confirmation page using a session snapshot |
| `/signin`, `/signup` | Customer authentication |
| `/forgot-password`, `/reset-password` | Password recovery |
| `/account` | Guest prompt or authenticated saved-profile editor |
| `/auth/callback` | Exchanges OAuth/email-link code; constrains onward path to same-origin routes |
| `/guides`, `/guides/[slug]` | File-driven editorial buying/content guides |
| `/about`, `/wholesale`, `/contact` | Brand and lead-generation pages |
| `/privacy`, `/terms`, `/shipping-returns` | Legal/policy pages |
| `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest` | Search/PWA discovery assets generated by Next.js |
| `/[key]` | Serves the configured IndexNow verification key only |

Cart, enquiry, confirmation, and account/auth pages are marked `noindex`. Product pages expose canonical URLs, Open Graph images, product references, and Product JSON-LD. Sitemap and robots handlers centralize crawler discovery.

## 5. Cart and WhatsApp conversion flow

The cart is an **enquiry basket**, not an order/payment object.

1. `CartContext` hydrates `wcs.cart.v1` from local storage after mount.
2. Adding a product merges by slug, caps quantity at 20, persists synchronously, and opens the drawer.
3. Cross-tab `storage` events refresh the local cart.
4. For an authenticated user, the server cart is read and merged with the guest cart; quantities are added and capped.
5. Subsequent account-cart writes are debounced by 600 ms, with best-effort page-hide/visibility flushing.
6. The enquiry form validates name, phone, city, and related fields. Saved profile data can prefill it.
7. WhatsApp is opened synchronously from the submit gesture before asynchronous persistence, avoiding popup blocking.
8. A snapshot is written to session storage and `/api/inquiries` is fired without blocking the WhatsApp journey.
9. The confirmation page can reopen WhatsApp. The cart is cleared only on the explicit WhatsApp action, preserving selections when a popup fails.

If the public WhatsApp number is absent or invalid, calls to action fall back to `/contact`; the application does not emit a malformed `wa.me` link. Mixed priced/unpriced carts are supported, and totals are not represented as fully known when one or more products require enquiry pricing.

## 6. Authentication and authorization

There are two audiences in the same Supabase Auth project:

- **Customers:** handled client-side by `AuthContext`; can access only their own `carts` and `profiles` rows through RLS.
- **Admins:** authenticated Supabase users whose normalized email is in `ADMIN_EMAILS`.

Admin protection is layered:

1. Middleware refreshes the Supabase session and redirects unauthenticated `/admin/*` requests.
2. Dashboard layout/server components call `requireAdmin()`.
3. Server actions call `assertAdmin()`.
4. Only after verification is the service-role client created for privileged operations.

This separation is sound. The critical operational control is keeping `SUPABASE_SERVICE_ROLE_KEY`, WhatsApp, Cloudinary, Resend, and Anthropic secrets server-only and maintaining a minimal `ADMIN_EMAILS` list.

## 7. API and background-style flows

### `POST /api/inquiries`

- Applies the shared public rate limiter.
- Parses JSON and validates with Zod.
- Persists a normalized inquiry to Supabase using an admin client.
- Triggers a Resend notification without making notification delivery a prerequisite for customer success.
- Escapes user content embedded in the HTML email.

### `POST /api/subscribe`

- Applies rate limiting and Zod validation.
- Requires the service-role key.
- Inserts a WhatsApp subscriber record.

### `POST /api/upload`

- Verifies current user and admin email.
- Validates upload parameters.
- Returns a Cloudinary signature rather than receiving the whole asset through Next.js.

### `/api/import/sign` and `/api/import/complete`

- Require admin authorization.
- Use a separate high-volume limiter (600 operations/10 minutes/IP).
- Record pending assets before signing and validate the returned Cloudinary public ID when completing.
- Support direct browser-to-Cloudinary import uploads.

### `/api/whatsapp`

- `GET` completes Meta webhook verification using `WHATSAPP_VERIFY_TOKEN`.
- `POST` rejects oversized bodies, verifies `X-Hub-Signature-256` using HMAC-SHA256/timing-safe comparison, parses the first message, and ignores non-image/non-allowlisted senders.
- Deduplicates using the Meta message ID.
- A descriptive caption creates a draft product, default variant, first image, and active upload session.
- A numeric caption appends an ordered image to the sender's active session.
- Downloads media from Meta, uploads it to Cloudinary, records the ingest event, and replies to the sender.
- Returns HTTP 200 on internal processing failures to avoid Meta retry storms, relying on server logs/Sentry for diagnosis.

## 8. Admin and import pipeline

The database-backed admin covers product CRUD, per-product variants/images, category and collection organization, inquiries, WhatsApp subscribers, CRM contacts, storefront synchronization, availability, and imports.

The bulk-import process is deliberately **fail-closed**:

1. An admin creates a batch and uploads assets directly to Cloudinary.
2. Deterministic filename/folder heuristics propose product groups.
3. Collection classification may be deterministic, AI-suggested, ambiguous, or unclassified.
4. AI never directly confirms a collection; an admin must explicitly confirm uncertain output.
5. AI may draft colour-variant clusters within an existing product group.
6. An admin explicitly applies that draft before product creation splits assets into variants.
7. Imported products are created as draft with `pending_review`.
8. Publishing is blocked in both relevant write paths until review is approved.

Known import gaps are material but clearly bounded: raw-upload visual similarity grouping is not implemented, and imported video assets are not yet attached to generated products.

## 9. Database model and integrity

The migration series is additive and currently runs from `001` through `015`.

### Core commerce/catalogue entities

- `categories`
- `products`
- `product_variants`
- `variant_images`
- `collections`
- `collection_products`

Products have draft/published/archived lifecycle, held/supplier stock type, source tagging, and import review fields. Availability/sold-out state exists at variant level in the database model.

### Lead and CRM entities

- `inquiries`
- `whatsapp_subscribers`
- `contacts`

### Ingestion/import entities

- `admin_upload_sessions`
- `whatsapp_ingest_events`
- `import_batches`
- `import_product_groups`
- `import_assets`
- `collection_aliases`
- `import_collection_classifications`
- `import_processing_jobs`

### Customer/runtime entities

- `carts`
- `profiles`
- `storefront_availability_overrides`

Foreign keys, cascades, useful lookup indexes, update-time triggers, constraints, and RLS are introduced across migrations. Migration `008` tightens public joins so variants/images/collection membership are readable only through active published parents. Customer policies compare `auth.uid()` to `user_id`. Import/CRM tables are admin-only.

## 10. Media and catalogue pipeline

The public catalogue treats media preparation as a controlled build-time content pipeline:

- `prepare-media.mjs` EXIF-rotates, strips metadata, resizes stills to a maximum long edge, retains colour characteristics, and writes intrinsic dimensions.
- `optimize-video.mjs` produces H.264/yuv420p, audio-free, fast-start video and dedicated poster frames without resizing or visual filters.
- `score-media.mjs` computes inspectable sharpness/exposure/contrast/resolution scores used to choose and order presentation media.
- `extract-colour-variants.mjs` optionally asks Anthropic to extract plain colour names/hex values from colour-range photos, then writes committed JSON.
- `prepare-logo.mjs` derives theme-aware brand marks, app icons, and the Open Graph image.

`products.ts` throws when declared image dimensions are missing, which converts bad catalogue/media coupling into an early build/runtime failure instead of layout shift or silently broken presentation. Product copy follows a “nothing invented” policy: unknown weave, material, origin, price, or availability remains unknown/on-request rather than being inferred from imagery.

## 11. Security assessment

### Strong controls observed

- Service-role access is isolated to server code and privileged paths.
- Admin email allowlisting is rechecked after authentication.
- RLS protects customer-owned records and restricts public catalogue visibility.
- Zod validation is used at API/action boundaries.
- WhatsApp webhook authenticity uses signed raw bodies and timing-safe comparison.
- Webhook payload size is bounded and message IDs are deduplicated.
- Inbound WhatsApp senders require explicit allowlisting.
- Cloudinary uploads are signed and import completion cross-checks public IDs.
- Public mutation endpoints are rate limited.
- Email HTML interpolations are escaped.
- Security headers include HSTS, frame denial, MIME sniffing prevention, restrictive referrer/permissions policies, and CSP.
- OAuth/email callback onward navigation is constrained to local paths.
- AI output is schema-validated and cannot independently publish or confirm classifications.

### Security/operational concerns

1. **Dependency advisories require current verification (High until checked).** Project documentation records five high-severity advisories involving Next.js/PostCSS/glob and notes that automated force-fix proposes a breaking Next 16 upgrade. Run a current production and full dependency audit, map advisories to reachable runtime code, and upgrade Next.js within a tested migration plan.
2. **CSP permits inline scripts (Medium).** `script-src 'unsafe-inline'` is an intentional compromise to retain static/ISR behavior for developer-authored analytics bootstraps. Host allowlisting reduces exposure, but any future unsafe user-content-to-script path would increase XSS impact. Track this decision and revisit nonce/hash-based scripts when framework constraints permit.
3. **IP limiter trusts the first `x-forwarded-for` value (Medium operational).** This is appropriate only behind infrastructure that overwrites/sanitizes the header. Document the trusted proxy assumption; use the hosting platform's canonical client-IP mechanism if available.
4. **Rate limiting depends on Upstash configuration/availability (Medium availability).** Public handlers await Redis before doing useful work. Confirm behavior for missing credentials, timeout, and provider outage; decide explicitly whether each endpoint should fail closed or use a bounded local fallback.
5. **Webhook error acknowledgement hides retries (Medium).** Returning 200 on processing failure avoids retry storms but can lose an ingest unless operations monitor logs and manually replay. Add a durable failed-event/dead-letter state before acknowledgement where practical.
6. **Admin model is single-role (Low/Medium).** Every allowlisted admin effectively receives full service-role-powered application access. This is acceptable for a very small trusted team, but unsuitable for granular staff permissions or audit separation.
7. **Local environment files exist (Hygiene).** `.env.local` and `.env.sentry-build-plugin` are present. They are ignored by Git, but secrets should be rotated if ever copied, logged, backed up broadly, or committed in history; CI should include secret scanning.

## 12. Reliability and consistency assessment

### Positive characteristics

- Public product pages can operate without a live catalogue database.
- Availability overlay failures intentionally fall back to file-authored data.
- Product media includes intrinsic dimensions and poster frames.
- Cart persistence is synchronous locally and has server/offline redundancy.
- Inquiry notification failure does not break the customer's conversion flow.
- Import operations maintain explicit state, review, and confirmation gates.
- Migrations are additive rather than rewriting applied history.

### Risks and edge cases

1. **Dual source of truth (High operational).** An administrator can edit a `file_sync` row and reasonably expect the public site to change, but it will not. Make mirrored records visibly read-only or present a persistent “edit source file/redeploy” warning. Consider a longer-term single canonical catalogue.
2. **Availability fail-soft behavior can silently show stale information (Medium).** A Supabase outage restores static availability. That keeps pages online but could show “on request” instead of a recent sold/pre-order override. Emit a monitored error/metric when override loading fails.
3. **Cart merge can repeatedly add quantities in unusual session transitions (Medium/Low).** The local cart remains populated after server merge; a fresh browser/session association can add the same local quantities again. Define whether the local copy represents a mirror or unclaimed guest delta and test repeated sign-in/account-switch scenarios.
4. **Visibility listener cleanup omission (Low).** `CartContext` adds `visibilitychange` with an anonymous function but removes only `pagehide`. In normal top-level provider lifetime this is small, but use a named handler and remove both listeners.
5. **Import preview URL cleanup warning (Low).** ESLint warns that `previewUrlsRef.current` may change before cleanup. Snapshot the ref value inside the effect and revoke that snapshot to avoid leaked/revoked-wrong object URLs.
6. **Type/schema drift (Medium).** `src/lib/supabase/types.ts` is hand-maintained while SQL migrations are authoritative. Regenerate types automatically in CI against migrations or add schema-drift verification.
7. **WhatsApp handler processes only the first entry/change/message (Medium).** Batched webhook deliveries may contain more than one message. Iterate all entries/changes/messages while preserving per-message idempotency.
8. **Partial multi-step WhatsApp writes (Medium).** Product, variant, image, session, and event creation are separate service calls without a database transaction. A mid-flow failure can leave partial drafts. Move the database portion into a transactional RPC or add explicit compensating/reconciliation logic.

## 13. Performance and scalability

### Current strengths

- Public catalogue data is local and can be statically rendered.
- Product paths are known through `generateStaticParams`.
- Images use modern Next.js formats and intrinsic sizing.
- Videos use fast-start encoding and dedicated posters.
- Availability rows are read once as a small table and cached for 60 seconds with tag invalidation.
- Cloudinary direct uploads avoid routing large admin files through the application server.
- Database migrations contain indexes for common status, category, variant, price, import, contact, and foreign-key access patterns.
- Sentry build settings hide source maps and remove debug logging.

### Scalability limits

- `public/media` is documented at roughly 55 MB and committed to Git/deployment artifacts. Growth will slow clones/builds and may increase hosting bandwidth. Move storefront media to an image/video CDN or Git LFS with a reproducible manifest.
- The full availability-override table is read and mapped for each cache refresh. This is efficient at current size, but should be revisited if the catalogue becomes very large.
- Search is in-memory over the file catalogue. It is excellent for tens/hundreds of products but not for a large, frequently changing inventory.
- Admin server actions and WhatsApp flows use multiple sequential database/API calls; latency and partial failures grow with scale.
- Sentry tunneling routes browser telemetry through the Next.js deployment and can increase server usage/cost.

No current Lighthouse artifact was evaluated. Run Lighthouse against a production build on representative mobile hardware/network profiles before making numeric performance claims.

## 14. Accessibility and UX

Observed implementation intent includes semantic labels, focus movement to the first invalid enquiry field, `aria-invalid`, responsive/mobile navigation, theme support, reserved media dimensions, and graceful fallbacks for unavailable integrations.

Potential concerns requiring browser/assistive-technology verification:

- The product video intentionally autoplays and does not honor reduced-motion preference. Even muted decorative movement can affect vestibular/cognitive accessibility; offer a pause control or respect `prefers-reduced-motion`.
- Cart drawer focus trap, Escape behavior, focus return, and screen-reader announcement should be tested explicitly.
- Dark/light contrast should be measured rather than inferred from tokens.
- Admin tables/forms need keyboard-only and narrow-screen testing.
- Error/success announcements on async forms should use appropriate live regions.

## 15. SEO, analytics, and discoverability

The project has a strong SEO foundation: canonical URL helpers, per-product metadata, Open Graph artwork, robots/sitemap handlers, JSON-LD, real product imagery, descriptive routes, IndexNow support, and intentional `noindex` on transactional/account routes. Product JSON-LD uses the WCS reference as SKU/MPN and contains shipping/return information.

Analytics integrations are environment-gated. Source attribution records a first-touch referral cookie for 30 days and passes source through lead flows. Consent requirements must be assessed for the deployment jurisdictions, especially for GA4, Clarity session analytics, and Pinterest tracking. The privacy policy text is documented as not recently rewritten, so legal review is needed before launch claims of compliance.

## 16. Testing and maintainability

### Automated coverage present

- Validation schemas.
- Inquiry, upload, WhatsApp, and import API/security behavior.
- Webhook signature and sender controls.
- Slug behavior and product publish guards.
- Security-policy assertions.
- Import grouping, deletion, review gates, collection classification, colour variants, and asset completion.
- AI provider fallback/validation.
- Public-site, enquiry, admin authentication, admin CRUD, and import Playwright specifications.

The 113 passing tests provide meaningful confidence in domain rules and trust boundaries. However, line/branch coverage was not generated, and mocked unit tests do not prove deployed integration credentials, RLS behavior, or third-party API compatibility.

### Documentation condition

The repository has unusually detailed setup, deployment, admin, content, SEO, import, and storefront documentation. The main issue is drift: `README.md` still says “There is no cart,” while the application now has a complete enquiry cart and account synchronization. Some README architecture references also reflect the earlier fully Supabase-backed storefront. Treat `CLAUDE.md` and `docs/storefront-catalogue.md` as more current, then consolidate to avoid conflicting onboarding guidance.

## 17. Prioritized recommendations

### P0 — before production reliance

1. Run a current dependency/security audit and upgrade/remediate reachable high-severity advisories.
2. Execute `npm run build`, environment validation, and the complete Playwright suite against a disposable Supabase project/local stack.
3. Verify deployed RLS policies match all 15 migrations; do not rely only on checked-in SQL.
4. Confirm production redirect allowlists, admin allowlist, webhook signature secret, trusted proxy/IP behavior, and secret separation.

### P1 — next engineering cycle

1. Make `file_sync` admin records read-only or unmistakably labeled; document exactly which admin edits affect production.
2. Add monitored reporting when availability overrides fail to load.
3. Process every message in batched WhatsApp webhook payloads and make multi-table writes transactional/reconcilable.
4. Add durable failed-ingest recording/replay.
5. Fix the import object-URL cleanup warning and cart visibility-listener cleanup.
6. Add an automated migration-to-TypeScript schema drift check.
7. Update README and reconcile all stated test counts/known issues with current reality.

### P2 — quality and scale

1. Move committed storefront media to a CDN/object store when catalogue growth warrants it.
2. Add coverage reporting and tests for cart account switching/repeated sign-in merge behavior.
3. Run accessibility testing with keyboard, screen reader, reduced-motion, and contrast tooling.
4. Run Lighthouse/Web Vitals monitoring on representative catalogue and product pages.
5. Add database backup/restore drills, import reconciliation tooling, and an operations runbook.
6. Commission jurisdiction-specific legal/privacy review for policies and analytics consent.

## 18. Operational checklist

- All required environment variables pass `npm run check:env` in the deployment environment.
- Supabase migrations `001`–`015` are applied in order and generated types match.
- Customer email/Google providers and redirect patterns are configured.
- Only intended administrators appear in `ADMIN_EMAILS` and WhatsApp numbers in `WHATSAPP_ADMIN_NUMBERS`.
- Cloudinary upload folder and credentials are scoped/rotated appropriately.
- Meta webhook verification and signed POST delivery are tested end-to-end.
- Upstash outage/timeout behavior is known and alerted.
- Resend sender domain and notification recipient are verified.
- Sentry receives client, server, edge, and global error events with no sensitive payload leakage.
- Analytics IDs and consent behavior match the privacy policy.
- Canonical site URL, sitemap, robots, IndexNow key, OG image, and search verification tokens are production-correct.
- Availability override changes invalidate cache and appear on all relevant public pages.
- Database backup, restore, and failed-import recovery procedures have been tested.

## 19. Final conclusion

The project is substantially more than a brochure site: it is a resilient catalogue and lead-conversion system with customer identity, cross-device enquiry carts, CRM/admin operations, controlled content ingestion, AI-assisted but human-approved imports, and a WhatsApp-based operational workflow. Its key engineering choices—server-only privilege, defense-in-depth admin checks, RLS, boundary validation, webhook signatures, explicit review gates, and truthful product-copy rules—are appropriate and generally well implemented.

The largest risk is not an isolated code defect; it is the cognitive and operational cost of maintaining a file-driven live catalogue beside a database-driven admin catalogue. If that split remains intentional, the UI, runbooks, and permissions should make the boundary impossible to misunderstand. Address current dependency findings, complete live integration/E2E verification, improve webhook durability, and add monitoring around fail-soft paths before treating the system as fully production-audited.
