import { expect, test } from "@playwright/test";
import { PRODUCTS } from "../src/data/products";

/**
 * Visual regression (T6.10, optional). Skipped unless VISUAL=1: it runs only
 * from .github/workflows/visual.yml (PR label `visual`), because baselines are
 * made on that runner image and differ on any other OS. Baselines are accepted
 * by committing them after the owner has looked at the diff.
 */
test.skip(process.env.VISUAL !== "1", "visual regression runs only in the labelled workflow");

const PAGES = ["/", "/catalog", `/sarees/${PRODUCTS[0].slug}`, "/enquiry"];
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  for (const path of PAGES) {
    test(`${path} at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 10_000 });
      await expect(page).toHaveScreenshot(`${viewport.name}${path === "/" ? "-home" : path.replace(/\//g, "-")}.png`, {
        fullPage: true,
        // Things that change on their own: videos, the floating WhatsApp control, the cart count.
        mask: [page.locator("video"), page.getByRole("link", { name: "Speak to us on WhatsApp" })],
        maxDiffPixelRatio: 0.01,
      });
    });
  }
}
