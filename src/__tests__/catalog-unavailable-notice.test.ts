import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The notice the storefront shows when it cannot establish product
 * visibility. It answers with a 200 (a Server Component cannot set a status),
 * so the `robots` meta is what stops a crawl during an outage storing
 * "briefly unavailable" as the page's content.
 *
 * `next/link` needs the router context a real Next render provides, so it is
 * stood in for by a plain anchor here; nothing under test depends on it.
 */
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

import { CatalogUnavailable } from "@/components/catalog/CatalogUnavailable";

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(CatalogUnavailable, props));

describe("the catalogue-unavailable notice", () => {
  it("tells crawlers not to index it", () => {
    expect(render()).toContain('<meta name="robots" content="noindex, nofollow"/>');
  });

  it("still tells the visitor what is going on, and keeps a way to reach us", () => {
    const html = render();

    expect(html).toContain("briefly unavailable");
    expect(html).toContain("try again in a few minutes");
    // Either the WhatsApp CTA or the /contact fallback, depending on config.
    expect(/wa\.me|href="\/contact"/.test(html)).toBe(true);
  });

  it("carries the noindex on every surface's wording, not just the default", () => {
    const html = render({
      heading: "This piece can’t be shown right now",
      children: createElement("p", null, "We can’t confirm whether this saree is on show."),
    });

    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(html).toContain("This piece can’t be shown right now");
    expect(html).toContain("whether this saree is on show");
  });

  it("names no product and claims nothing about stock", () => {
    const html = render();

    expect(html).not.toMatch(/in stock|sold out|available now/i);
  });
});
