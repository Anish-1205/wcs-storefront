// GA4 + Pinterest Tag event helpers.
// All events are no-ops when the respective tag id is not configured,
// so the app runs cleanly in local dev.

type GtagEventParams = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    pintrk?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
  }
}

/** Fire a GA4 custom event. */
export function trackEvent(name: string, params: GtagEventParams = {}): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
}

/** Fire a Pinterest Tag event. */
export function trackPinterest(
  name: "pagevisit" | "viewcategory" | "viewitem" | "custom",
  params: GtagEventParams = {},
): void {
  if (typeof window === "undefined" || typeof window.pintrk !== "function") return;
  window.pintrk("track", name, params);
}

// ── Named events from the analytics plan ──────────────────────────

export const analytics = {
  productView: (p: { product_id: string; name: string; category?: string }) => {
    trackEvent("product_view", p);
    trackPinterest("viewitem", { product_id: p.product_id });
  },
  variantSelect: (p: { product_id: string; color: string }) =>
    trackEvent("variant_select", p),
  whatsappClick: (p: {
    product_id?: string;
    source_page: string;
    variant_color?: string;
  }) => trackEvent("whatsapp_click", p),
  inquirySubmit: (p: { inquiry_type: string; source: string }) =>
    trackEvent("inquiry_submit", p),
  subscriberOptIn: (p: { source: string }) =>
    trackEvent("subscriber_opt_in", p),
  collectionView: (p: { collection_name: string }) => {
    trackEvent("collection_view", p);
    trackPinterest("viewcategory", p);
  },
  catalogFilter: (p: { filter_type: string; value: string }) =>
    trackEvent("catalog_filter", p),
  pinterestShare: (p: { product_id: string }) =>
    trackEvent("pinterest_share", p),
};
