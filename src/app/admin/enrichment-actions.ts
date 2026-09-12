"use server";

/**
 * Re-runs the improved AI naming/tagging over products that already exist —
 * the ones created through WhatsApp (or an early import batch) before the
 * catalogue style guide existed. Two steps on purpose:
 *
 *   previewProductEnrichment  → runs the AI, writes nothing, returns a diff
 *   applyProductEnrichment    → writes the diff the admin just approved
 *
 * The apply step never trusts what comes back from the browser: every value is
 * re-validated (zod) and re-checked against the real taxonomy before it is
 * written, exactly as if it had come from the AI in this request.
 *
 * **Images and media are never touched**, nor are variants, prices, status or
 * the slug — a re-processed product keeps its live URL and its photos. See
 * src/lib/enrichment/reprocess.ts for the fill-gaps-keep-curated rules.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { getAiProvider } from "@/lib/ai";
import {
  buildEnrichmentProposal,
  followsNamingConvention,
  type CurrentProductState,
  type EnrichmentProposal,
} from "@/lib/enrichment/reprocess";
import {
  isCanonicalProductCode,
  isCanonicalSlug,
  planIdentifiers,
  productCodeSequence,
  type IdentifierProposal,
} from "@/lib/enrichment/identifiers";
import {
  isSplitCandidate,
  planColorSplit,
  splittablePhotos,
  type ColorSplitPlan,
  type SplitCandidateImage,
  type SplitCandidateProduct,
} from "@/lib/enrichment/color-split";
import { enforceNameStyle, normalizeHighlights } from "@/lib/ai/style-guide";
import {
  enrichWhatsAppProduct,
  type CategoryOption,
  type CollectionOption,
} from "@/lib/whatsapp-enrichment";
import {
  colorSplitApplySchema,
  colorSplitPreviewSchema,
  enrichmentApplySchema,
  enrichmentPreviewSchema,
  identifierApplySchema,
  identifierPreviewSchema,
  MAX_COLOR_SPLIT_BATCH,
  MAX_ENRICHMENT_BATCH,
  type ColorSplitApplyShape,
} from "@/lib/validation";
import { toResult, type ActionResult } from "./actions";

type AdminClient = Awaited<ReturnType<typeof assertAdmin>>["admin"];

/** How many products' AI calls run at once — bounded so one run can't stall on
 * a dozen simultaneous provider requests. */
const AI_CONCURRENCY = 3;

/** Supabase returns embedded relations as arrays (or an object, depending on the
 * generated types), so every embed is read through `firstOf` below rather than
 * assumed to be one shape. */
type Embed<T> = T | T[] | null | undefined;

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  fabric_type: string | null;
  highlights: string[] | null;
  category_id: string | null;
  category: Embed<{ name: string }>;
  collection_products: Array<{ collection_id: string; collections: Embed<{ name: string }> }> | null;
  product_variants: Array<{
    variant_images: Array<{ image_url: string; is_primary: boolean; display_order: number }> | null;
  }> | null;
};

function firstOf<T>(embed: Embed<T>): T | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

const PRODUCT_SELECT =
  "id, name, description, fabric_type, highlights, category_id, category:categories(name), " +
  "collection_products(collection_id, collections(name)), " +
  "product_variants(variant_images(image_url, is_primary, display_order))";

/** Read-only: the product's own photos are passed to the AI as context and are
 * never modified, reordered or re-uploaded by this flow. */
function imageUrlsFor(product: ProductRow, limit = 4): string[] {
  return (product.product_variants ?? [])
    .flatMap((variant) => variant.variant_images ?? [])
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order)
    .map((img) => img.image_url)
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, limit);
}

function toCurrentState(product: ProductRow): CurrentProductState {
  const links = product.collection_products ?? [];
  return {
    id: product.id,
    name: product.name,
    fabric_type: product.fabric_type,
    highlights: product.highlights,
    category_id: product.category_id,
    category_name: firstOf(product.category)?.name ?? null,
    collection_ids: links.map((l) => l.collection_id),
    collection_names: links.map((l) => firstOf(l.collections)?.name ?? l.collection_id),
  };
}

async function loadTaxonomy(admin: AdminClient) {
  const [{ data: categories }, { data: collections }] = await Promise.all([
    admin.from("categories").select("id, slug, name, description").order("display_order"),
    admin.from("collections").select("id, name, description").eq("is_active", true),
  ]);
  return {
    categories: (categories ?? []) as CategoryOption[],
    collections: (collections ?? []) as CollectionOption[],
  };
}

/** Runs `worker` over `items` with a bounded number in flight at a time. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export interface EnrichmentCandidate {
  id: string;
  name: string;
  source: string;
  status: string;
  has_description: boolean;
  follows_convention: boolean;
  missing: string[];
}

/**
 * Lists products worth re-processing, worst first: the ones whose name doesn't
 * follow the convention, or that are missing a category/fabric/highlights.
 * Products with no description AND no image give the AI nothing to work from,
 * so they're excluded rather than offered as a guaranteed no-op.
 */
export async function listEnrichmentCandidates(): Promise<ActionResult<{ candidates: EnrichmentCandidate[] }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const { data, error } = await admin
      .from("products")
      .select(`${PRODUCT_SELECT}, source, status`)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const candidates: EnrichmentCandidate[] = [];
    for (const row of (data ?? []) as unknown as Array<ProductRow & { source: string; status: string }>) {
      const hasDescription = !!row.description?.trim();
      const images = imageUrlsFor(row, 1);
      if (!hasDescription && images.length === 0) continue;

      const follows = followsNamingConvention(row.name);
      const missing = [
        !row.category_id && "category",
        !row.fabric_type?.trim() && "fabric",
        normalizeHighlights(row.highlights).length === 0 && "highlights",
        (row.collection_products ?? []).length === 0 && "collections",
      ].filter((v): v is string => typeof v === "string");

      if (follows && missing.length === 0) continue;

      candidates.push({
        id: row.id,
        name: row.name,
        source: row.source,
        status: row.status,
        has_description: hasDescription,
        follows_convention: follows,
        missing,
      });
    }

    // Worst first: an off-convention name is the most visible problem.
    candidates.sort(
      (a, b) => Number(a.follows_convention) - Number(b.follows_convention) || b.missing.length - a.missing.length,
    );
    return { candidates };
  });
}

export async function previewProductEnrichment(input: {
  product_ids: string[];
  rename_all?: boolean;
  replace_highlights?: boolean;
}): Promise<ActionResult<{ proposals: EnrichmentProposal[]; ai_available: boolean }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = enrichmentPreviewSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(
        `Pick between 1 and ${MAX_ENRICHMENT_BATCH} products to re-process (each one costs a couple of AI calls, so they run in small batches).`,
      );
    }
    const { product_ids, rename_all, replace_highlights } = parsed.data;

    const aiProvider = getAiProvider();
    // The null provider reports "configured" but does nothing, so check by name.
    const aiAvailable = aiProvider.name !== "none" && aiProvider.isConfigured();

    const { data, error } = await admin.from("products").select(PRODUCT_SELECT).in("id", product_ids);
    if (error) throw new Error(error.message);
    const products = (data ?? []) as unknown as ProductRow[];
    if (products.length === 0) throw new Error("None of those products could be found.");

    const { categories, collections } = await loadTaxonomy(admin);

    const proposals = await mapWithConcurrency(products, AI_CONCURRENCY, async (product) => {
      const current = toCurrentState(product);
      const description = product.description?.trim() ?? "";

      // With no AI we can still bring a name up to the convention deterministically
      // — that alone fixes the verbatim-WhatsApp-description names.
      if (!aiAvailable) {
        return buildEnrichmentProposal(
          current,
          {
            name: enforceNameStyle(current.name),
            fabricType: null,
            highlights: [],
            categoryId: null,
            categoryName: null,
            collectionIds: [],
            collectionNames: [],
          },
          { renameAll: rename_all, replaceHighlights: replace_highlights },
        );
      }

      const fresh = await enrichWhatsAppProduct({
        aiProvider,
        description,
        // An existing fabric value is admin-owned ground truth, not a guess to redo.
        fabricFromCaption: current.fabric_type?.trim() || null,
        imageUrls: imageUrlsFor(product),
        categories,
        collections,
      });

      return buildEnrichmentProposal(
        current,
        {
          name: fresh.name,
          fabricType: fresh.fabricType,
          highlights: fresh.highlights,
          categoryId: fresh.categoryId,
          categoryName: fresh.categoryName,
          collectionIds: fresh.collectionIds,
          collectionNames: fresh.collectionNames,
        },
        { renameAll: rename_all, replaceHighlights: replace_highlights },
      );
    });

    return { proposals, ai_available: aiAvailable };
  });
}

/**
 * Writes an approved preview. Re-validates every value server-side: names and
 * highlights go back through the style rules, and category/collection ids are
 * checked against the live taxonomy — a stale or tampered id is dropped, never
 * written. Media, variants, prices, status and slug are never written here.
 */
export async function applyProductEnrichment(input: {
  proposals: Array<{
    product_id: string;
    name: string | null;
    fabric_type: string | null;
    highlights: string[] | null;
    category_id: string | null;
    add_collection_ids: string[];
  }>;
}): Promise<ActionResult<{ updated: number; skipped: number }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = enrichmentApplySchema.safeParse(input);
    if (!parsed.success) throw new Error("That set of changes isn't valid — re-run the preview and try again.");

    const productIds = parsed.data.proposals.map((p) => p.product_id);
    const { data: existing, error: existingError } = await admin
      .from("products")
      .select("id, slug")
      .in("id", productIds);
    if (existingError) throw new Error(existingError.message);
    const knownProductIds = new Set(((existing ?? []) as Array<{ id: string }>).map((p) => p.id));
    const slugById = new Map(((existing ?? []) as Array<{ id: string; slug: string }>).map((p) => [p.id, p.slug]));

    const [{ data: categoryRows }, { data: collectionRows }] = await Promise.all([
      admin.from("categories").select("id"),
      admin.from("collections").select("id").eq("is_active", true),
    ]);
    const validCategoryIds = new Set(((categoryRows ?? []) as Array<{ id: string }>).map((c) => c.id));
    const validCollectionIds = new Set(((collectionRows ?? []) as Array<{ id: string }>).map((c) => c.id));

    let updated = 0;
    let skipped = 0;

    for (const proposal of parsed.data.proposals) {
      if (!knownProductIds.has(proposal.product_id)) {
        skipped += 1;
        continue;
      }

      const update: Record<string, unknown> = {};
      // The style rules run again here: what's written is never whatever the
      // client sent, only what the rules accept.
      const styledName = enforceNameStyle(proposal.name);
      if (styledName) update.name = styledName;
      if (proposal.fabric_type?.trim()) update.fabric_type = proposal.fabric_type.trim();
      if (proposal.highlights) {
        const styled = normalizeHighlights(proposal.highlights);
        if (styled.length > 0) update.highlights = styled;
      }
      if (proposal.category_id && validCategoryIds.has(proposal.category_id)) {
        update.category_id = proposal.category_id;
      }

      const collectionIdsToAdd = proposal.add_collection_ids.filter((id) => validCollectionIds.has(id));

      if (Object.keys(update).length === 0 && collectionIdsToAdd.length === 0) {
        skipped += 1;
        continue;
      }

      if (Object.keys(update).length > 0) {
        update.updated_at = new Date().toISOString();
        const { error } = await admin.from("products").update(update).eq("id", proposal.product_id);
        if (error) throw new Error(`Updating "${styledName ?? proposal.product_id}": ${error.message}`);
      }

      if (collectionIdsToAdd.length > 0) {
        // Only ever adds links; existing memberships are left alone. Existing
        // rows are filtered out first so a re-run can't trip the join's PK.
        const { data: currentLinks } = await admin
          .from("collection_products")
          .select("collection_id")
          .eq("product_id", proposal.product_id);
        const alreadyLinked = new Set(
          ((currentLinks ?? []) as Array<{ collection_id: string }>).map((l) => l.collection_id),
        );
        const rows = collectionIdsToAdd
          .filter((id) => !alreadyLinked.has(id))
          .map((collection_id, index) => ({
            collection_id,
            product_id: proposal.product_id,
            display_order: alreadyLinked.size + index,
          }));
        if (rows.length > 0) {
          const { error } = await admin.from("collection_products").insert(rows);
          if (error) throw new Error(`Tagging collections for "${styledName ?? proposal.product_id}": ${error.message}`);
        }
      }

      updated += 1;
      const slug = slugById.get(proposal.product_id);
      if (slug) revalidatePath(`/sarees/${slug}`);
    }

    // The slug never changes here, so live product URLs stay valid — only the
    // rendered copy needs refreshing (same set saveProduct revalidates).
    revalidateTag("storefront-media");
    revalidateTag("storefront-collections");
    revalidatePath("/admin/products");
    revalidatePath("/search");
    revalidatePath("/catalog");
    revalidatePath("/catalog/[category]", "page");
    revalidatePath("/collections/[slug]", "page");
    revalidatePath("/");

    return { updated, skipped };
  });
}

// ── Product codes & web addresses (opt-in, separate from naming/tagging) ─────

/**
 * Kept out of previewProductEnrichment deliberately. Naming/tagging only edits
 * copy, so it is safe to run over anything; a slug is an address, so moving one
 * is its own decision. Only `source = 'admin'` products are ever eligible —
 * see src/lib/enrichment/identifiers.ts for why a `file_sync` row's slug is
 * load-bearing and must not move.
 */
export interface IdentifierCandidate {
  id: string;
  name: string;
  product_code: string | null;
  slug: string;
  code_ok: boolean;
  slug_ok: boolean;
}

type IdentifierRow = { id: string; name: string; slug: string; product_code: string | null };

/** Every product's slug/code, so uniqueness is checked against the whole table
 * and not just the batch being re-numbered. */
async function loadIdentifierRefs(admin: AdminClient) {
  const { data, error } = await admin.from("products").select("id, slug, product_code");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; slug: string; product_code: string | null }>;
  const codes = new Set<string>();
  const slugs = new Set<string>();
  let highest = 0;
  for (const row of rows) {
    slugs.add(row.slug);
    if (row.product_code) codes.add(row.product_code);
    const sequence = productCodeSequence(row.product_code);
    if (sequence && sequence > highest) highest = sequence;
  }
  return { codes, slugs, nextSequence: highest + 1 };
}

export async function listIdentifierCandidates(): Promise<ActionResult<{ candidates: IdentifierCandidate[] }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const { data, error } = await admin
      .from("products")
      .select("id, name, slug, product_code")
      .eq("source", "admin")
      .neq("status", "archived")
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) throw new Error(error.message);

    const candidates: IdentifierCandidate[] = [];
    for (const row of (data ?? []) as IdentifierRow[]) {
      const codeOk = isCanonicalProductCode(row.product_code);
      const slugOk = isCanonicalSlug(row.slug, row.name);
      if (codeOk && slugOk) continue;
      candidates.push({
        id: row.id,
        name: row.name,
        product_code: row.product_code,
        slug: row.slug,
        code_ok: codeOk,
        slug_ok: slugOk,
      });
    }
    return { candidates };
  });
}

/** Shared by preview and apply so the two can never plan differently. */
async function planIdentifiersFor(
  admin: AdminClient,
  options: { product_ids: string[]; normalize_codes: boolean; normalize_slugs: boolean },
): Promise<IdentifierProposal[]> {
  const { data, error } = await admin
    .from("products")
    .select("id, name, slug, product_code")
    .in("id", options.product_ids)
    // A mirrored storefront row's slug is the key its live photos and copy are
    // matched on — excluded here as well as in the candidate list, so a stale
    // or hand-edited id can't sneak one in.
    .eq("source", "admin");
  if (error) throw new Error(error.message);
  const products = (data ?? []) as IdentifierRow[];
  if (products.length === 0) throw new Error("None of those products can be renumbered.");

  const refs = await loadIdentifierRefs(admin);
  return planIdentifiers(
    products,
    { normalizeCodes: options.normalize_codes, normalizeSlugs: options.normalize_slugs },
    { codes: refs.codes, slugs: refs.slugs },
    refs.nextSequence,
  );
}

export async function previewProductIdentifiers(input: {
  product_ids: string[];
  normalize_codes?: boolean;
  normalize_slugs?: boolean;
}): Promise<ActionResult<{ proposals: IdentifierProposal[] }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = identifierPreviewSchema.safeParse(input);
    if (!parsed.success) throw new Error(`Pick between 1 and ${MAX_ENRICHMENT_BATCH} products.`);
    return { proposals: await planIdentifiersFor(admin, parsed.data) };
  });
}

/**
 * Re-plans from the product ids rather than accepting the previewed values, so
 * nothing about the new code or address comes from the browser. Writes the
 * product row only — never media, variants, prices, status or category.
 */
export async function applyProductIdentifiers(input: {
  product_ids: string[];
  normalize_codes?: boolean;
  normalize_slugs?: boolean;
}): Promise<ActionResult<{ updated: number; skipped: number; moved: Array<{ from: string; to: string }> }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = identifierApplySchema.safeParse(input);
    if (!parsed.success) throw new Error("That selection isn't valid — re-run the preview and try again.");

    const proposals = await planIdentifiersFor(admin, parsed.data);

    let updated = 0;
    let skipped = 0;
    const moved: Array<{ from: string; to: string }> = [];

    for (const proposal of proposals) {
      if (proposal.unchanged) {
        skipped += 1;
        continue;
      }
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (proposal.code) update.product_code = proposal.code;
      if (proposal.slug) update.slug = proposal.slug;

      const { error } = await admin.from("products").update(update).eq("id", proposal.product_id);
      if (error) throw new Error(`Renumbering "${proposal.name}": ${error.message}`);
      updated += 1;
      if (proposal.slug) {
        moved.push({ from: proposal.current_slug, to: proposal.slug });
        revalidatePath(`/sarees/${proposal.current_slug}`);
        revalidatePath(`/sarees/${proposal.slug}`);
      }
    }

    revalidatePath("/admin/products");
    return { updated, skipped, moved };
  });
}

// ── Colour-variant splitting for products that already exist ────────────────

export interface ColorSplitCandidate {
  id: string;
  name: string;
  variant_color: string;
  photo_count: number;
}

type SplitRow = {
  id: string;
  name: string;
  product_variants: Array<{
    id: string;
    color: string;
    display_order: number;
    variant_images: Array<{
      id: string;
      image_url: string;
      is_primary: boolean;
      display_order: number;
      media_type: string | null;
    }> | null;
  }> | null;
};

const SPLIT_SELECT =
  "id, name, product_variants(id, color, display_order, " +
  "variant_images(id, image_url, is_primary, display_order, media_type))";

function toSplitCandidateProduct(row: SplitRow): SplitCandidateProduct | null {
  const variants = row.product_variants ?? [];
  if (variants.length !== 1) return null;
  const variant = variants[0];
  const images: SplitCandidateImage[] = (variant.variant_images ?? []).map((img) => ({
    id: img.id,
    image_url: img.image_url,
    media_type: img.media_type === "video" ? "video" : "image",
    is_primary: img.is_primary,
    display_order: img.display_order,
  }));
  return {
    id: row.id,
    name: row.name,
    variant_id: variant.id,
    variant_color: variant.color,
    images,
  };
}

/**
 * Single-variant products with enough photos that they could be several
 * colourways of one design — the shape a WhatsApp batch of mixed colours lands
 * in. Mirrored storefront rows are excluded: the live page flattens every
 * variant's photos into one gallery (src/lib/storefront-media.ts), so splitting
 * one would reorder the live photos without producing separate colourways.
 */
export async function listColorSplitCandidates(): Promise<ActionResult<{ candidates: ColorSplitCandidate[] }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const { data, error } = await admin
      .from("products")
      .select(SPLIT_SELECT)
      .eq("source", "admin")
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const candidates: ColorSplitCandidate[] = [];
    for (const row of (data ?? []) as unknown as SplitRow[]) {
      const product = toSplitCandidateProduct(row);
      if (!product) continue;
      const photoCount = splittablePhotos(product.images).length;
      if (!isSplitCandidate({ variant_count: 1, photo_count: photoCount })) continue;
      candidates.push({
        id: product.id,
        name: product.name,
        variant_color: product.variant_color,
        photo_count: photoCount,
      });
    }
    return { candidates };
  });
}

export async function previewColorSplit(input: {
  product_ids: string[];
}): Promise<ActionResult<{ plans: ColorSplitPlan[]; skipped: string[]; ai_available: boolean }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = colorSplitPreviewSchema.safeParse(input);
    if (!parsed.success) throw new Error(`Pick between 1 and ${MAX_COLOR_SPLIT_BATCH} products.`);

    const aiProvider = getAiProvider();
    const aiAvailable = aiProvider.name !== "none" && aiProvider.isConfigured();
    if (!aiAvailable) {
      // No deterministic fallback here on purpose: there is no way to tell two
      // colourways apart without looking at the photos.
      return { plans: [], skipped: [], ai_available: false };
    }

    const { data, error } = await admin
      .from("products")
      .select(`${SPLIT_SELECT}, description`)
      .in("id", parsed.data.product_ids)
      .eq("source", "admin");
    if (error) throw new Error(error.message);

    const plans: ColorSplitPlan[] = [];
    const skipped: string[] = [];

    const rows = (data ?? []) as unknown as Array<SplitRow & { description: string | null }>;
    await mapWithConcurrency(rows, AI_CONCURRENCY, async (row) => {
      const product = toSplitCandidateProduct(row);
      if (!product) {
        skipped.push(row.name);
        return;
      }
      const photos = splittablePhotos(product.images);
      if (photos.length < 2) {
        skipped.push(row.name);
        return;
      }

      let suggestions;
      try {
        suggestions = await aiProvider.suggestColorVariants({
          adminDescription: row.description?.trim() || null,
          // variant_images.id doubles as the client_upload_id, so the
          // resolver's "only ids the caller offered" guard is an id check here.
          images: photos.map((img) => ({ client_upload_id: img.id, url: img.image_url })),
        });
      } catch (e) {
        console.warn("colour split: suggestion failed", e instanceof Error ? e.message : e);
        skipped.push(row.name);
        return;
      }
      if (!suggestions) {
        skipped.push(row.name);
        return;
      }

      const plan = planColorSplit(product, suggestions);
      if (!plan) {
        skipped.push(row.name);
        return;
      }
      plans.push(plan);
    });

    return { plans, skipped, ai_available: true };
  });
}

/**
 * The explicit admin confirm. Re-checks every id against the product's own rows
 * before writing — a plan can be minutes old, and photos may have been moved or
 * deleted in the variant editor since. Rewrites `product_variants` /
 * `variant_images` for that product only: no file is uploaded or deleted, and
 * nothing else on the product changes.
 */
export async function applyColorSplit(input: {
  plans: ColorSplitApplyShape["plans"];
}): Promise<ActionResult<{ split: number; skipped: number }>> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = colorSplitApplySchema.safeParse(input);
    if (!parsed.success) throw new Error("That split isn't valid — re-run the preview and try again.");

    let split = 0;
    let skipped = 0;

    for (const plan of parsed.data.plans) {
      const { data, error } = await admin
        .from("products")
        .select(`${SPLIT_SELECT}, slug`)
        .eq("id", plan.product_id)
        .eq("source", "admin")
        .maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as unknown as (SplitRow & { slug: string }) | null;
      const product = row ? toSplitCandidateProduct(row) : null;

      // Still exactly one variant, and still the one the plan was made against?
      if (!row || !product || product.variant_id !== plan.base_variant_id) {
        skipped += 1;
        continue;
      }

      const ownImageIds = new Set(product.images.map((img) => img.id));
      const claimed = new Set<string>();
      const groups = plan.groups
        .map((group) => ({
          color: group.color.trim(),
          color_hex: group.color_hex,
          image_ids: group.image_ids.filter((id) => {
            if (!ownImageIds.has(id) || claimed.has(id)) return false;
            claimed.add(id);
            return true;
          }),
        }))
        .filter((group) => group.color.length > 0 && group.image_ids.length > 0);

      if (groups.length < 2) {
        skipped += 1;
        continue;
      }

      // Anything the plan didn't place (including every video) stays with the
      // first colourway rather than being orphaned or dropped.
      const leftovers = product.images.map((img) => img.id).filter((id) => !claimed.has(id));
      groups[0].image_ids = [...groups[0].image_ids, ...leftovers];

      // The existing variant becomes the first colourway — reusing it keeps the
      // product's price/stock settings and avoids a moment with no variant.
      const { error: baseError } = await admin
        .from("product_variants")
        .update({
          color: groups[0].color,
          color_hex: groups[0].color_hex,
          display_order: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", plan.base_variant_id);
      if (baseError) throw new Error(`Splitting "${product.name}": ${baseError.message}`);

      const variantIdByGroup: string[] = [plan.base_variant_id];
      for (const [index, group] of groups.slice(1).entries()) {
        const { data: inserted, error: insertError } = await admin
          .from("product_variants")
          .insert({
            product_id: plan.product_id,
            color: group.color,
            color_hex: group.color_hex,
            status: "available",
            display_order: index + 1,
          })
          .select("id")
          .single();
        if (insertError) throw new Error(`Splitting "${product.name}": ${insertError.message}`);
        variantIdByGroup.push((inserted as { id: string }).id);
      }

      for (const [groupIndex, group] of groups.entries()) {
        const variantId = variantIdByGroup[groupIndex];
        for (const [imageIndex, imageId] of group.image_ids.entries()) {
          const { error: moveError } = await admin
            .from("variant_images")
            .update({
              variant_id: variantId,
              display_order: imageIndex,
              is_primary: imageIndex === 0,
            })
            .eq("id", imageId);
          if (moveError) throw new Error(`Splitting "${product.name}": ${moveError.message}`);
        }
      }

      split += 1;
      revalidatePath(`/sarees/${row.slug}`);
    }

    revalidateTag("storefront-media");
    revalidatePath("/admin/products");
    return { split, skipped };
  });
}
