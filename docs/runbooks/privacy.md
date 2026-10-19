# Personal data: inventory, flows, retention (T3.12)

What personal data this site holds, where it goes, who can read it, and how
to delete one person's data. This is an engineering inventory, **not legal
advice**: the privacy policy text and any legal basis (for example under
India's DPDP Act) are the owner's to settle.

## What is stored

| Where | Personal data | Who can read it | Kept |
| --- | --- | --- | --- |
| `inquiries` | name, phone, e-mail (optional), message, product, source | service role only (admin) | indefinitely, **owner to decide** |
| `contacts` (CRM) | name, phone, city, notes, rating | admin | indefinitely, owner to decide |
| `whatsapp_subscribers` | name, phone, source | admin | until removed |
| `profiles` | a signed-in customer's saved contact details | that customer (RLS) + admin | until account deleted |
| `carts` | a signed-in customer's enquiry cart | that customer (RLS) + admin | until account deleted |
| `auth.users` (Supabase Auth) | customer e-mail, Google identity | Supabase / admin dashboard | until account deleted |
| `whatsapp_inbox`, `whatsapp_batches`, `whatsapp_notices`, `whatsapp_ingest_events` | the admin's own WhatsApp number, contact name, captions | service role only | no pruning today, **proposal: 90 days** |
| `product_source_texts` | the raw WhatsApp text of a listing (may hold a phone number) | service role only | with the product |
| `admin_audit_log` | the admin's auth user id, request id (no e-mail, no customer data) | service role only | 12 months (`admin_audit_prune`) |
| Browser `localStorage` | enquiry cart, enquiry-form draft (name/phone the customer typed) | that browser only | until cleared / sent |

Product photos (Cloudinary, `public/media`) are of sarees, not people. If a
photo shows a person, it is the owner's to judge.

## Where it flows

| Service | What it receives | Safeguard |
| --- | --- | --- |
| Resend (e-mail) | the enquiry (name, phone, message) to the owner's inbox | sent only to `INQUIRY_NOTIFICATION_EMAIL` |
| WhatsApp (`wa.me`) | the enquiry text the customer chooses to send | sent by the customer's own app |
| Sentry | errors | `sendDefaultPii` off; `beforeSend` redacts personal keys and patterns in event context, drops request bodies and cookies (`src/lib/sentry-options.ts`); replays mask all text and run on 20 % of errored sessions |
| Vercel logs | server log lines | structured logger redacts by key and pattern (`src/lib/logger.ts`); phone numbers in WhatsApp logs are masked to the last 4 digits |
| GA4 / Pinterest | page and product events | only allowlisted parameter names reach `gtag`/`pintrk` (`ALLOWED_EVENT_PARAMS` in `src/lib/analytics.ts`); never name, phone, e-mail or message |
| Microsoft Clarity | session recordings | **owner: confirm "Strict" masking in the Clarity dashboard** so typed text is never recorded |
| Upstash (rate limiting) | client IP; for admin sign-in, a SHA-256 of the e-mail | counters expire with the window |
| Anthropic (AI) | product photos and the admin's listing text | the admin's text travels as a JSON value; no customer data is sent |
| Backups (`wcs-backup-ops`, private, age-encrypted) | `public` schema including `inquiries` and `contacts`; **excluding** `carts` and `profiles` row data and all of `auth` | readable only with the offline age key; 14 daily + 8 weekly copies |

Consent for analytics is T4.2 (not built yet).

## Deleting one person's data

On a request, by phone number (normalise to digits with country code, e.g.
`919876543210`). Run in the Supabase SQL Editor; check the counts in the
`select` first.

```sql
-- 1. What exists
select 'inquiries' t, count(*) from inquiries where regexp_replace(phone,'\D','','g') = '919876543210'
union all select 'contacts', count(*) from contacts where regexp_replace(phone,'\D','','g') = '919876543210'
union all select 'subscribers', count(*) from whatsapp_subscribers where regexp_replace(phone,'\D','','g') = '919876543210';

-- 2. Delete
begin;
delete from inquiries where regexp_replace(phone,'\D','','g') = '919876543210';
delete from contacts where regexp_replace(phone,'\D','','g') = '919876543210';
delete from whatsapp_subscribers where regexp_replace(phone,'\D','','g') = '919876543210';
commit;
```

A signed-in customer: delete the user in Supabase → Authentication → Users.
Their `carts` and `profiles` rows go with it (`on delete cascade`).

Backups: rows in existing encrypted backups age out with the backup retention
(at most 56 days). Do not edit backups. Record the request and the date, so
a restore inside that window is followed by repeating the deletion.

Also check the owner's e-mail inbox (Resend notifications) and WhatsApp chat,
which hold the same enquiry outside this system.

## Owner decisions still open

- Retention for `inquiries` and `contacts` (suggestion: review yearly, delete
  leads untouched for 2 years).
- WhatsApp ingestion tables: prune after 90 days? (A small scheduled SQL job;
  not built until decided.)
- Clarity masking mode (dashboard).
- Privacy-policy wording (legal review).
