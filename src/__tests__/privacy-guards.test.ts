import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { analytics, trackEvent } from "@/lib/analytics";
import { beforeSend } from "@/lib/sentry-options";

afterEach(() => vi.unstubAllGlobals());

describe("no personal data in analytics events (T3.12)", () => {
  it("drops any parameter that is not on the allowlist", () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag });
    trackEvent("inquiry_submit", { inquiry_type: "product", source: "instagram", phone: "919876543210", email: "a@b.co", message: "hi", name_of_customer: "Asha" });
    expect(gtag).toHaveBeenCalledWith("event", "inquiry_submit", { inquiry_type: "product", source: "instagram" });
  });

  it("the named events only send what they declare", () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag });
    analytics.whatsappClick({ product_id: "p1", source_page: "product", variant_color: "red" });
    analytics.subscriberOptIn({ source: "footer" });
    for (const [, , params] of gtag.mock.calls) {
      expect(Object.keys(params as object).every((k) => !/phone|mail|message|address/.test(k))).toBe(true);
    }
  });
});

describe("no personal data in Sentry events (T3.12)", () => {
  it("redacts personal keys and patterns in extra, and drops request bodies and cookies", () => {
    const event = {
      extra: { scope: "inquiry", phone: "919876543210", note: "call +91 98765 43210", productId: "p1" },
      request: { url: "https://x/api/inquiries", data: '{"phone":"919876543210"}', cookies: { sb: "token" } },
    } as unknown as ErrorEvent;
    const out = beforeSend(event)!;
    expect(out.extra).toEqual({ scope: "inquiry", phone: "[personal]", note: "[personal]", productId: "p1" });
    expect(out.request?.data).toBe("[omitted]");
    expect(out.request?.cookies).toBeUndefined();
  });
});
