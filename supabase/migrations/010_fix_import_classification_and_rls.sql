-- ============================================================
-- 010_fix_import_classification_and_rls.sql
-- Production-readiness fixes found during verification of 009:
--
-- 1. import_collection_classifications' "confirmed requires a collection"
--    check was too strict: it also rejected the one legitimate case where
--    an admin explicitly confirms a group has NO collection
--    (confirmGroupCollection with collection_id = null, state = 'confirmed',
--    decided_by = 'admin') — that write violated the constraint outright.
--    This narrows the exception to exactly that case; the AI/system path
--    can still never leave 'confirmed' or 'suggested' with a null
--    collection_id.
--
-- 2. The six import-pipeline tables added in 009 are only ever read/written
--    through the service-role client (verified across the codebase) — the
--    permissive "authenticated" policies added no functional access and
--    only widened the blast radius of a leaked admin session against
--    tables that directly control the collection-safety and review-state
--    invariants. Same reasoning 008_harden_public_policies.sql already
--    applied to admin_upload_sessions. RLS stays enabled with no policies
--    (deny-all for anon/authenticated); the service-role client is
--    unaffected since it bypasses RLS entirely.
-- ============================================================

alter table import_collection_classifications drop constraint if exists import_classification_confirmed_requires_collection;
alter table import_collection_classifications add constraint import_classification_confirmed_requires_collection check (
  state = 'unresolved'
  or collection_id is not null
  or (state = 'confirmed' and decided_by = 'admin')
);

drop policy if exists "admin full import_batches" on import_batches;
drop policy if exists "admin full import_product_groups" on import_product_groups;
drop policy if exists "admin full import_assets" on import_assets;
drop policy if exists "admin full collection_aliases" on collection_aliases;
drop policy if exists "admin full import_collection_classifications" on import_collection_classifications;
drop policy if exists "admin full import_processing_jobs" on import_processing_jobs;
