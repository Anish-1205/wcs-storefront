# Diagrams

Standalone, self-contained HTML diagrams. Each file is a single page with no
build step and no external assets — open it directly in a browser:

```bash
start docs/diagrams/runtime-architecture.html    # Windows
open  docs/diagrams/runtime-architecture.html    # macOS
```

| Diagram | What it shows |
| --- | --- |
| [runtime-architecture.html](runtime-architecture.html) | The runtime request paths: storefront reads, the enquiry/WhatsApp conversion path, catalog visibility fallbacks, WhatsApp ingestion, and the admin write path. |

## runtime-architecture.html

Covers the four flows that matter at runtime, and deliberately nothing else
(no file-by-file module map — [../../CLAUDE.md](../../CLAUDE.md) is the text of record):

- **Public read** — visitor → `src/middleware.ts` (site-wide CSP, auth only on
  `/admin/**`, so public pages pay no auth round-trip) → storefront RSC →
  `getPublicCatalog`, which reconciles the file catalog in `src/data/` against
  published Postgres rows.
- **Catalog visibility fallback** — when the Postgres read fails, the reader
  degrades through the per-instance last-good read → the Upstash mirror → the
  `prebuild` snapshot, and **fails closed** past `VISIBILITY_MAX_STALE_MS`
  (default 15 min) by rendering `<CatalogUnavailable>` rather than serving the
  pure file catalog, which would put admin-hidden products back on the site.
- **Conversion** — there is no checkout. Enquiry cart → `/enquiry` → `wa.me`
  opened synchronously inside the click gesture, plus the lead APIs
  (`/api/inquiries`, `/api/subscribe`), whose rate limiter fails *open* so an
  Upstash outage never costs an enquiry.
- **Admin write** — Meta Cloud API → `/api/whatsapp` (HMAC signature + sender
  allowlist) → ingest pipeline, which only ever produces drafts; admin actions
  all pass through `assertAdmin` (email allowlist + TOTP) to reach the
  service-role client that bypasses RLS.

The three boundaries drawn are the public unauthenticated surface, the Next.js
runtime on Vercel, and the privileged service-role zone.

### Regenerating

Produced with the `archify` skill, which writes its working files to the
git-ignored `.archify/`. Only the final HTML is promoted here, by hand. The
generator's gates (validate, deliver, check, browser-check) all passed with
zero diagnostics; its own note was that a few route detours would benefit from
perceptual review, which is cosmetic and does not affect the content.

Regenerate from the diagram's own description of the system, then copy the
result over this file — the scratch directory is not meant to be committed.
