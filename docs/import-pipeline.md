# Product Media Ingestion Pipeline

Technical reference for the bulk import flow at `/admin/import`. This is for
engineers working on the code — see [admin-guide.md](admin-guide.md) if you
just need to use it.

## Why this exists

Adding products one at a time through the Product form doesn't scale when a
weaver or supplier hands over a phone full of photos. This pipeline lets an
admin dump many photos/videos in from desktop or mobile, groups them into
proposed products, optionally drafts metadata with AI, and — critically —
never publishes anything or assigns a collection without an explicit human
decision. Everything it produces is a normal `draft` product that flows
through the existing `ProductForm` / `saveProduct` path unchanged.

## Production-readiness fixes (`010_fix_import_classification_and_rls.sql`)

A verification pass after the initial build found and fixed three real bugs
before this ever ran against a real database:

- The `import_collection_classifications` "confirmed requires a collection"
  check rejected the one legitimate case where an admin explicitly confirms
  a group has **no** collection (`confirmGroupCollection` with
  `collection_id: null`) — that write would have failed outright. The
  constraint now also permits `state='confirmed' AND decided_by='admin'`;
  the AI/system path still can never leave `confirmed`/`suggested` with a
  null collection.
- `/api/import/complete` didn't re-check the batch's existence/`open`
  status the way `/api/import/sign` does, so the per-batch file-count
  ceiling and the "batch closed" rule could be bypassed by calling it
  directly. Fixed to mirror `/sign`'s checks.
- `createProductFromGroup`'s "idempotent" re-run against a group whose
  product had already been reviewed/published would silently revert it to
  `draft`/`pending_review` and delete its variants. It now refuses to
  proceed once the product is no longer `draft` or its review is
  `approved`.
- RLS on the six tables below was tightened to drop the permissive
  `authenticated` policies 009 shipped with, since every access path uses
  the service-role client exclusively (same reasoning as
  `008_harden_public_policies.sql` for `admin_upload_sessions`).

## Data model (`009_import_pipeline.sql`, corrected by `010`)

- **`import_batches`** — one upload session. `status` gates whether
  `/api/import/sign` still accepts new files (`open` only).
- **`import_assets`** — one row per uploaded file. `client_upload_id` (a
  client-generated UUID) is the idempotency key: retrying a signature request
  or a completion call with the same id updates the same row. Cloudinary's
  `public_id` is always `imports/<batch_id>/<client_upload_id>`, so a
  retried *upload* also just overwrites the same Cloudinary asset.
- **`import_product_groups`** — a proposed product: a set of assets plus
  `admin_description` (higher authority than anything AI produces),
  `ai_metadata` (draft-only, never fact), and `grouping_method` recording
  which heuristic produced it.
- **`import_collection_classifications`** — one row per group, deliberately
  separate from `ai_metadata`. `state` is `confirmed` / `suggested` /
  `unresolved`; only `confirmed` may back a product (see below).
- **`collection_aliases`** — admin-maintained exact-match aliases (e.g.
  "gadwal" → the Gadwal collection) used as a deterministic classification
  source. Only ever points at an existing collection.
- **`import_processing_jobs`** — durable, idempotent (`unique(group_id,
  job_type)`) record of each AI attempt. There is no background queue in
  this app — AI runs synchronously, either automatically right after
  grouping (`autoGroupBatchAssets`) or on demand via "Get AI suggestions" /
  "Classify all with AI" — but every attempt is recorded so retries are
  safe and visible.
- **`products.import_group_id` / `products.review_status`** — additive
  columns. Existing products default to `review_status = 'not_required'`,
  so legacy publish behaviour is completely unchanged. Imported products
  start at `pending_review`; publishing (via `saveProduct` or
  `updateProductStatus`) is blocked server-side until an admin calls
  `approveImportedProductReview`.

RLS is enabled on every new table with **no policies** (010 dropped the
permissive `authenticated` ones 009 shipped with) — deny-all for anon and
authenticated roles, same as `admin_upload_sessions` after
`008_harden_public_policies.sql`. This is safe because every read/write goes
through the service-role client (`createAdminClient()`), which bypasses RLS
entirely and is only ever reached after `requireAdmin`/`assertAdmin`'s
`ADMIN_EMAILS` allowlist check — RLS here is just refusing to add
unnecessary blast radius on top of that, not doing the gatekeeping itself.

## Collection assignment is fail-closed

`src/lib/import/collection-classification.ts` tries, in order:

1. `known_batch_manifest` — the whole batch was pinned to one collection.
2. `trusted_manifest` — an admin-authored folder/filename → collection map
   on the batch.
3. `existing_mapping` — a `collection_aliases` hit.
4. AI (`classifyCollection`), **only** if nothing above matched.

Only 1–3 (and an explicit admin pick) can reach `confirmed`. An AI candidate
becomes `suggested` (still needs `confirmGroupCollection` before a product
can be created) only if it clears **both**
`SUGGESTED_CONFIDENCE_THRESHOLD` (0.72) **and** a margin of
`SUGGESTED_MARGIN_THRESHOLD` (0.15) over the runner-up — a lone high score is
never enough. Anything weaker, absent, or pointing at a collection outside
the offered list becomes `unresolved`. `createProductFromGroup` refuses to
run unless the classification is `confirmed`.

## AI provider

`src/lib/ai/` is a small provider interface (`suggestProductMetadata`,
`classifyCollection`, `suggestColorVariants`) shared by two callers: this
import pipeline, and the WhatsApp product-ingestion flow
(`src/lib/whatsapp-enrichment.ts`, see `docs/admin-guide.md`'s "Adding a
saree via WhatsApp" section) — which reuses the exact same confidence bar
(`SUGGESTED_CONFIDENCE_THRESHOLD`) and never-fabricate-facts guardrails to
auto-fill category/highlights/fabric/collections and split colour variants,
just applied directly instead of landing as an admin-confirmable draft (a
deliberate, narrower exception — see the doc comment on
`enrichWhatsAppProduct`). Two implementations:

- `null-provider.ts` — always returns nothing. This is what runs whenever no
  vendor key is configured, which is the case in local/dev environments by
  default. The whole pipeline is designed to be fully usable this way.
- `anthropic-provider.ts` — a plain `fetch()` call to the Claude Messages
  API (no SDK dependency), gated by `ANTHROPIC_API_KEY` (model overridable
  via `ANTHROPIC_IMPORT_MODEL`, default `claude-haiku-4-5-20251001`). Its
  response schemas (`metadataResponseSchema` /
  `classificationResponseSchema`) have no fields for authenticity, stock, or
  supplier — zod strips anything else, so those claims are structurally
  impossible to surface, not just discouraged by prompt. `fabric_type`,
  `product_code` and `base_price_min`/`base_price_max` *do* have schema
  fields (the admin routinely pastes these into the description), but the
  provider deletes them from the parsed result unless an `adminDescription`
  or a `trustedFacts` entry was supplied to source them from — they can
  never be inferred from the photos alone.

  Pasting/editing a group's description in the review UI re-runs
  `suggestProductMetadata` on blur, so the extracted name / fabric / code /
  price / highlights refresh from the new text. `createProductFromGroup`
  then uses the AI-distilled short name (never the pasted paragraph, which
  becomes the product description) and maps the four fields onto the draft
  product.

**Not exercised against the live API in local dev/CI** — no
`ANTHROPIC_API_KEY` is set in this repo checkout, so `getAiProvider()` always
returns the null provider here. Production has the key configured, so both
callers (this pipeline and the WhatsApp flow) do run against the real API
there. The Anthropic implementation is covered by
unit tests against a mocked `fetch` (`src/__tests__/ai-provider.test.ts`),
not a real call. Wire a real key and try an import before trusting AI
suggestions in production.

## Naming & tagging style guide (`src/lib/ai/style-guide.ts`)

One module is the single source of truth for how every product reads, and it
is used twice — as prompt text, and as deterministic post-processing:

1. **Prompt text.** `NAMING_STYLE_GUIDE`, `HIGHLIGHTS_STYLE_GUIDE`,
   `COLOUR_STYLE_GUIDE` and `CATALOGUE_STYLE_PREAMBLE` are injected into the
   metadata, classification and colour-variant prompts, with good/bad examples
   and the reasons the bad ones are bad.
2. **Code enforcement.** `enforceNameStyle`, `composeProductName`,
   `resolveProductName` and `normalizeHighlights` are applied to whatever comes
   back. This is the part that actually guarantees consistency: the prompt is
   guidance, the code is the contract. A product created in a batch where the
   model drifted — or where AI wasn't configured at all — still reads like the
   rest of the catalogue.

The convention is `[Colour] [Fabric/Weave] Saree with [Key Detail]`: 3–8 words,
≤ 70 characters, Title Case with lowercase minor words, exactly one singular
"Saree", at most one `with` clause, and no marketing/urgency words, prices,
numbers, emoji, hashtags or trailing punctuation. Fabric/weave/region words may
appear **only** when the description or trusted facts state them — the
no-fabrication rule applies to names exactly as it does to `fabric_type`.
`enforceNameStyle` returns `null` rather than emit junk, and every caller then
falls back: AI name → name composed from known parts → styled description →
(WhatsApp only) the deterministic `deriveProductName`. Nothing in this module
invents a claim; it only deletes, reorders and re-cases words that were already
in the model's suggestion or the admin's own text.

### Taxonomy as context, not invention

`suggestProductMetadata` now takes `existingCategories` (the real category
list, as a closed list) and `existingCollectionNames` (for tag vocabulary
only — collection *assignment* still happens solely through
`classifyCollection`). The prompt requires `category_slug` to be copied from
that list, and the provider then **re-filters it defensively**: a slug that
wasn't offered is dropped, exactly as a hallucinated `collection_id` is. With
no list supplied, `category_slug` is dropped entirely. Both callers feed the
live taxonomy in (`import-actions.ts`, `whatsapp-enrichment.ts`).

## Re-processing existing products

Products created before the style guide existed can be brought up to standard
without re-importing anything: **/admin/products → "Re-run AI naming &
tagging"** (`src/app/admin/enrichment-actions.ts`,
`src/lib/enrichment/reprocess.ts`).

- Two steps: `previewProductEnrichment` runs the AI and writes nothing;
  `applyProductEnrichment` writes only what the admin ticked. The apply step
  re-validates everything server-side (zod, plus a live check of every category
  and collection id) and re-runs the style rules — it never trusts the values
  the browser sent back.
- **Media is never touched.** Only `name`, `fabric_type`, `highlights`,
  `category_id` and *additional* `collection_products` rows are written. Images,
  variants, prices, status — and the slug, so live product URLs keep working —
  are out of scope.
- Gaps get filled, curated values are kept: fabric/category/highlights are only
  proposed when the product has none (opt-in checkboxes override that),
  collections are only ever added, and a name that already follows the
  convention is left alone. A second run over the same catalogue is a no-op.
- Batched at `MAX_ENRICHMENT_BATCH` (12) products per run, three AI calls in
  flight at a time, since each product costs two provider calls.
- With no `ANTHROPIC_API_KEY` the flow still works as a deterministic
  name-tidy — that alone fixes the verbatim-WhatsApp-description names — and
  says so in the UI.

## Grouping heuristics (`src/lib/import/grouping.ts`)

Priority order: explicit "start next product" boundary → folder (directory
picker) → filename identifier prefix → upload-order/timestamp proximity.
**Visual similarity and AI-based grouping are not implemented** — there is
no perceptual-hash or embedding model wired up. When nothing earlier in the
list produces a confident split, a timestamp-proximity group larger than 8
assets is flagged `flagged_for_review` instead of being treated as one
product, per the "never silently merge ambiguous assets" requirement.

## Colour-variant detection (`src/lib/import/color-variants.ts`)

A group's photos often show the same saree in several body colours. Rather
than dumping every photo onto one flat "Default" variant (the original
behaviour, still what happens when nothing below is used), an admin can ask
AI to cluster a group's photos by colourway and pick the best-looking one as
the default:

1. **"Detect color variants"** (`requestGroupColorVariantSuggestions`) sends
   the group's photos to `AiProvider.suggestColorVariants` (vision call, same
   plumbing as `suggestProductMetadata`/`classifyCollection`) and stores the
   raw result as a **draft** in `import_product_groups.ai_color_variants` —
   nothing about real assets or products changes yet, same fail-closed
   pattern as `ai_metadata`.
2. **"Apply suggested variants"** (`applyGroupColorVariants`) is the explicit
   admin confirmation step. It re-resolves the stored suggestion against the
   group's *current* assets (`resolveColorVariantAssignment` — a suggestion
   can be stale if an asset moved/was deleted since it was generated; ids the
   suggestion no longer covers are just left unassigned, never guessed), then
   writes `import_assets.variant_group` and `import_product_groups
   .best_variant_group` (the colourway to show first). Applying is a no-op
   unless at least two distinct colour groups survive re-resolution.
3. `createProductFromGroup` checks whether any of the group's images have a
   `variant_group` set. If none do, it creates the single "Default" variant
   exactly as before. If some do, it creates one `product_variants` row per
   distinct `variant_group`, `best_variant_group` first, and any image the
   suggestion didn't cover joins whichever variant ends up first rather than
   being silently dropped from the product.
4. **"Undo"** (`clearGroupColorVariants`) resets every asset's
   `variant_group` back to null, reverting to the single-variant behaviour.

Same guardrails as collection classification: the AI response is defensively
re-filtered against the asset ids actually offered (`anthropic-provider.ts`),
and at most one colourway can ever be marked the best/default pick — a model
that (against its instructions) marks several is trimmed to the first.

## Less-manual review workflow

`autoGroupBatchAssets` best-effort fires `requestGroupAiSuggestions` +
`requestGroupCollectionClassification` for every group it just created
(`src/lib/import/ai-pipeline.ts` holds the pure "which groups still need
this" selector, kept out of `import-actions.ts` because Next.js requires
every export of a `"use server"` file to be async). A failure for one group
never blocks grouping itself or any other group — each call already
degrades to `unresolved`/no-suggestion on its own. "Classify all with AI" on
the batch page re-runs the same pipeline for any group that still lacks
either result (e.g. groups created before this existed, or a prior AI call
that failed). None of this changes what can reach `confirmed` — it only
removes the need to click "Get suggestions" / "Check collection" per card.

Admins can also create a new collection inline from the import page (a
name-only quick form wired to the existing `saveCollection` action) instead
of leaving to `/admin/collections` first — it does not change how
classification works; a newly created collection just becomes selectable
like any other existing one.

## Deleting import state

Three admin actions in `import-actions.ts` cover cleanup that has no other
path once inside an import batch:

- `deleteImportGroup` — only for a group with no product yet
  (`product_id is null`); its assets are unlinked (`group_id` set null by
  the FK), not destroyed, so they reappear in "Ungrouped" rather than being
  silently lost.
- `deleteImportAsset` — permanently removes one `import_assets` row (e.g. a
  flagged duplicate). Only the database row is removed; the underlying
  Cloudinary asset is left in place, same as product image deletion
  elsewhere in this app.
- `deleteImportedDraftProduct` — deletes a product created from a group and
  resets the group's `status` back to `draft`, but only while the product is
  still `status = 'draft'`. Once it's left draft (reviewed/published), this
  refuses and points at the normal product-delete flow instead, which asks
  for that confirmation deliberately.

## Video thumbnails

Both the pre-upload queue (`ImportUploader`) and already-uploaded video
assets (`ImportGroupCard`, the "Ungrouped" grid) now show a real frame
instead of a plain "video" label: the queue uses a muted, inline `<video>`
pointed at the local `blob:` URL (first frame renders without playback);
uploaded assets use `cldVideoThumbnail()` in `src/lib/cloudinary.ts`, which
asks Cloudinary for the same video's first frame as a `.jpg` via the
`so_0` transform.

## Known gap: video products

The existing product schema (`product_variants` → `variant_images`) has no
concept of video media — only `variant_images`. The import pipeline accepts
and stores video assets (`import_assets.kind = 'video'`), and they stay
visible/groupable/reviewable in the batch, but `createProductFromGroup` only
attaches image-kind assets to the created product's variant; video assets
are not silently dropped from the batch, but they are not attached to
anything a customer can see. Extending the catalog itself to render video
would be a separate, larger change (public product pages, `cld()`
transforms, etc.) and was out of scope here.

## Testing

- `import-grouping.test.ts` — heuristic priority order, ambiguous-group
  flagging, the filename-identifier "don't fabricate structure" guard.
- `import-color-variants.test.ts` — `resolveColorVariantAssignment`'s
  stale-suggestion handling (dropped/moved assets), the "never split one
  asset across two colour groups" guard, and the "only the first
  is_best_display wins" guard.
- `collection-classification.test.ts` — every deterministic source, the
  confidence+margin bar, AI failure/empty/out-of-list handling.
- `collection-classification-eval.test.ts` +
  `fixtures/collection-classification-eval.json` — a small eval fixture
  built from the collections actually seeded in
  `003_seed_sample_data.sql`.
- `ai-provider.test.ts` — null provider, provider selection, and the
  Anthropic provider's degrade-gracefully/never-fabricate behaviour against
  a mocked `fetch`, including the closed-list `category_slug` filter and the
  style enforcement applied to a drifting name/highlights.
- `naming-style.test.ts` — the naming convention as executable spec
  (`enforceNameStyle`, `composeProductName`, `resolveProductName`,
  `normalizeHighlights`, `deriveProductName`) and the re-processing decision
  rules (`buildEnrichmentProposal`): gap-filling, never overwriting curated
  values, add-only collections, second-run-is-a-no-op, and the guard that a
  proposal can only ever carry name/fabric/highlights/category/collections.
- `import-upload-sign.test.ts` / `import-asset-complete.test.ts` — auth,
  mime/size/batch-size limits, idempotent completion, etag-based duplicate
  flagging.
- `import-review-gate.test.ts` — `saveProduct`/`updateProductStatus` refuse
  to publish a `pending_review` product and are unaffected for legacy
  (`not_required`) ones.
- `import-delete-actions.test.ts` — the delete-group/delete-asset/
  delete-draft-product guards above, and `selectPendingGroupIds`'s
  needs-AI-pipeline logic.

## Not run in this environment

- The migration was not applied against a real Postgres instance here —
  Docker Desktop's engine wasn't reachable, so `supabase start` /
  `supabase db reset` couldn't run. Run those locally before deploying and
  regenerate `src/lib/supabase/types.ts` via `supabase gen types` (it was
  hand-edited to match the migration in the meantime).
- No new Playwright e2e spec was added for the upload/review UI — a
  meaningful one would need either a live Cloudinary account or faked
  network calls standing in for the exact behaviour under test, which would
  misrepresent real coverage more than it would add confidence.
