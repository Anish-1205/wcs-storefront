import { expect, test } from "@playwright/test";
import { SITE } from "../src/lib/site";

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
  await expect(page.getByRole("link", { name: /Ask About This Piece/ }).first()).toBeVisible();
});
