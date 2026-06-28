# Deployment Guide

Stack: **Vercel** (hosting) + **Supabase** (database/auth) + **Cloudinary**
(images) + **Resend** (email).

## 1. Create the production Supabase project

1. Create a project at <https://supabase.com>.
2. In the SQL Editor, run the migration files in order:
   - `supabase/migrations/001_schema.sql`
   - `supabase/migrations/002_seed_categories.sql`
   - **Skip** `003_seed_sample_data.sql` in production (it's demo data).
3. Create the admin user: Authentication → Users → Add user (email + password).
   Keep **Email signups disabled** under Authentication → Providers.
4. (Recommended) Settings → Database → enable **Point-in-Time Recovery** and use
   the **pooled** connection string (pgBouncer) for serverless.
5. Copy from Settings → API:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)

## 2. Cloudinary

- Create a free account, note the **Cloud name**, **API Key**, **API Secret**.
- Uploads are **signed** server-side, so no unsigned preset is needed.

## 3. Resend (optional but recommended)

- Create an account, verify your sending domain (or use the test
  `onboarding@resend.dev` to start), and create an API key.

## 4. Deploy to Vercel

1. Push this repo to GitHub.
2. Import it at <https://vercel.com/new>. Framework preset auto-detects Next.js.
3. Add **Environment Variables** (Production + Preview) — mirror `.env.example`:

   | Variable | Notes |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | from Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | **server-only**, never `NEXT_PUBLIC_` |
   | `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | from Cloudinary |
   | `CLOUDINARY_API_KEY` | server-only |
   | `CLOUDINARY_API_SECRET` | server-only |
   | `NEXT_PUBLIC_WHATSAPP_NUMBER` | e.g. `919876543210` |
   | `NEXT_PUBLIC_BUSINESS_NAME` | your shop name |
   | `NEXT_PUBLIC_SITE_URL` | `https://yourdomain.com` |
   | `RESEND_API_KEY` | optional |
   | `INQUIRY_NOTIFICATION_EMAIL` | where inquiry emails go |
   | `RESEND_FROM_EMAIL` | verified sender |
   | `NEXT_PUBLIC_GA_MEASUREMENT_ID` | optional |
   | `NEXT_PUBLIC_CLARITY_PROJECT_ID` | optional |
   | `NEXT_PUBLIC_PINTEREST_TAG_ID` | optional |

4. Deploy. Vercel builds and serves on a global CDN with automatic SSL.

## 5. Custom domain

- Vercel → Project → Settings → Domains → add your domain and follow the DNS
  instructions. SSL is provisioned automatically.
- Update `NEXT_PUBLIC_SITE_URL` to the live domain and redeploy so sitemap,
  canonical URLs, and Pinterest share links are correct.

## 6. Post-deploy checklist

- [ ] `/admin/login` works and you can sign in.
- [ ] Add a product, set it `published`, confirm it appears on `/catalog`.
- [ ] Submit a test inquiry → row appears in admin + email arrives (if Resend set).
- [ ] Subscribe via the footer form → row appears in admin Subscribers.
- [ ] `/sitemap.xml` and `/robots.txt` resolve.
- [ ] Run Lighthouse (target: Performance 90+, SEO 100, Accessibility 90+).
- [ ] Validate a product page at <https://validator.schema.org>.

## Caching / revalidation

Public pages use ISR (`revalidate`). When the admin saves a product, the save
action calls `revalidatePath` so changes appear within seconds. To force a full
refresh, redeploy from Vercel.

## Changing the WhatsApp number

Update `NEXT_PUBLIC_WHATSAPP_NUMBER` in Vercel env vars and redeploy.
