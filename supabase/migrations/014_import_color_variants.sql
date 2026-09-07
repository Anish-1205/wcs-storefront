-- AI-assisted color-variant detection for the import pipeline. Mirrors the
-- ai_metadata pattern on import_product_groups (009_import_pipeline.sql):
-- the AI call only ever writes a draft suggestion here; nothing is applied
-- to real assets/products until an admin clicks "Apply suggested variants"
-- (applyGroupColorVariants), which is what actually sets import_assets
-- .variant_group. createProductFromGroup then splits the group into one
-- product_variants row per distinct variant_group instead of a single
-- "Default" variant, with best_variant_group's assets shown first.
alter table import_product_groups
  add column if not exists ai_color_variants jsonb,
  add column if not exists ai_color_variants_generated_at timestamptz,
  add column if not exists best_variant_group text;

alter table import_assets
  add column if not exists variant_group text;

alter table import_processing_jobs
  drop constraint if exists import_processing_jobs_job_type_check;
alter table import_processing_jobs
  add constraint import_processing_jobs_job_type_check
    check (job_type in ('ai_group_metadata', 'ai_collection_classification', 'ai_color_variants'));
