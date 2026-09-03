import { expect, test } from "@playwright/test";

test("public conversion routes render", async ({ page }) => {
  for (const path of ["/", "/catalog", "/about", "/wholesale", "/contact", "/privacy", "/terms", "/shipping-returns"]) {
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
  await expect(page.getByRole("link", { name: "Chat with us on WhatsApp" })).toHaveCount(1);

  const menu = page.getByRole("button", { name: "Open menu" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole("banner").getByRole("link", { name: "Wholesale", exact: true })).toBeVisible();
});

test("catalog filters update the URL", async ({ page }) => {
  await page.goto("/catalog");
  await page.getByLabel("Fabric").selectOption("Silk");
  await expect(page).toHaveURL(/fabric=Silk/);
  await page.getByLabel("Price").selectOption("-5000");
  await expect(page).toHaveURL(/maxPrice=5000/);
});

test("admin dashboard requires authentication", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login\?redirect=%2Fadmin/);
});

test("product variants update selection and retain a WhatsApp CTA", async ({ page }) => {
  await page.goto("/catalog");
  const firstProduct = page.locator('a[href^="/sarees/"]').first();
  await expect(firstProduct).toBeVisible();
  await firstProduct.click();
  const swatches = page.locator('button[aria-pressed]');
  if ((await swatches.count()) > 1) {
    await swatches.nth(1).click();
    await expect(swatches.nth(1)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByRole("link", { name: /Enquire on WhatsApp/ }).first()).toBeVisible();
});
