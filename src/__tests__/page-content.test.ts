import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentRegion, PageContentProvider } from "@/components/content/ContentRegion";
import { DEFAULT_HOMEPAGE, homepageSchema } from "@/lib/homepage-content";
import { contentImageSchema, fieldHint, regionLabel } from "@/lib/page-content";
import { publishPageContent, restorePageVersion, savePageDraft } from "@/app/admin/page-content-actions";
import { revalidateTag } from "next/cache";

const assertAdmin = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: () => "/about" }));
vi.mock("@/lib/admin-auth", () => ({ assertAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

type FakeRows = { live?: unknown; version?: unknown; upsertError?: boolean };
/** Chainable stand-in for the PostgREST builder, recording what was written. */
function fakeAdmin({ live, version, upsertError }: FakeRows = {}) {
  const upserts: Record<string, unknown>[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const inserts: Record<string, unknown>[] = [];
  const deletes: string[] = [];
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { error: upsertError ? { message: "missing function" } : null };
    },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self, eq: self, order: self, limit: self,
        not: (_column: string, _op: string, value: string) => { deletes.push(value); return chain; },
        delete: self,
        insert: (row: Record<string, unknown>) => { inserts.push({ table, ...row }); return Promise.resolve({ error: null }); },
        upsert: (row: Record<string, unknown>, options: unknown) => {
          upserts.push({ table, options, ...row });
          return Promise.resolve({ error: upsertError ? { message: "missing table" } : null });
        },
        maybeSingle: async () => ({
          data: table === "storefront_page_content_versions"
            ? (version === undefined ? null : { content: version })
            : (live === undefined ? null : { content: live }),
        }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
      });
      return chain;
    },
  };
  return { admin, upserts, inserts, deletes, rpcCalls };
}

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
    expect(html).toContain("/media/new.jpg");
  });

  it("rejects unsafe image locations and invalid homepage placement", () => {
    for (const url of ["javascript:alert(1)", "https://evil.example/photo.jpg", "/media/../secret", "//evil.example/photo.jpg"]) expect(contentImageSchema.safeParse(url).success).toBe(false);
    expect(homepageSchema.safeParse({ ...DEFAULT_HOMEPAGE, featuredSlugs: [DEFAULT_HOMEPAGE.heroSlug] }).success).toBe(false);
    expect(homepageSchema.safeParse({ ...DEFAULT_HOMEPAGE, sections: DEFAULT_HOMEPAGE.sections.map(() => DEFAULT_HOMEPAGE.sections[0]) }).success).toBe(false);
  });

  it("describes every field in plain language, with no code identifiers", () => {
    expect(regionLabel("HomeHero:root.0").label).toBe("Homepage banner");
    expect(regionLabel("Navbar:root").label).toBe("Top menu bar");
    const hint = fieldHint({ key: "page:root.0", scope: "/about", kind: "section", label: "Section 1", value: true });
    expect(hint).toContain("hide");
    expect(fieldHint({ key: "page:root.0", scope: "/about", kind: "text", label: "Hello", value: "Hello" })).toMatch(/few words/);
  });

  it("requires admin authentication before saving, publishing or restoring", async () => {
    assertAdmin.mockRejectedValue(new Error("Unauthorized"));
    expect(await savePageDraft("/about", {})).toEqual({ ok: false, error: "Unauthorized" });
    expect(await publishPageContent("/about", {})).toEqual({ ok: false, error: "Unauthorized" });
    expect(await restorePageVersion("/about", "00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, error: "Unauthorized" });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("keeps a saved draft off the public website", async () => {
    const live = { "page:root.0": { kind: "text", value: "Published wording" } };
    const { admin, upserts, rpcCalls } = fakeAdmin({ live });
    assertAdmin.mockResolvedValue({ admin });
    const draft = { "page:root.0": { kind: "text", value: "Work in progress" } };
    expect(await savePageDraft("/about", draft)).toEqual({ ok: true });
    // Draft saving goes only through the draft-only function, with no write path
    // of its own to the live content column.
    expect(rpcCalls).toEqual([{ name: "save_storefront_page_draft", args: { p_page: "/about", p_draft: draft } }]);
    expect(upserts).toEqual([]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("F14 never sends live content when saving the very first homepage draft", async () => {
    const { admin, upserts, rpcCalls } = fakeAdmin();
    assertAdmin.mockResolvedValue({ admin });
    expect(await savePageDraft("home", { ...DEFAULT_HOMEPAGE, heroTitle: "Private unfinished headline" })).toEqual({ ok: true });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("save_storefront_page_draft");
    expect(Object.keys(rpcCalls[0].args).sort()).toEqual(["p_draft", "p_page"]);
    expect(rpcCalls[0].args.p_draft).toMatchObject({ heroTitle: "Private unfinished headline" });
    expect(upserts).toEqual([]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("F14 the shipped draft function inserts no published content and only updates the draft", () => {
    const sql = readFileSync("supabase/migrations/026_draft_only_page_rows.sql", "utf8");
    // Published content must be representable as absent, not as a synthetic object.
    expect(sql).toMatch(/alter column content drop not null/i);
    const body = sql.slice(sql.indexOf("create or replace function public.save_storefront_page_draft"));
    const insert = body.slice(body.indexOf("insert into"), body.indexOf("on conflict"));
    expect(insert).toMatch(/values\s*\(p_page,\s*null,\s*p_draft/i);
    const update = body.slice(body.indexOf("on conflict"), body.indexOf("$$;"));
    expect(update).toMatch(/set draft_content = excluded\.draft_content, updated_at = excluded\.updated_at/);
    // ...and nothing else: in particular not the live `content` column.
    expect(update).not.toMatch(/(^|[^_\w])content\s*=/);
  });

  it("publishes validated content, keeps the previous version and refreshes public pages", async () => {
    const live = { "page:root.0": { kind: "text", value: "Old wording" } };
    const { admin, upserts, inserts } = fakeAdmin({ live });
    assertAdmin.mockResolvedValue({ admin });
    const content = { "page:root.0": { kind: "text", value: "Our showroom" } };
    expect(await publishPageContent("/about", content)).toEqual({ ok: true });
    expect(inserts[0]).toMatchObject({ table: "storefront_page_content_versions", page: "/about", content: live });
    expect(upserts[0]).toMatchObject({ page: "/about", content, draft_content: content, options: { onConflict: "page" } });
    expect(revalidateTag).toHaveBeenCalledWith("storefront-pages");
  });

  it("puts an earlier version back on the website", async () => {
    const version = { "page:root.0": { kind: "text", value: "Wording from before" } };
    const { admin, upserts } = fakeAdmin({ live: {}, version });
    assertAdmin.mockResolvedValue({ admin });
    const result = await restorePageVersion("/about", "11111111-1111-4111-8111-111111111111");
    expect(result).toMatchObject({ ok: true, content: version });
    expect(upserts[0]).toMatchObject({ page: "/about", content: version, draft_content: version });
    expect(revalidateTag).toHaveBeenCalledWith("storefront-pages");
  });

  it("refuses a version that is gone and rejects invented page paths", async () => {
    const { admin } = fakeAdmin({ live: {} });
    assertAdmin.mockResolvedValue({ admin });
    expect((await restorePageVersion("/about", "22222222-2222-4222-8222-222222222222")).ok).toBe(false);
    expect((await publishPageContent("/not-a-page", {})).ok).toBe(false);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("does not report success or invalidate content when the database write fails", async () => {
    const { admin } = fakeAdmin({ live: {}, upsertError: true });
    assertAdmin.mockResolvedValue({ admin });
    expect((await publishPageContent("/about", {})).ok).toBe(false);
    expect((await savePageDraft("/about", {})).ok).toBe(false);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
