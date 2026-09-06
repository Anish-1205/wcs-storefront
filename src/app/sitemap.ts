import type { MetadataRoute } from "next";
import { getAllSlugs, getCategories } from "@/data/products";
import { getAllCollectionSlugs } from "@/data/collections";
import { getAllGuideSlugs } from "@/data/guides";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE.url.replace(/\/$/, "");

  const legalRoutes = ["/privacy", "/terms", "/shipping-returns"];

  const staticRoutes: MetadataRoute.Sitemap = [
    "",
    "/catalog",
    "/collections",
    "/about",
    "/wholesale",
    "/contact",
    ...legalRoutes,
  ].map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: path === "" ? 1 : legalRoutes.includes(path) ? 0.3 : 0.7,
  }));

  const dynamicRoutes: MetadataRoute.Sitemap = [
    ...getCategories().map((c) => ({
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
    ...getAllSlugs().map((slug) => ({
      url: `${base}/sarees/${slug}`,
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
