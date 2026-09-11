import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/server";
import { DEFAULT_HOMEPAGE, homepageSchema } from "@/lib/homepage-content";

export const getHomepageContent = unstable_cache(async () => {
  try {
    const { data, error } = await createPublicClient().from("storefront_page_content").select("content").eq("page", "home").maybeSingle();
    if (error || !data) return DEFAULT_HOMEPAGE;
    const parsed = homepageSchema.safeParse(data.content);
    return parsed.success ? parsed.data : DEFAULT_HOMEPAGE;
  } catch { return DEFAULT_HOMEPAGE; }
}, ["storefront-homepage"], { tags: ["storefront-pages"], revalidate: 60 });
