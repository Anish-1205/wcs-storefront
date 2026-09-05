# Deployment Guide

Stack: **Vercel** (hosting) + **Supabase** (database/auth) + **Cloudinary**
(images) + **Resend** (email).

## 1. Create the production Supabase project

1. Create a project at <https://supabase.com>.
2. In the SQL Editor, run the migration files in order:
   - `supabase/migrations/001_schema.sql`
   - `supabase/migrations/002_seed_categories.sql`
   - **Skip** `003_seed_sample_data.sql` in production (it's demo data).
   - Run `004` through `011` in filename order (this includes the product
     media import pipeline — `009_import_pipeline.sql`,
     `010_fix_import_classification_and_rls.sql` — and the customer enquiry
     carts, `011_customer_carts.sql`). Applying a new migration to an
     already-deployed project is exactly this step, repeated: paste the new
     file into the SQL Editor and run it, in order, after every `git pull`
     that adds one.
3. Create the admin user: Authentication → Users → Add user (email + password).
4. Customer accounts (storefront sign in / sign up, so carts follow a customer
   across devices — see [storefront-catalogue.md](storefront-catalogue.md#5b-customer-accounts--server-carts)):
   - Authentication → Providers → **Email**: enable **Sign Ups**. Decide whether
     to require **Confirm email** (the app handles both). Customers are ordinary
     auth users and get no admin access — that stays gated by `ADMIN_EMAILS`.
   - Authentication → Providers → **Google** (optional): enable and paste a
     Google Cloud OAuth client's ID/secret. In Google Cloud the authorised
     redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`.
     Then set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` in Vercel so the button
     appears. Leave it unset to run email/password only.
   - Authentication → URL Configuration: **Site URL** = the production URL;
     **Redirect URLs** = `https://<domain>/auth/callback` plus
     `http://localhost:3000/**` for local dev.
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
   | `ADMIN_EMAILS` | comma-separated admin email allowlist |
   | `UPSTASH_REDIS_REST_URL` | server-only rate limiting |
   | `UPSTASH_REDIS_REST_TOKEN` | server-only rate limiting |
   | `WHATSAPP_APP_SECRET` | required when admin image ingestion is enabled |
   | `WHATSAPP_ADMIN_NUMBERS` | comma-separated phone allowlist for ingestion |

4. Run `npm run check:env` locally or in CI before deploying.
5. Deploy. Vercel builds and serves on a global CDN with automatic SSL.

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
- [ ] Test at 320, 360, 390 and 430px widths with no horizontal overflow.
- [ ] Verify unsigned WhatsApp webhook requests return 401 and non-admin senders are ignored.
- [ ] Confirm anonymous Supabase clients cannot insert leads or read draft-product assets.
- [ ] Validate a product page at <https://validator.schema.org>.

## Caching / revalidation

Public pages use ISR (`revalidate`). When the admin saves a product, the save
action calls `revalidatePath` so changes appear within seconds. To force a full
refresh, redeploy from Vercel.

## Changing the WhatsApp number

Update `NEXT_PUBLIC_WHATSAPP_NUMBER` in Vercel env vars and redeploy.
