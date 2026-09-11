"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-auth";
import { toResult } from "@/app/admin/actions";
import { homepageSchema } from "@/lib/homepage-content";
import { editablePageSchema, pageOverridesSchema } from "@/lib/page-content";

const KEPT_VERSIONS = 10;
const versionIdSchema = z.string().uuid();

function parseFor(scope: string, input: unknown) {
  return scope === "home" ? homepageSchema.parse(input) : pageOverridesSchema.parse(input);
}
function scopeFor(page: string) {
  return page === "home" ? "home" : editablePageSchema.parse(page);
}
function revalidatePublic() {
  revalidateTag("storefront-pages");
  revalidatePath("/", "layout");
  revalidatePath("/admin/pages");
}

/** Saves work in progress. Visitors keep seeing the last published version. */
export async function savePageDraft(page: string, input: unknown) {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const scope = scopeFor(page);
    const draft = parseFor(scope, input);
    const { data: existing } = await admin
      .from("storefront_page_content").select("content").eq("page", scope).maybeSingle();
    const { error } = await admin.from("storefront_page_content").upsert({
      page: scope,
      // A first draft must not blank the live page, so publish nothing new here.
      content: existing?.content ?? (scope === "home" ? draft : {}),
      draft_content: draft,
      updated_at: new Date().toISOString(),
    }, { onConflict: "page" });
    if (error) throw new Error("Could not save your draft. Check that the page-content database migrations have been applied.");
    revalidatePath("/admin/pages");
    return {};
  });
}

/** Makes the given content live, keeping the previous live version for undo. */
export async function publishPageContent(page: string, input: unknown) {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const scope = scopeFor(page);
    const content = parseFor(scope, input);
    const { data: existing } = await admin
      .from("storefront_page_content").select("content").eq("page", scope).maybeSingle();
    if (existing?.content) await snapshot(admin, scope, existing.content);
    const { error } = await admin.from("storefront_page_content").upsert({
      page: scope, content, draft_content: content, updated_at: new Date().toISOString(),
    }, { onConflict: "page" });
    if (error) throw new Error("Could not publish. Check that the page-content database migrations have been applied.");
    revalidatePublic();
    return {};
  });
}

/** Puts an earlier published version back on the website. */
export async function restorePageVersion(page: string, versionId: string) {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const scope = scopeFor(page);
    const id = versionIdSchema.parse(versionId);
    const { data: version } = await admin
      .from("storefront_page_content_versions").select("content").eq("id", id).eq("page", scope).maybeSingle();
    if (!version) throw new Error("That earlier version is no longer available.");
    const content = parseFor(scope, version.content);
    const { data: existing } = await admin
      .from("storefront_page_content").select("content").eq("page", scope).maybeSingle();
    if (existing?.content) await snapshot(admin, scope, existing.content);
    const { error } = await admin.from("storefront_page_content").upsert({
      page: scope, content, draft_content: content, updated_at: new Date().toISOString(),
    }, { onConflict: "page" });
    if (error) throw new Error("Could not restore that version.");
    revalidatePublic();
    return { content };
  });
}

type AdminClient = Awaited<ReturnType<typeof assertAdmin>>["admin"];
async function snapshot(admin: AdminClient, page: string, content: unknown) {
  await admin.from("storefront_page_content_versions").insert({ page, content });
  const { data: kept } = await admin.from("storefront_page_content_versions")
    .select("id").eq("page", page).order("created_at", { ascending: false }).limit(KEPT_VERSIONS);
  const ids = (kept ?? []).map((row: { id: string }) => row.id);
  if (ids.length === KEPT_VERSIONS) {
    await admin.from("storefront_page_content_versions").delete().eq("page", page).not("id", "in", `(${ids.join(",")})`);
  }
}
