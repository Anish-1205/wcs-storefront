# Saree Website

A premium catalog + WhatsApp-inquiry website for a family-owned saree sourcing
and distribution business. Built to drive the proven funnel:

> Instagram / Pinterest → Website → WhatsApp Inquiry → Sale

There is **no cart or checkout** by design — every page drives a WhatsApp
inquiry or a subscriber opt-in.

## Tech stack

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS** + hand-rolled shadcn-style UI
- **Supabase** (PostgreSQL + Auth + RLS)
- **Cloudinary** (signed image uploads + CDN)
- **Resend** (inquiry email notifications)
- **Vercel** (hosting)
- GA4 + Microsoft Clarity + Pinterest Tag

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in values
supabase start && supabase db reset
npm run dev
```

Full instructions: [`docs/setup.md`](docs/setup.md).

## Documentation

| Doc | For |
| --- | --- |
| [docs/setup.md](docs/setup.md) | Local development setup |
| [docs/deployment.md](docs/deployment.md) | Deploying to Vercel + Supabase + Cloudinary |
| [docs/admin-guide.md](docs/admin-guide.md) | Non-technical guide for the family team |
| [docs/content-guide.md](docs/content-guide.md) | Writing descriptions & photo guidelines |

## Project structure

```
src/
  app/
    (public)/        Public site: home, catalog, collections, product, about, wholesale, contact
    admin/           Admin: login + (dashboard) group (products, inquiries, subscribers)
    api/             inquiries, upload (signed Cloudinary), revalidate
    sitemap.ts, robots.ts
  components/        ui/ catalog/ collections/ product/ lead/ layout/ admin/
  lib/               supabase clients, queries, price, whatsapp, source-tracking, analytics, cloudinary, validation
supabase/migrations/ 001_schema, 002_seed_categories, 003_seed_sample_data
docs/                setup, deployment, admin-guide, content-guide
```

## Key architectural notes

- **Sold-out lives on variants**, not products — a published product with all
  variants sold out stays indexed for SEO.
- **Service-role key is server-only** — used in `lib/supabase/server.ts` after
  session verification, never exposed to the browser.
- **Admin routes** are guarded by `middleware.ts` (edge) and re-checked in the
  dashboard layout (defence in depth).
- **Lead source attribution** is a 30-day first-touch cookie (`?ref=instagram`).
- **Price logic** lives in one place: `lib/price.ts`.
