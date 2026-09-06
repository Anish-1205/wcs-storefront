import { SITE } from "@/lib/site";

export interface BreadcrumbItem {
  name: string;
  /** Root-relative path, e.g. "/catalog/pink". */
  path: string;
}

/**
 * Builds a schema.org BreadcrumbList from the same trail already rendered as
 * visible nav links on the page — never a separate, invented hierarchy.
 */
export function breadcrumbList(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE.url}${item.path}`,
    })),
  };
}
