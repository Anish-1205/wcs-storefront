"use client";

import { useEffect } from "react";
import { analytics } from "@/lib/analytics";

/** GA4 `view_item`, once per product page view (T4.1). Renders nothing. */
export function ProductViewTracker({ slug, title, category }: { slug: string; title: string; category?: string }) {
  useEffect(() => {
    analytics.viewItem({ item_id: slug, item_name: title, item_category: category });
  }, [slug, title, category]);
  return null;
}
