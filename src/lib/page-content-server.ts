import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/server";
import { pageOverridesSchema, type PageContentMap } from "@/lib/page-content";

export const getPageContent = unstable_cache(async (): Promise<PageContentMap> => {
  try {
    const { data, error } = await createPublicClient().from("storefront_page_content").select("page, content").neq("page", "home");
    if (error) return {};
    return Object.fromEntries((data ?? []).flatMap((row) => {
      const parsed = pageOverridesSchema.safeParse(row.content);
      return parsed.success ? [[row.page, parsed.data]] : [];
    }));
  } catch { return {}; }
}, ["storefront-page-content"], { tags: ["storefront-pages"], revalidate: 60 });
