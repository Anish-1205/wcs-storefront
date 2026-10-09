/**
 * Reading `storefront_hidden_slugs` — the slugs admin has taken off the site.
 *
 * Separate from src/lib/storefront-catalog.ts because the admin actions need it
 * too (to refresh the mirror the moment a product is hidden) and must not pull
 * in that module's `unstable_cache` wiring.
 */
import { createPublicClient } from "@/lib/supabase/server";
import { writeVisibilityMirror } from "@/lib/catalog-visibility-mirror";
import { reportError } from "@/lib/report-error";

/** How many rows to ask for at a time. PostgREST caps a response at its own
 *  `db-max-rows` (1000 on Supabase by default) whatever we ask for, so the
 *  loop below advances by what actually arrived rather than by this. */
const PAGE_SIZE = 1000;
/** Enough pages for any plausible catalogue, and a guard against looping
 *  forever if the server keeps returning rows. */
const MAX_PAGES = 50;

/**
 * Every slug in the view, in full.
 *
 * A single unpaged `select` would stop at PostgREST's row cap and quietly
 * return the *first* 1000 hidden slugs, leaving every slug past that one
 * publicly visible. So this pages through the view and, when PostgREST reports
 * a total, refuses to return a list that does not match it: an incomplete
 * answer must fail (and fall back) rather than under-hide.
 */
export async function fetchHiddenSlugs(): Promise<string[]> {
  const client = createPublicClient();
  const slugs: string[] = [];
  let total: number | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = slugs.length;
    // The count is only asked for once: it costs the database an extra scan.
    const query =
      page === 0
        ? client.from("storefront_hidden_slugs").select("slug", { count: "exact" })
        : client.from("storefront_hidden_slugs").select("slug");
    const { data, error, count } = await query.order("slug").range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (page === 0 && typeof count === "number") total = count;

    const rows = (data ?? []) as { slug: string }[];
    for (const row of rows) {
      if (typeof row.slug !== "string" || !row.slug) {
        throw new Error("storefront_hidden_slugs returned a row without a slug");
      }
      slugs.push(row.slug);
    }

    if (total !== null) {
      if (slugs.length >= total) break;
      // A page that brought nothing while rows are still outstanding means the
      // rest cannot be read, so the list is incomplete.
      if (rows.length === 0) throw new Error("storefront_hidden_slugs stopped before its reported total");
    } else if (rows.length < PAGE_SIZE) {
      // No total to check against, but a short page is the end of the view.
      return slugs;
    } else {
      throw new Error("storefront_hidden_slugs did not report how many rows it has");
    }
  }

  if (total === null || slugs.length !== total) {
    throw new Error("storefront_hidden_slugs could not be read in full");
  }
  return slugs;
}

/**
 * Push the hidden set to the mirror now, for the admin actions that publish or
 * unpublish a product.
 *
 * Refreshing on the next successful storefront read would normally be enough,
 * but not if Supabase goes down in the gap before any page is served — which is
 * exactly the case the mirror exists for. Doing it here records the change
 * while the database is still reachable.
 *
 * Best-effort by design: a failure leaves the mirror behind, which is reported,
 * but it must never fail the admin's save.
 */
export async function refreshVisibilityMirror(): Promise<void> {
  try {
    await writeVisibilityMirror(await fetchHiddenSlugs());
  } catch (error) {
    reportError(error, { scope: "catalog-visibility-mirror", op: "refresh" });
  }
}
