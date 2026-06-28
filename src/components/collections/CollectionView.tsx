"use client";

import { useEffect } from "react";
import { analytics } from "@/lib/analytics";

/** Fires the collection_view analytics event once on mount. Renders nothing. */
export function CollectionView({ name }: { name: string }) {
  useEffect(() => {
    analytics.collectionView({ collection_name: name });
  }, [name]);
  return null;
}
