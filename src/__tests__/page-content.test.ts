import { describe, expect, it, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentRegion, PageContentProvider } from "@/components/content/ContentRegion";
import { DEFAULT_HOMEPAGE, homepageSchema } from "@/lib/homepage-content";
import { contentImageSchema } from "@/lib/page-content";
import { savePageContent } from "@/app/admin/page-content-actions";
import { revalidateTag } from "next/cache";

const assertAdmin = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: () => "/about" }));
vi.mock("@/lib/admin-auth", () => ({ assertAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

describe("page content", () => {
  beforeEach(() => vi.clearAllMocks());
  it("renders saved copy on the server and escapes markup", () => {
    const html = renderToStaticMarkup(createElement(PageContentProvider, {
      initial: { "/about": { "page:root.0": { kind: "text", value: "<script>changed</script>" } } },
    }, createElement(ContentRegion, { region: "page" }, createElement("h1", null, "Original"))));
    expect(html).toContain("&lt;script&gt;changed&lt;/script&gt;");
    expect(html).not.toContain("Original");
  });
  it("can replace images and hide sections without removing their editable content", () => {
    const html = renderToStaticMarkup(createElement(PageContentProvider, {
      initial: { "/about": { "page:root:section": { kind: "section", value: false }, "page:root.0:image": { kind: "image", value: "/media/new.jpg" } } },
    }, createElement(ContentRegion, { region: "page" }, createElement("section", null, createElement("img", { src: "/media/old.jpg", alt: "Saree" })))));
    expect(html).toContain("display:none");
    expect(html).toContain('/media/new.jpg');
  });
  it("rejects unsafe image locations and invalid homepage placement", () => {
    for (const url of ["javascript:alert(1)", "https://evil.example/photo.jpg", "/media/../secret", "//evil.example/photo.jpg"]) expect(contentImageSchema.safeParse(url).success).toBe(false);
    expect(homepageSchema.safeParse({ ...DEFAULT_HOMEPAGE, featuredSlugs: [DEFAULT_HOMEPAGE.heroSlug] }).success).toBe(false);
    expect(homepageSchema.safeParse({ ...DEFAULT_HOMEPAGE, sections: DEFAULT_HOMEPAGE.sections.map(() => DEFAULT_HOMEPAGE.sections[0]) }).success).toBe(false);
  });
  it("requires admin authentication before saving", async () => {
    assertAdmin.mockRejectedValue(new Error("Unauthorized"));
    expect(await savePageContent("/about", {})).toEqual({ ok: false, error: "Unauthorized" });
    expect(revalidateTag).not.toHaveBeenCalled();
  });
  it("persists validated overrides and invalidates rendered public pages", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    assertAdmin.mockResolvedValue({ admin: { from: () => ({ upsert }) } });
    const content = { "page:root.0": { kind: "text", value: "Our showroom" } };
    expect(await savePageContent("/about", content)).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ page: "/about", content }), { onConflict: "page" });
    expect(revalidateTag).toHaveBeenCalledWith("storefront-pages");
  });
  it("does not report success or invalidate content when the database write fails", async () => {
    assertAdmin.mockResolvedValue({ admin: { from: () => ({ upsert: async () => ({ error: { message: "missing table" } }) }) } });
    expect((await savePageContent("/about", {})).ok).toBe(false);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
