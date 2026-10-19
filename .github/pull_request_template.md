<!-- What does this change and why? -->

## Summary

## Changes

-

## Verification

- [ ] `npm run lint`
- [ ] `npm run types`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e` (if touching storefront/admin flows, webhooks, or RLS)

## Database migration

<!-- Delete this section if supabase/migrations/ is untouched.
     Process: docs/runbooks/migration-safety.md -->

- [ ] Additive only (no drop/rename/type change/set not null), or a separately approved contract step
- [ ] Tested on an isolated database: <!-- npm run test:ingest / supabase db reset; name the test -->
- [ ] The previous app version still works on the migrated schema
- [ ] Check query: <!-- what to run right after applying -->
- [ ] `src/lib/supabase/types.ts` and `security-policies.test.ts` updated if affected
- [ ] Forward recovery: <!-- what to switch off / leave unused if it goes wrong -->
- [ ] Applied to production only after a backup < 24 h old: <!-- artifact name -->

## Notes

<!-- Migrations, env var changes, or follow-ups. New/changed validation,
     webhook signature, or RLS logic needs a matching test in src/__tests__/. -->
