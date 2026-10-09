import type { MetadataRoute } from "next";
import { getCategories } from "@/data/products";
import { getLivePublicCatalog } from "@/lib/storefront-overrides";
import { getAllCollectionSlugs } from "@/data/collections";
import { getAllGuideSlugs } from "@/data/guides";
import { SITE } from "@/lib/site";
import { uncacheable } from "@/lib/no-cache-notice";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url.replace(/\/$/, "");
  // The live catalogue, not the file list — an admin-created product has a
  // real page and belongs in the sitemap, a hidden one no longer does.
  //
  // When visibility cannot be confirmed the catalogue comes back empty and
  // `confirmed` is false: the sitemap then lists only the URLs that do not
  // depend on which products are on show. Submitting a product URL for a
  // saree admin has taken down is worse than briefly omitting it, and
  // failing the whole sitemap over it would drop the static pages too.
  const { products, confirmed } = await getLivePublicCatalog();
  // A sitemap missing its product URLs must not be cached for an hour.
  if (!confirmed) await uncacheable();

  const legalRoutes = ["/privacy", "/terms", "/shipping-returns"];

  const staticRoutes: MetadataRoute.Sitemap = [
    "",
    "/catalog",
    "/collections",
    "/about",
    "/contact",
    ...legalRoutes,
  ].map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: path === "" ? 1 : legalRoutes.includes(path) ? 0.3 : 0.7,
  }));

  // Collections and guides are file-authored: their URLs exist whatever
  // Postgres says, so they stay in the sitemap during an outage.
  const catalogueRoutes: MetadataRoute.Sitemap = confirmed
    ? [
        ...getCategories(products).map((c) => ({
          url: `${base}/catalog/${c.slug}`,
          lastModified: new Date(),
          changeFrequency: "weekly" as const,
          priority: 0.8,
        })),
        ...products.map((p) => ({
          url: `${base}/sarees/${p.slug}`,
          lastModified: new Date(),
          changeFrequency: "weekly" as const,
          priority: 0.9,
        })),
      ]
    : [];

  const dynamicRoutes: MetadataRoute.Sitemap = [
    ...catalogueRoutes,
    ...getAllCollectionSlugs().map((slug) => ({
      url: `${base}/collections/${slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...getAllGuideSlugs().map((slug) => ({
      url: `${base}/guides/${slug}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];

  return [...staticRoutes, ...dynamicRoutes];
}
