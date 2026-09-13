import type { MetadataRoute } from "next";
import { getCategories } from "@/data/products";
import { getLiveProducts } from "@/lib/storefront-overrides";
import { getAllCollectionSlugs } from "@/data/collections";
import { getAllGuideSlugs } from "@/data/guides";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url.replace(/\/$/, "");
  // The live catalogue, not the file list — an admin-created product has a
  // real page and belongs in the sitemap, a hidden one no longer does.
  const products = await getLiveProducts();

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

  const dynamicRoutes: MetadataRoute.Sitemap = [
    ...getCategories(products).map((c) => ({
      url: `${base}/catalog/${c.slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...getAllCollectionSlugs().map((slug) => ({
      url: `${base}/collections/${slug}`,
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
    ...getAllGuideSlugs().map((slug) => ({
      url: `${base}/guides/${slug}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];

  return [...staticRoutes, ...dynamicRoutes];
}
