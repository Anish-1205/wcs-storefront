import { expect, test } from "@playwright/test";
import { loginAsAdmin, mockCloudinaryUpload } from "./helpers";

test.describe("Admin product CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("creates a draft product, edits it, publishes it, and deletes it", async ({ page }) => {
    const productName = `E2E Test Saree ${Date.now()}`;

    // --- Create (draft, minimal fields — drafts don't need category/price/images) ---
    await page.goto("/admin/products/new");
    await page.getByLabel("Name *").fill(productName);
    await page.getByRole("button", { name: "Save product" }).click();
    await page.waitForURL(/\/admin\/products$/);
    await expect(page.getByRole("link", { name: productName })).toBeVisible();

    // --- Publish validation: switching status without required fields must fail ---
    await page.getByRole("link", { name: productName }).click();
    await page.waitForURL(/\/admin\/products\/[0-9a-f-]+$/);
    await page.getByLabel("Status").selectOption("published");
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText(/Published products need/)).toBeVisible();

    // --- Fill in everything publish validation requires, including an image ---
    await mockCloudinaryUpload(page);
    await page.getByLabel("Category").selectOption({ label: "Kanjivaram" });
    await page.getByLabel("Fabric type").fill("Pure Silk");
    await page.getByLabel("Description").fill(
      "A handwoven Kanjivaram silk saree with a rich temple border, crafted by master weavers for a premium finish.",
    );
    await page.getByLabel("Base price min (₹)").fill("8000");
    await page.getByLabel("Base price max (₹)").fill("12000");

    await page.getByRole("button", { name: "+ Add single variant" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "sample.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]),
    });
    await expect(page.getByText("Set primary")).toHaveCount(0); // single image auto-primary
    await expect(page.locator('img[alt="variant"]')).toBeVisible();

    await page.getByRole("button", { name: "Save product" }).click();
    await page.waitForURL(/\/admin\/products$/);
    await expect(page.getByRole("link", { name: productName })).toBeVisible();

    // Confirm it is now live on the public catalog.
    await page.goto("/catalog");
    await expect(page.getByText(productName)).toBeVisible();

    // --- Delete ---
    await page.goto("/admin/products");
    page.once("dialog", (dialog) => dialog.accept());
    const row = page.locator("tr", { has: page.getByRole("link", { name: productName }) });
    await row.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("link", { name: productName })).toHaveCount(0);

    await page.goto("/catalog");
    await expect(page.getByText(productName)).toHaveCount(0);
  });

  test("product list search filters by name", async ({ page }) => {
    await page.goto("/admin/products");
    await page.getByPlaceholder("Search name, slug, product code…").fill("zzz-no-such-product-zzz");
    await expect(page.getByText("No products found.")).toBeVisible();
  });
});
