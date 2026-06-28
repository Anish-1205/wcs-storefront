import type { MetadataRoute } from "next";
import {
  getAllPublishedSlugs,
  getCategories,
  getActiveCollections,
} from "@/lib/queries";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url.replace(/\/$/, "");

  const staticRoutes: MetadataRoute.Sitemap = [
    "",
    "/catalog",
    "/about",
    "/wholesale",
    "/contact",
  ].map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.7,
  }));

  let dynamicRoutes: MetadataRoute.Sitemap = [];
  try {
    const [slugs, categories, collections] = await Promise.all([
      getAllPublishedSlugs(),
      getCategories(),
      getActiveCollections(),
    ]);

    dynamicRoutes = [
      ...categories.map((c) => ({
        url: `${base}/catalog/${c.slug}`,
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
      ...collections.map((c) => ({
        url: `${base}/collections/${c.slug}`,
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
      ...slugs.map((slug) => ({
        url: `${base}/sarees/${slug}`,
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.9,
      })),
    ];
  } catch {
    // DB unavailable at build — fall back to static routes only.
  }

  return [...staticRoutes, ...dynamicRoutes];
}
