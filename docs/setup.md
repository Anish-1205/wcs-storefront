# Local Development Setup

This guide gets the saree website running on your machine.

## Prerequisites

- **Node.js 18.17+** (Node 20 LTS recommended) — <https://nodejs.org>
- **Supabase CLI** — <https://supabase.com/docs/guides/cli> (`npm i -g supabase` or `scoop install supabase`)
- **Docker Desktop** — required by the Supabase CLI for the local stack
- A **Cloudinary** account (free tier) — for image uploads
- A **Resend** account (free tier) — for inquiry email notifications (optional in dev)

## 1. Install dependencies

```bash
npm install
```

## 2. Start the local Supabase stack

```bash
supabase start
```

This prints local credentials. Copy:

- `API URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role key` → `SUPABASE_SERVICE_ROLE_KEY`

Apply the migrations (schema, categories, sample data):

```bash
supabase db reset
```

`supabase db reset` runs every file in `supabase/migrations/` in order:

1. `001_schema.sql` — tables, indexes, triggers, RLS
2. `002_seed_categories.sql` — the 10 fixed categories
3. `003_seed_sample_data.sql` — sample products/collections (delete this file before a production reset if you don't want demo data)

## 3. Create the admin user

The site uses a single Supabase Auth email/password account. Signups are
disabled, so create the admin via the local Studio or CLI:

```bash
supabase auth admin create-user --email you@example.com --password "a-strong-password"
```

(Or use Studio at <http://localhost:54323> → Authentication → Add user.)

## 4. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in:

- The three Supabase values from step 2
- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (Cloudinary dashboard → Settings → API Keys)
- `NEXT_PUBLIC_WHATSAPP_NUMBER` — your business WhatsApp number, country code first, no `+` or spaces (e.g. `919876543210`)
- `NEXT_PUBLIC_BUSINESS_NAME` — your shop name
- `NEXT_PUBLIC_SITE_URL` — `http://localhost:3000` in dev
- (Optional) `RESEND_API_KEY` + `INQUIRY_NOTIFICATION_EMAIL` to receive inquiry emails
- (Optional) `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_CLARITY_PROJECT_ID`, `NEXT_PUBLIC_PINTEREST_TAG_ID`

## 5. Run the dev server

```bash
npm run dev
```

- Public site: <http://localhost:3000>
- Admin: <http://localhost:3000/admin> (redirects to login)

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run types` | TypeScript type-check (no emit) |
| `supabase db reset` | Re-apply all migrations + seed |
| `supabase gen types typescript --local > src/lib/supabase/types.ts` | Regenerate DB types |

## Troubleshooting

- **Admin redirect loop** — make sure the admin user exists and the three
  Supabase keys in `.env.local` match the running local stack.
- **Images don't upload** — confirm the three Cloudinary vars are set and the
  server was restarted after editing `.env.local`.
- **Empty catalog** — run `supabase db reset` to load sample data, or add
  products in the admin and set their status to `published`.
