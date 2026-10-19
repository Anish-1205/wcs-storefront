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

/**
 * Fire an event at most once per key per page (T4.1): a product view or an
 * enquiry start counts once however often a component re-renders. The key
 * includes the path, so moving to another page counts again.
 */
const fired = new Set<string>();
export function trackOnce(key: string, fire: () => void): void {
  const page = typeof window === "undefined" ? "" : window.location?.pathname ?? "";
  const full = `${key}@${page}`;
  if (fired.has(full)) return;
  fired.add(full);
  fire();
}

/** Test seam. */
export function resetTrackOnce(): void {
  fired.clear();
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
  }) => trackEvent("whatsapp_click", { ...p, placement: p.source_page }),
  /** Fired only after the server confirmed the enquiry; also GA4's `generate_lead` (T4.1). */
  inquirySubmit: (p: { inquiry_type: string; source: string }) => {
    trackEvent("inquiry_submit", p);
    trackEvent("generate_lead", { inquiry_type: p.inquiry_type, lead_source: p.source });
  },
  // ── Funnel (T4.1): view → add to enquiry → start enquiry → lead ──
  viewItem: (p: { item_id: string; item_name: string; item_category?: string }) =>
    trackOnce(`view_item:${p.item_id}`, () => {
      trackEvent("view_item", p);
      trackPinterest("viewitem", { product_id: p.item_id });
    }),
  addToEnquiryCart: (p: { item_id: string; item_name: string; quantity: number }) =>
    trackEvent("add_to_enquiry_cart", p),
  enquiryStart: (p: { placement: string }) =>
    trackOnce(`enquiry_start:${p.placement}`, () => trackEvent("enquiry_start", p)),
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
