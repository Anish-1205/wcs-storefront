import { expect, test } from "@playwright/test";
import { SITE } from "../src/lib/site";
import { PRODUCTS, getFeaturedProducts } from "../src/data/products";
import { HERO } from "../src/lib/site";

test("navbar brand mark links home and is the only banner home link", async ({ page }) => {
  await page.goto("/");
  const home = page.getByRole("banner").getByRole("link", { name: SITE.name });
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute("href", "/");
  await expect(home.locator("img").first()).toBeVisible();
  // The redundant lucide "Home" icon link was removed — the mark is the only one.
  await expect(
    page.getByRole("banner").getByRole("link", { name: new RegExp(`^(home|${SITE.name})$`, "i") }),
  ).toHaveCount(1);
});

test("public conversion routes render", async ({ page }) => {
  for (const path of ["/", "/catalog", "/about", "/contact", "/privacy", "/terms", "/shipping-returns"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator("h1").first(), path).toBeVisible();
  }
});

test("mobile homepage has no horizontal overflow and one floating WhatsApp control", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  await expect(page.getByRole("link", { name: "Speak to us on WhatsApp" })).toHaveCount(1);

  const menu = page.getByRole("button", { name: "Open menu" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole("banner").getByRole("link", { name: "Contact", exact: true })).toBeVisible();
});

test("catalog colour + availability filters update the URL", async ({ page }) => {
  await page.goto("/catalog");

  // The filter bar renders each facet as a label span + option buttons
  // (src/components/catalog/CatalogFilterBar.tsx). Scope to the innermost
  // div carrying the facet label so product cards can't shadow the match.
  const colour = page.locator("div").filter({ has: page.getByText("Colour", { exact: true }) }).last();
  await colour.getByRole("button", { name: "Blue" }).click();
  await expect(page).toHaveURL(/[?&]category=blue/);

  const availability = page.locator("div").filter({ has: page.getByText("Availability", { exact: true }) }).last();
  await availability.getByRole("button", { name: "Available now" }).click();
  await expect(page).toHaveURL(/[?&]availability=available/);

  // Clicking the same colour option again clears it (toggle behaviour).
  await colour.getByRole("button", { name: "Blue" }).click();
  await expect(page).not.toHaveURL(/category=blue/);
});

test("admin dashboard requires authentication", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login\?redirect=%2Fadmin/);
});

test("product page keeps a WhatsApp CTA after switching colour swatch", async ({ page }) => {
  await page.goto("/catalog");
  const firstProduct = page.locator('a[href^="/sarees/"]').first();
  await expect(firstProduct).toBeVisible();
  await firstProduct.click();
  await page.waitForURL(/\/sarees\//);

  // Derived colour swatches under the media viewer (ColourVariantRow) — only
  // present for products with a colour range, so guard on the count.
  const swatches = page.locator("button[aria-pressed]");
  if ((await swatches.count()) > 1) {
    await swatches.nth(1).click();
    await expect(swatches.nth(1)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByRole("link", { name: /Ask on WhatsApp|Ask about this saree/ }).first()).toBeVisible();
});

for (const width of [320, 390, 768, 1280]) {
  test(`complete shelf and bounded cards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const hero = HERO.href.split("/").pop();
    const selection = getFeaturedProducts(5).filter((p) => p.slug !== hero).slice(0, 4);
    const shown = new Set([hero, ...selection.map((p) => p.slug)]);
    const expected = PRODUCTS.filter((p) => !shown.has(p.slug)).map((p) => `/sarees/${p.slug}`).sort();
    const shelf = page.getByTestId("shelf-grid");
    const cards = shelf.locator(".saree-card");
    expect((await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))).sort()).toEqual(expected);
    for (const card of await cards.all()) await expect(card).toBeVisible();
    const boxes = await cards.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.querySelector("img")!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    expect(boxes[0].y).toBe(boxes[1].y);
    expect(boxes[0].width).toBeLessThan(width / 2);
    expect(boxes[0].height).toBeLessThan(500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width < 768) {
      await cards.first().click();
      const stage = page.locator(".product-stage");
      await expect(stage).toBeVisible();
      expect((await stage.boundingBox())!.height).toBeLessThanOrEqual(405.2);
      const ask = page.getByRole("link", { name: /Ask on WhatsApp|Ask about this saree/ }).first();
      expect((await ask.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
