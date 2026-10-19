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

/**
 * The only parameter names an analytics event may carry (T3.12): product,
 * catalogue and attribution fields. Nothing a customer types (name, phone,
 * e-mail, message) can reach GA4 or Pinterest, whatever a caller passes;
 * unknown keys are dropped.
 */
export const ALLOWED_EVENT_PARAMS = new Set([
  "product_id", "name", "category", "color", "variant_color", "source_page", "source",
  "inquiry_type", "collection_name", "filter_type", "value", "placement", "item_id",
  "item_name", "item_category", "currency", "quantity", "lead_source", "method",
]);

export function allowedParams(params: GtagEventParams): GtagEventParams {
  return Object.fromEntries(Object.entries(params).filter(([key]) => ALLOWED_EVENT_PARAMS.has(key)));
}

/** Fire a GA4 custom event. */
export function trackEvent(name: string, params: GtagEventParams = {}): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", name, allowedParams(params));
}

/** Fire a Pinterest Tag event. */
export function trackPinterest(
  name: "pagevisit" | "viewcategory" | "viewitem" | "custom",
  params: GtagEventParams = {},
): void {
  if (typeof window === "undefined" || typeof window.pintrk !== "function") return;
  window.pintrk("track", name, allowedParams(params));
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
