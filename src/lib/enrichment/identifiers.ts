/**
 * Product code + web-address (slug) normalisation.
 *
 * Deliberately NOT part of "Re-run AI naming & tagging": that step is safe to
 * run over anything because it only touches copy, whereas a slug is an
 * address. Keeping it as its own opt-in action is the safeguard — see
 * src/app/admin/enrichment-actions.ts.
 *
 * Two rules make the address change safe in this codebase:
 *
 *  1. **Only `source = 'admin'` products are eligible.** The public storefront
 *     is file-driven (`src/data/products.ts`), so a public URL is never
 *     resolved from `products.slug`. The one place the column *is* load-bearing
 *     is a `file_sync` row, whose slug is the join key that matches a mirrored
 *     row back to its file entry (see src/lib/storefront-media.ts) — rename one
 *     and its photos and copy stop reaching the live page. Those rows are
 *     excluded, never renamed.
 *  2. **The previous slug is reported before anything is written**, so the
 *     preview shows exactly which addresses move.
 *
 * Everything in this module is pure: the server action does the IO.
 */

import { slugify } from "@/lib/utils";

/** House prefix for generated codes. Existing codes in this shape are kept. */
export const PRODUCT_CODE_PREFIX = "WCS";

/** `WCS-001`, widening past three digits rather than wrapping at 999. */
const CANONICAL_CODE = new RegExp(`^${PRODUCT_CODE_PREFIX}-\\d{3,}$`);

/**
 * Slugs are capped so an address stays readable and linkable. Long product
 * names (the "benarsi-georgette-khaddi-shikargah-saree-with-paithani" case)
 * get cut at a word boundary rather than mid-word.
 */
export const MAX_SLUG_LENGTH = 60;

export function isCanonicalProductCode(code: string | null | undefined): boolean {
  return !!code && CANONICAL_CODE.test(code);
}

export function formatProductCode(sequence: number): string {
  return `${PRODUCT_CODE_PREFIX}-${String(sequence).padStart(3, "0")}`;
}

/** The numeric part of a canonical code, or null if it isn't one. */
export function productCodeSequence(code: string | null | undefined): number | null {
  if (!isCanonicalProductCode(code)) return null;
  const n = Number(code!.slice(PRODUCT_CODE_PREFIX.length + 1));
  return Number.isFinite(n) ? n : null;
}

/** Trims a slug to MAX_SLUG_LENGTH without splitting a word. */
export function shortenSlug(slug: string): string {
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  const cut = slug.slice(0, MAX_SLUG_LENGTH + 1);
  const lastBoundary = cut.lastIndexOf("-");
  const trimmed = lastBoundary > 0 ? cut.slice(0, lastBoundary) : slug.slice(0, MAX_SLUG_LENGTH);
  return trimmed.replace(/-+$/, "");
}

/** True when the slug is already what this product's name would produce. */
export function isCanonicalSlug(slug: string, name: string): boolean {
  return slug === shortenSlug(slugify(name));
}

export interface IdentifierProposal {
  product_id: string;
  name: string;
  current_code: string | null;
  /** null = leave the code as it is. */
  code: string | null;
  current_slug: string;
  /** null = leave the address as it is. */
  slug: string | null;
  changes: string[];
  unchanged: boolean;
}

export interface IdentifierInput {
  id: string;
  name: string;
  slug: string;
  product_code: string | null;
}

export interface IdentifierOptions {
  /** Assign/renumber product codes. */
  normalizeCodes: boolean;
  /** Re-derive the web address from the product name. */
  normalizeSlugs: boolean;
}

/**
 * Plans code/slug changes for a batch.
 *
 * `takenCodes` / `takenSlugs` must be every value in the table, including the
 * products being planned — their own current values are released as each one
 * is handled, so an unchanged product never collides with itself, and two
 * products in the same batch can't be handed the same value.
 *
 * `nextSequence` is where code numbering starts: pass one past the highest
 * canonical code already in the catalogue so generated codes keep climbing.
 */
export function planIdentifiers(
  products: IdentifierInput[],
  options: IdentifierOptions,
  taken: { codes: Set<string>; slugs: Set<string> },
  nextSequence: number,
): IdentifierProposal[] {
  const codes = new Set(taken.codes);
  const slugs = new Set(taken.slugs);
  let sequence = Math.max(1, nextSequence);

  return products.map((product) => {
    const changes: string[] = [];

    let code: string | null = null;
    if (options.normalizeCodes && !isCanonicalProductCode(product.product_code)) {
      if (product.product_code) codes.delete(product.product_code);
      let candidate = formatProductCode(sequence);
      while (codes.has(candidate)) candidate = formatProductCode(++sequence);
      sequence += 1;
      codes.add(candidate);
      code = candidate;
      changes.push(`Code: ${product.product_code ?? "(none)"} → ${candidate}`);
    }

    let slug: string | null = null;
    if (options.normalizeSlugs && !isCanonicalSlug(product.slug, product.name)) {
      const root = shortenSlug(slugify(product.name));
      if (root) {
        slugs.delete(product.slug);
        let candidate = root;
        let counter = 2;
        while (slugs.has(candidate)) candidate = `${root}-${counter++}`;
        slugs.add(candidate);
        if (candidate !== product.slug) {
          slug = candidate;
          changes.push(`Web address: /${product.slug} → /${candidate}`);
        } else {
          // Re-add: nothing moved, so the old value is still in use.
          slugs.add(product.slug);
        }
      }
    }

    return {
      product_id: product.id,
      name: product.name,
      current_code: product.product_code,
      code,
      current_slug: product.slug,
      slug,
      changes,
      unchanged: changes.length === 0,
    };
  });
}
