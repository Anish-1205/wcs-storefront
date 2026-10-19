import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PRODUCTS } from "../src/data/products";

/**
 * Accessibility regressions (T5.5): axe on the pages a customer and the admin
 * actually use, failing on serious or critical violations only, plus the
 * keyboard path through the storefront. Needs no backend, like public-site.
 */

async function seriousViolations(page: Page) {
  // Cards fade in (.reveal): measured mid-fade, their text has lower contrast
  // than it ends up with. Scan the settled page.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 10_000 });
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

const product = PRODUCTS[0];

for (const path of ["/", "/catalog", `/sarees/${product.slug}`, "/enquiry", "/signin", "/contact", "/admin/login"]) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("h1:visible, form:visible").first()).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test("the cart drawer is accessible, and closing it returns focus", async ({ page }) => {
  await page.goto(`/sarees/${product.slug}`);
  const add = await page.getByRole("button", { name: /add to cart/i }).first().elementHandle();
  await add!.click();
  const drawer = page.getByRole("dialog", { name: "Your selection" });
  await expect(drawer).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  // The button's label changes once the item is in the cart, so check the element itself.
  expect(await add!.evaluate((el) => el === document.activeElement)).toBe(true);
});

test("keyboard: the skip link reaches the main content first", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("keyboard: every enquiry form field has a label", async ({ page }) => {
  await page.goto("/enquiry");
  const unlabelled = await page.locator("form input:not([type=hidden]), form textarea, form select").evaluateAll((els) =>
    els
      .filter((el) => !(el as HTMLElement).closest("[aria-hidden=true]") && (el as HTMLElement).offsetParent !== null)
      .filter((el) => {
        const id = el.getAttribute("id");
        const labelled = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || (id && document.querySelector(`label[for="${id}"]`)) || el.closest("label");
        return !labelled;
      })
      .map((el) => el.getAttribute("name") ?? el.outerHTML.slice(0, 80)),
  );
  expect(unlabelled).toEqual([]);
});
