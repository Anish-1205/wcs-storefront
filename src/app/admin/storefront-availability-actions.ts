"use server";

import { z } from "zod";
import { revalidatePath, revalidateTag } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { toResult } from "@/app/admin/actions";
import { ExpectedError } from "@/lib/report-error";
import { getProductBySlug } from "@/data/products";
import { storefrontAvailabilitySchema } from "@/lib/validation";
import { AVAILABILITY_SIGNAL_PRESETS } from "@/lib/availability-presets";

type Value = Omit<z.infer<typeof storefrontAvailabilitySchema>, "slug">;
export interface SignalHistoryEntry {
  id: number;
  slug: string;
  actor: string;
  before_value: Value | null;
  after_value: Value | null;
  created_at: string;
}
type Change = { slug: string; value: Value | null; expected_history_id?: number };

function refresh(slugs: string[]) {
  revalidateTag("storefront-availability");
  for (const path of ["/admin/products", "/admin/storefront-availability", "/", "/catalog", "/search"]) revalidatePath(path);
  revalidatePath("/catalog/[category]", "page");
  revalidatePath("/collections/[slug]", "page");
  for (const slug of slugs) revalidatePath(`/sarees/${slug}`);
}

async function write(changes: Change[], session: Awaited<ReturnType<typeof assertAdmin>>) {
  const { admin, user } = session;
  const slugs = changes.map((change) => change.slug);
  const { data: products, error: lookupError } = await admin.from("products").select("id, slug").in("slug", slugs);
  if (lookupError) throw new Error("Could not verify products. Please retry.", { cause: lookupError });
  const known = new Set((products ?? []).map((p) => p.slug));
  for (const slug of slugs) {
    if (!known.has(slug) && !getProductBySlug(slug)) throw new ExpectedError(`No product with slug "${slug}".`);
  }
  const { data, error } = await admin.rpc("change_storefront_availability", {
    changes: changes.map((change) => ({ ...change, product_id: products?.find((p) => p.slug === change.slug)?.id ?? null })), actor_email: user.email ?? user.id,
  });
  if (error) throw new Error(error.message);
  refresh(slugs);
  return { changes: data as Array<{ slug: string; id: number }> };
}

export async function setStorefrontAvailability(input: z.infer<typeof storefrontAvailabilitySchema>) {
  return toResult(async () => {
    const session = await assertAdmin();
    const { slug, ...value } = storefrontAvailabilitySchema.parse(input);
    return write([{ slug, value }], session);
  });
}

export async function clearStorefrontAvailability(slug: string) {
  return toResult(async () => {
    const session = await assertAdmin();
    return write([{ slug: storefrontAvailabilitySchema.shape.slug.parse(slug), value: null }], session);
  });
}

export async function bulkStorefrontAvailability(input: { slugs: string[]; preset: string }) {
  return toResult(async () => {
    const session = await assertAdmin();
    const slugs = [...new Set(z.array(storefrontAvailabilitySchema.shape.slug).min(1).max(100).parse(input.slugs))];
    const preset = AVAILABILITY_SIGNAL_PRESETS.find((p) => p.key === input.preset);
    if (!preset && input.preset !== "") throw new ExpectedError("Choose a valid stock signal.");
    const value = preset ? { availability: preset.availability, availability_note: preset.note } : null;
    return write(slugs.map((slug) => ({ slug, value })), session);
  });
}

export async function getSignalHistory(slug: string) {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    slug = storefrontAvailabilitySchema.shape.slug.parse(slug);
    const { data, error } = await admin.from("storefront_availability_history")
      .select("id, slug, actor, before_value, after_value, created_at")
      .eq("slug", slug).is("deleted_at", null).order("id", { ascending: false }).limit(10);
    if (error) throw new Error("Could not load signal history. Please retry.", { cause: error });
    return { entries: (data ?? []) as SignalHistoryEntry[] };
  });
}

export async function undoSignalChanges(ids: number[]) {
  return toResult(async () => {
    const session = await assertAdmin();
    ids = [...new Set(z.array(z.number().int().positive()).min(1).max(100).parse(ids))];
    const { data, error } = await session.admin.from("storefront_availability_history")
      .select("id, slug, before_value").in("id", ids).is("deleted_at", null);
    if (error) throw new Error("Could not load those changes. Please retry.", { cause: error });
    // A short read means another admin already undid or superseded one of them.
    if (data?.length !== ids.length) throw new ExpectedError("These changes are no longer available to undo.");
    const changes = data.map((row) => ({ slug: row.slug, value: row.before_value, expected_history_id: row.id })) as Change[];
    if (new Set(changes.map((c) => c.slug)).size !== changes.length) throw new ExpectedError("Undo only the latest change for each product.");
    return write(changes, session);
  });
}
