"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { toResult } from "@/app/admin/actions";
import { homepageSchema } from "@/lib/homepage-content";
import { editablePageSchema, pageOverridesSchema } from "@/lib/page-content";

export async function savePageContent(page: string, input: unknown) {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const scope = editablePageSchema.parse(page);
    const content = pageOverridesSchema.parse(input);
    const { error } = await admin.from("storefront_page_content").upsert({ page: scope, content, updated_at: new Date().toISOString() }, { onConflict: "page" });
    if (error) throw new Error("Could not save page content. Check the page-content database migration.");
    revalidateTag("storefront-pages");
    revalidatePath("/", "layout");
    revalidatePath("/admin/pages");
    return {};
  });
}

export async function saveHomepageContent(input: unknown) {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    const parsed = homepageSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the page fields");
    const { error } = await admin.from("storefront_page_content").upsert({
      page: "home", content: parsed.data, updated_at: new Date().toISOString(),
    }, { onConflict: "page" });
    if (error) throw new Error("Could not save page content. Check that the page-content database migration has been applied.");
    revalidateTag("storefront-pages");
    revalidatePath("/");
    revalidatePath("/admin/pages");
    return {};
  });
}
