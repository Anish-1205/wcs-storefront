import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { getAllProducts } from "@/data/products";
import { DEFAULT_HOMEPAGE, homepageSchema, type HomepageContent } from "@/lib/homepage-content";
import { pageOverridesSchema, type PageContentMap } from "@/lib/page-content";
import { HomepageEditor } from "@/components/admin/HomepageEditor";
import { PageContentEditor } from "@/components/admin/PageContentEditor";

export const dynamic = "force-dynamic";

export default async function PagesDashboard() {
  const { admin } = await requireAdmin();
  const { data, error } = await admin.from("storefront_page_content").select("page, content, draft_content");
  const { data: versionRows } = await admin
    .from("storefront_page_content_versions").select("id, page, created_at").order("created_at", { ascending: false });

  const published: PageContentMap = {};
  const drafts: PageContentMap = {};
  let home = DEFAULT_HOMEPAGE;
  let homeDraft: HomepageContent | null = null;
  for (const row of data ?? []) {
    if (row.page === "home") {
      const live = homepageSchema.safeParse(row.content);
      if (live.success) home = live.data;
      const draft = homepageSchema.safeParse(row.draft_content);
      if (draft.success) homeDraft = draft.data;
      continue;
    }
    const live = pageOverridesSchema.safeParse(row.content);
    if (live.success) published[row.page] = live.data;
    const draft = pageOverridesSchema.safeParse(row.draft_content);
    if (draft.success) drafts[row.page] = draft.data;
  }
  const versions: Record<string, { id: string; created_at: string }[]> = {};
  for (const row of (versionRows ?? []) as { id: string; page: string; created_at: string }[]) {
    versions[row.page] = [...(versions[row.page] ?? []), { id: row.id, created_at: row.created_at }];
  }
  const products = getAllProducts().map(({ slug, title, images }) => ({ slug, title, image: images[0]?.src ?? "" }));

  return <div className="mx-auto max-w-7xl">
    <h1 className="font-serif text-3xl text-primary">Your website pages</h1>
    <p className="mb-2 mt-3 max-w-3xl text-base text-muted-foreground">
      Change the words, photos and arrangement of your public website. Everything you change is shown to you first,
      exactly as visitors will see it, and nothing goes live until you say so.
    </p>
    <p className="mb-6 max-w-3xl text-base text-muted-foreground">
      Looking for a saree’s own photos, description or price? Those live in <Link className="underline" href="/admin/products">Products</Link>.
    </p>
    <nav className="mb-8 flex flex-wrap gap-5 text-base">
      <Link className="underline" href="/admin/products">Saree details and photos</Link>
      <Link className="underline" href="/admin/storefront-availability">What is in stock</Link>
      <Link className="underline" href="/admin/collections">Collections</Link>
    </nav>
    <HomepageEditor initial={home} draft={homeDraft} products={products} versions={versions.home ?? []} available={!error} />
    <PageContentEditor initial={published} drafts={drafts} versions={versions} available={!error} />
  </div>;
}
