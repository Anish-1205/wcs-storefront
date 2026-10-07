import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";

const assertAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-auth", () => ({ assertAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(), ExpectedError: class extends Error {} }));

import { markProductReviewed } from "@/app/admin/whatsapp-draft-actions";
import { HiddenMediaTray } from "@/components/admin/HiddenMediaTray";
import { ImageUploader } from "@/components/admin/ImageUploader";
import { WhatsAppDraftPanel } from "@/components/admin/WhatsAppDraftPanel";
import { cld, cldVideoThumbnail } from "@/lib/cloudinary";
import { explainGrouping, reviewReasonText, type AuditRow } from "@/lib/whatsapp-draft";

const PRODUCT = "a62fcb7a-fccc-463c-8ab2-3dba81e3a7aa";
const media = (reason: string, confidence: string, seconds: number, extra: Partial<AuditRow> = {}): AuditRow => ({
  mode: "media", kind: "image", assignment_reason: reason, confidence, decided_by: null, seconds_before_description: seconds,
  close_reason: "photos_first", summary: "8 sent before your description", ...extra,
});
const description: AuditRow = { mode: "finalize", kind: null, assignment_reason: null, confidence: null, decided_by: null, seconds_before_description: 0, close_reason: "photos_first", summary: null };

describe("needs_review reasons", () => {
  it("are shown as sentences, including the price flags", () => {
    expect(reviewReasonText("price_missing")).toBe("No price was given");
    expect(reviewReasonText("late_description")).toBe("The description came a while after the photos");
    expect(reviewReasonText("two_prices")).toBe("Two different prices were found, so the price was left empty");
    expect(reviewReasonText("something_new")).toBe("something new"); // an unknown code is shown, not hidden
  });
});

describe("why grouped", () => {
  it("summarises the signals and their confidence from the audit rows", () => {
    const rows = [description, ...Array.from({ length: 8 }, (_, i) => media("late_description", "late", 18 + i)), media("ai_match", "ai", 60, { decided_by: "ai" })];
    expect(explainGrouping(rows)).toEqual({
      headline: "Photos first, then the description.",
      signals: [
        { signal: "Sent earlier; the description came late", count: 8, confidence: "Medium", timing: "18-25s before the description" },
        { signal: "Matched to the description from the photos", count: 1, confidence: "AI", timing: "60s before the description" },
      ],
    });
  });

  it("handles media sent after, and around, the description", () => {
    expect(explainGrouping([media("after_description", "high", -20), media("after_description", "high", -22)])!.signals[0].timing).toBe("20-22s after the description");
    expect(explainGrouping([media("same_forward", "high", 2), media("same_forward", "high", -1)])!.signals[0].timing).toBe("from 2s before to 1s after the description");
  });

  it("is nothing for a product that did not come from WhatsApp", () => {
    expect(explainGrouping([])).toBeNull();
    expect(explainGrouping([description])).toBeNull();
  });
});

describe("the WhatsApp panel on the product page", () => {
  const render = (props: Partial<Parameters<typeof WhatsAppDraftPanel>[0]> = {}) =>
    renderToStaticMarkup(createElement(WhatsAppDraftPanel, { productId: PRODUCT, needsReview: false, reasons: [], sourceText: null, audit: [], ...props }));

  it("renders nothing for an ordinary product", () => {
    expect(render()).toBe("");
  });

  it("shows the badge, the reasons, the source text and why the photos were grouped", () => {
    const html = render({
      needsReview: true, reasons: ["price_missing", "late_description"],
      sourceText: "Tissue sarees 2 pcs combo\nwhatsapp 9876543210 <script>alert(1)</script>",
      audit: [description, media("before_description", "high", 6), media("before_description", "high", 7)],
    });
    expect(html).toContain("Needs review");
    expect(html).toContain("Mark as reviewed");
    expect(html).toContain("No price was given");
    expect(html).toContain("The description came a while after the photos");
    expect(html).toContain("whatsapp 9876543210");
    expect(html).toContain("&lt;script&gt;"); // text, never markup
    expect(html).not.toContain("<script>");
    expect(html).toContain("Sent just before the description");
    expect(html).toContain("6-7s before the description");
    expect(html).toContain("Customers never see this text");
  });

  it("keeps the reasons as a record once reviewed, without the badge or the button", () => {
    const html = render({ needsReview: false, reasons: ["fabric_missing"] });
    expect(html).toContain("No fabric was mentioned");
    expect(html).not.toContain("Needs review");
    expect(html).not.toContain("Mark as reviewed");
  });
});

describe("image rendering is unchanged by the labels and the tray", () => {
  const images = [
    { image_url: "https://res.cloudinary.com/demo/image/upload/v1/whatsapp/inbox/cover.jpg", is_primary: true, display_order: 1, media_type: "image" as const },
    { image_url: "https://res.cloudinary.com/demo/image/upload/v1/whatsapp/inbox/collage.jpg", is_primary: false, display_order: 2, media_type: "image" as const },
    { image_url: "https://res.cloudinary.com/demo/video/upload/v1/whatsapp/inbox/clip.mp4", is_primary: false, display_order: 3, media_type: "video" as const },
  ];
  const uploader = (labels?: Record<string, string>) => renderToStaticMarkup(createElement(ImageUploader, {
    images, onChange: () => {}, dragId: "variant-1", onExternalImageDrop: () => {}, ...(labels ? { labels } : {}),
  }));
  const sources = (html: string) => [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));

  it("every thumbnail is still requested from Cloudinary exactly as before", () => {
    const plain = uploader();
    expect(sources(plain)).toEqual([cld(images[0].image_url, "thumbnail"), cld(images[1].image_url, "thumbnail"), cldVideoThumbnail(images[2].image_url)]);
    // Adding labels changes no <img>: same sources, same order.
    const labelled = uploader({ [images[1].image_url]: "All colours" });
    expect(sources(labelled)).toEqual(sources(plain));
    expect(labelled.replace(/<span[^>]*data-testid="media-label"[^>]*>.*?<\/span>/, "")).toBe(plain);
  });

  it("tags the collage 'All colours', and never covers the Primary tag", () => {
    const html = uploader({ [images[1].image_url]: "All colours", [images[0].image_url]: "All colours" });
    expect(html.match(/data-testid="media-label"/g)).toHaveLength(1);
    expect(html).toContain(">All colours<");
    expect(html).toContain(">Primary<");
    expect(html).toContain(">Video<");
  });

  it("the hidden tray shows its count and a thumbnail per item, a video as its poster frame", () => {
    const html = renderToStaticMarkup(createElement(HiddenMediaTray, { items: [
      { id: "1", image_url: images[1].image_url, media_type: "image", reason: "duplicate" },
      { id: "2", image_url: images[2].image_url, media_type: "video", reason: "over_limit" },
    ] }));
    expect(html).toContain("Hidden images (2)");
    expect(sources(html)).toEqual([cld(images[1].image_url, "thumbnail"), cldVideoThumbnail(images[2].image_url)]);
    expect(html).toContain("Same photo sent twice");
    expect(html).toContain("Extra, over the photo limit");
    expect(html.match(/>Restore</g)).toHaveLength(2);
    expect(renderToStaticMarkup(createElement(HiddenMediaTray, { items: [] }))).toBe("");
  });
});

describe("marking a draft as reviewed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears the flag and nothing else", async () => {
    const updates: unknown[] = [];
    assertAdmin.mockResolvedValue({ admin: { from: (table: string) => ({ update: (values: unknown) => ({ eq: async (column: string, value: string) => { updates.push([table, values, column, value]); return { error: null }; } }) }) } });
    expect(await markProductReviewed(PRODUCT)).toEqual({ ok: true });
    expect(updates).toEqual([["products", { needs_review: false }, "id", PRODUCT]]);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/products/${PRODUCT}`);
  });

  it("requires an admin and a real id", async () => {
    assertAdmin.mockResolvedValue({ admin: { from: () => { throw new Error("should not be reached"); } } });
    expect(await markProductReviewed("nope")).toEqual({ ok: false, error: "That item could not be found." });
    assertAdmin.mockRejectedValue(new Error("Not authorised"));
    expect(await markProductReviewed(PRODUCT)).toEqual({ ok: false, error: "Not authorised" });
  });
});
