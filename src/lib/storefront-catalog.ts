/**
 * The live storefront catalogue.
 *
 * Product copy, media roles and running order are file-authored
 * (src/data/products.ts) — see CLAUDE.md's "two data sources, on purpose".
 * But that file is only ever *half* the catalogue: admin creates products
 * too (WhatsApp ingest, /admin/import, "Duplicate"), and before this module
 * existed such a product could never reach the storefront no matter what its
 * status said. Every public page started from `getAllProducts()` and Postgres
 * rows were only overlaid onto slugs the file already had, so publishing an
 * admin-created product changed nothing on the site — the only way to make it
 * live was to hand-write a matching entry into products.ts and redeploy.
 *
 * So the live catalogue is the file list *reconciled* against Postgres:
 *
 *   file entry + published row    → file entry, with the mirror's saved media
 *                                   and copy overlaid (unchanged behaviour),
 *                                   and the row's price overlaid whatever
 *                                   created the row
 *   file entry, no row at all     → file entry (nothing to reconcile against)
 *   file entry + unpublished row  → dropped — admin hid or archived it
 *   published row, no file entry  → materialised from the row
 *
 * Every read here fails soft: if Supabase is unreachable or a table/view is
 * missing, the storefront falls back to exactly the file catalogue, which is
 * what it rendered before this module existed.
 */

import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/server";
import type { Availability, Product, ProductImage } from "@/data/products";
import type { ProductWithRelations, VariantImage } from "@/lib/supabase/types";
import { applyStorefrontMedia } from "@/lib/storefront-media";
import { isVideoMedia } from "@/lib/variant-images";
import { cldVideoThumbnail } from "@/lib/cloudinary";

/** Cloudinary delivers any size; these only reserve the box (4:5 portrait,
 *  the ratio every storefront card and the product hero are cropped to). */
const REMOTE_IMAGE_W = 1200;
const REMOTE_IMAGE_H = 1600;

const CATALOG_SELECT =
  "id, slug, name, description, highlights, base_price_min, is_featured, source, product_code, fabric_type, created_at," +
  " category:categories(id, name, slug)," +
  " product_variants(id, color, status, display_order, variant_images(id, image_url, is_primary, display_order, media_type))";

/**
 * Every published product, whatever created it. Cached for 60s and tagged
 * `storefront-media`, which every admin catalogue write already revalidates
 * (see revalidatePublic in src/app/admin/actions.ts) — so publishing in admin
 * shows up immediately rather than at the end of the window.
 */
const getPublishedRows = unstable_cache(
  async (): Promise<ProductWithRelations[]> => {
    try {
      const { data, error } = await createPublicClient()
        .from("products")
        .select(CATALOG_SELECT)
        .eq("status", "published");
      if (error) throw error;
      return (data ?? []) as unknown as ProductWithRelations[];
    } catch {
      return [];
    }
  },
  ["storefront-catalog-rows"],
  { revalidate: 60, tags: ["storefront-media"] },
);

/**
 * The slugs admin has taken *off* the site (draft/archived).
 *
 * RLS deliberately stops the anon key reading an unpublished product, so the
 * storefront cannot otherwise tell "admin hid this" apart from "this product
 * was never mirrored into Postgres" — and guessing wrong in that direction
 * would delete half the catalogue. `storefront_hidden_slugs` (migration 021)
 * is a slug-only view that answers exactly that one question. Missing view →
 * empty list → nothing is hidden, same as before.
 */
const getHiddenSlugs = unstable_cache(
  async (): Promise<string[]> => {
    try {
      const { data, error } = await createPublicClient().from("storefront_hidden_slugs").select("slug");
      if (error) throw error;
      return (data ?? []).map((row) => (row as { slug: string }).slug);
    } catch {
      return [];
    }
  },
  ["storefront-hidden-slugs"],
  { revalidate: 60, tags: ["storefront-media"] },
);

// ── Materialising a Postgres row as a storefront product ──────────────

/**
 * Colour words mapped to the catalogue's colour families (the storefront
 * groups by colour, while admin's `categories` are weave families). The FIRST
 * colour word in the text wins, left to right, because the naming convention
 * in src/lib/ai/style-guide.ts puts the body colour at the front of the name —
 * "Antique Gold Saree with Red-Gold Border" is a gold saree, not a red one.
 * Nothing here invents a colour: a name with no colour word stays "Assorted".
 */
const COLOUR_WORDS: Record<string, string> = {
  multicolour: "Multicolour", multicolor: "Multicolour", multi: "Multicolour", rainbow: "Multicolour",
  pink: "Pink", rani: "Pink", magenta: "Pink", fuchsia: "Pink", fuschia: "Pink", rose: "Pink", blush: "Pink", coral: "Pink",
  red: "Red", maroon: "Red", vermilion: "Red", crimson: "Red", scarlet: "Red", rust: "Red", cherry: "Red", sindoori: "Red",
  orange: "Orange", peach: "Orange", apricot: "Orange", saffron: "Orange", tangerine: "Orange",
  yellow: "Yellow", lemon: "Yellow", haldi: "Yellow", turmeric: "Yellow",
  gold: "Gold", golden: "Gold", mustard: "Gold", ochre: "Gold", champagne: "Gold", bronze: "Gold",
  ivory: "Ivory", white: "Ivory", cream: "Ivory", pearl: "Ivory", beige: "Ivory", sand: "Ivory",
  purple: "Purple", aubergine: "Purple", lavender: "Purple", violet: "Purple", wine: "Purple",
  plum: "Purple", mauve: "Purple", lilac: "Purple", brinjal: "Purple",
  blue: "Blue", indigo: "Blue", navy: "Blue", teal: "Blue", peacock: "Blue", turquoise: "Blue",
  cobalt: "Blue", firozi: "Blue", ferozi: "Blue",
  green: "Green", emerald: "Green", parrot: "Green", olive: "Green", bottle: "Green",
  mint: "Green", sage: "Green", pista: "Green", mehendi: "Green",
  black: "Black", charcoal: "Black",
  grey: "Grey", gray: "Grey", silver: "Grey", steel: "Grey",
  brown: "Brown", coffee: "Brown", chocolate: "Brown", tan: "Brown", copper: "Brown",
};

/** Placeholder variant labels that carry no colour information. */
const PLACEHOLDER_COLOURS = new Set(["", "default", "assorted", "standard", "na", "n/a", "-"]);

function detectColourFamily(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) continue;
    for (const word of text.toLowerCase().split(/[^a-z]+/)) {
      const family = COLOUR_WORDS[word];
      if (family) return family;
    }
  }
  return null;
}

function slugifyFamily(name: string): string {
  return name.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
}

function isVideoRow(image: VariantImage): boolean {
  return isVideoMedia({ ...image, media_type: image.media_type ?? "image" });
}

/**
 * A Postgres product as the storefront's `Product`. Returns null when the row
 * has no photo — a card with no image would break every list page, and there
 * is nothing to show a customer either way.
 *
 * A row's variants are flattened into one product rather than split into one
 * product per colourway: the storefront's model is one product = one page, and
 * splitting would have to invent a slug per variant.
 */
export function toStorefrontProduct(row: ProductWithRelations): Product | null {
  const variants = [...(row.product_variants ?? [])].sort((a, b) => a.display_order - b.display_order);
  const media = variants.flatMap((variant) =>
    [...(variant.variant_images ?? [])].sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order,
    ),
  );

  const title = row.name?.trim() || row.slug;
  const photoUrls = [...new Set(media.filter((image) => !isVideoRow(image)).map((image) => image.image_url))].filter(Boolean);
  if (photoUrls.length === 0) return null;

  const images: ProductImage[] = photoUrls.map((src) => ({
    src,
    w: REMOTE_IMAGE_W,
    h: REMOTE_IMAGE_H,
    alt: title,
    // Admin photos carry no narrative role, so they all read as full shots —
    // gallery order then falls back to the order the admin arranged them in.
    role: "full" as const,
  }));

  const videos = [...new Set(media.filter(isVideoRow).map((image) => image.image_url))].filter(Boolean).map((src) => ({
    src,
    poster: cldVideoThumbnail(src),
    w: REMOTE_IMAGE_W,
    h: REMOTE_IMAGE_H,
    alt: `${title} in motion`,
  }));

  const variantColour =
    variants
      .map((variant) => variant.color?.trim() ?? "")
      .find((colour) => colour && !PLACEHOLDER_COLOURS.has(colour.toLowerCase())) ?? null;
  const colourFamily = detectColourFamily(variantColour, title) ?? "Assorted";

  const availability: Availability =
    variants.length === 0
      ? "on-request"
      : variants.every((variant) => variant.status === "sold_out")
        ? "sold"
        : "available";

  const weave = row.fabric_type?.trim() || row.category?.name || null;

  return {
    id: row.id,
    slug: row.slug,
    title,
    // Shown in the enquiry/WhatsApp message and used as a React key there, so
    // it has to be unique — the slug is, when no product code has been set.
    reference: row.product_code?.trim() || row.slug,
    category: colourFamily,
    categorySlug: slugifyFamily(colourFamily),
    weave,
    material: null,
    origin: null,
    colour: variantColour ?? (colourFamily === "Assorted" ? "" : colourFamily),
    colourFamily,
    variantGroup: null,
    price: row.base_price_min ?? null,
    availability,
    availabilityNote: null,
    description: row.description?.trim() ?? "",
    details: row.highlights ?? [],
    includes: null,
    images,
    primaryImageSrc: photoUrls[0],
    videos,
    tags: [...new Set([row.category?.name, weave].filter((tag): tag is string => !!tag))],
    featured: row.is_featured ?? false,
    colourRangeNote: null,
    createdAt: (row.created_at ?? "").slice(0, 10),
  };
}

// ── Reconciliation ────────────────────────────────────────────────────

/**
 * Price is the one field every published row overlays onto its file entry,
 * whatever created the row. Copy and media stay behind the `file_sync` rule
 * above (an import's defaults must not replace curated prose or art-directed
 * media roles), but a price is not prose: whatever admin last saved is the
 * price the business is asking, and there is no curated version of it to
 * protect. Without this, changing the price of an `admin` row sitting at a
 * file slug changed nothing on the site.
 */
function applyPriceOverrides(products: Product[], publishedRows: ProductWithRelations[]): Product[] {
  const priceBySlug = new Map(publishedRows.map((row) => [row.slug, row.base_price_min ?? null]));
  return products.map((product) => {
    const price = priceBySlug.get(product.slug);
    // `undefined` = no row for this slug; `null` = admin cleared the price.
    return price === undefined || price === product.price ? product : { ...product, price };
  });
}

/**
 * Pure merge of the file catalogue with what Postgres says is live. Kept
 * separate from the cached reads above so it can be tested without a database.
 */
export function mergeStorefrontCatalog(
  fileProducts: Product[],
  publishedRows: ProductWithRelations[],
  hiddenSlugs: Iterable<string> = [],
): Product[] {
  const hidden = new Set(hiddenSlugs);
  const visible = hidden.size === 0 ? fileProducts : fileProducts.filter((product) => !hidden.has(product.slug));

  // Only the mirror's own rows overlay a file entry's media and copy. An
  // admin-authored row that happens to sit at a file slug was written
  // independently of the curated file entry (usually an import), so letting it
  // win would replace hand-written copy and art-directed media roles with the
  // imported defaults.
  const merged = applyPriceOverrides(
    applyStorefrontMedia(
      visible,
      publishedRows.filter((row) => row.source === "file_sync"),
    ),
    publishedRows,
  );

  const fileSlugs = new Set(fileProducts.map((product) => product.slug));
  const dbOnly = publishedRows
    .filter((row) => !fileSlugs.has(row.slug))
    .map(toStorefrontProduct)
    .filter((product): product is Product => product !== null)
    // Newest first, so a product published today lands at the top of the
    // admin-created run rather than buried behind months of imports.
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title));

  return [...merged, ...dbOnly];
}

/** The file catalogue reconciled against Postgres. Never throws. */
export async function getStorefrontCatalog(fileProducts: Product[]): Promise<Product[]> {
  const [rows, hidden] = await Promise.all([getPublishedRows(), getHiddenSlugs()]);
  return mergeStorefrontCatalog(fileProducts, rows, hidden);
}
