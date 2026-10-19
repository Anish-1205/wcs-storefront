import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analytics, resetTrackOnce } from "@/lib/analytics";

let gtag: ReturnType<typeof vi.fn>;
const location = { pathname: "/sarees/red-saree" };
beforeEach(() => {
  resetTrackOnce();
  gtag = vi.fn();
  vi.stubGlobal("window", { gtag, location });
});
afterEach(() => vi.unstubAllGlobals());

const events = () => gtag.mock.calls.map(([, name, params]) => [name, params]);

describe("GA4 funnel events (T4.1)", () => {
  it("view_item fires once per product page, however often it renders", () => {
    for (let i = 0; i < 3; i++) analytics.viewItem({ item_id: "red-saree", item_name: "Red Saree", item_category: "Silk" });
    expect(events()).toEqual([["view_item", { item_id: "red-saree", item_name: "Red Saree", item_category: "Silk" }]]);
    location.pathname = "/sarees/blue-saree";
    analytics.viewItem({ item_id: "blue-saree", item_name: "Blue Saree" });
    expect(events()).toHaveLength(2);
    location.pathname = "/sarees/red-saree";
  });

  it("enquiry_start fires on the first focus only", () => {
    analytics.enquiryStart({ placement: "enquiry_page" });
    analytics.enquiryStart({ placement: "enquiry_page" });
    expect(events()).toEqual([["enquiry_start", { placement: "enquiry_page" }]]);
  });

  it("add_to_enquiry_cart carries the item and quantity", () => {
    analytics.addToEnquiryCart({ item_id: "red-saree", item_name: "Red Saree", quantity: 2 });
    expect(events()).toEqual([["add_to_enquiry_cart", { item_id: "red-saree", item_name: "Red Saree", quantity: 2 }]]);
  });

  it("a confirmed enquiry is also GA4's generate_lead, with no personal data", () => {
    analytics.inquirySubmit({ inquiry_type: "retail", source: "instagram" });
    expect(events()).toEqual([
      ["inquiry_submit", { inquiry_type: "retail", source: "instagram" }],
      ["generate_lead", { inquiry_type: "retail", lead_source: "instagram" }],
    ]);
  });

  it("whatsapp_click says where on the page it came from", () => {
    analytics.whatsappClick({ product_id: "red-saree", source_page: "product" });
    expect(events()[0][1]).toMatchObject({ placement: "product", source_page: "product" });
  });
});
