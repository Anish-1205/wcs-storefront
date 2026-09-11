import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { getAllProducts } from "@/data/products";
import { DEFAULT_HOMEPAGE, homepageSchema } from "@/lib/homepage-content";
import { pageOverridesSchema, type PageContentMap } from "@/lib/page-content";
import { HomepageEditor } from "@/components/admin/HomepageEditor";
import { PageContentEditor } from "@/components/admin/PageContentEditor";

export const dynamic = "force-dynamic";
export default async function PagesDashboard() {
  const { admin } = await requireAdmin();
  const { data, error } = await admin.from("storefront_page_content").select("page, content");
  const initial: PageContentMap = {};
  let home = DEFAULT_HOMEPAGE;
  for (const row of data ?? []) {
    if (row.page === "home") { const parsed = homepageSchema.safeParse(row.content); if (parsed.success) home = parsed.data; }
    else { const parsed = pageOverridesSchema.safeParse(row.content); if (parsed.success) initial[row.page] = parsed.data; }
  }
  return <div className="mx-auto max-w-7xl">
    <h1 className="font-serif text-3xl text-primary">Website pages</h1>
    <p className="mb-6 mt-3 text-base text-muted-foreground">Manage what visitors see while keeping the showroom layout and typography.</p>
    <nav className="mb-6 flex flex-wrap gap-5 text-base"><Link className="underline" href="/admin/products">Product details and media</Link><Link className="underline" href="/admin/storefront-availability">Availability</Link><Link className="underline" href="/admin/collections">Collections</Link></nav>
    <HomepageEditor initial={home} products={getAllProducts().map(({ slug, title }) => ({ slug, title }))} available={!error} />
    <PageContentEditor initial={initial} available={!error} />
  </div>;
}
