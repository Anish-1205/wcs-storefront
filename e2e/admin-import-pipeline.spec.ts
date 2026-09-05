import { test, expect } from "@playwright/test";
import { loginAsAdmin, mockImportCloudinaryUpload, startFakeUpstash } from "./helpers";

// Exercises the real import route handlers, server actions, and local
// Supabase instance end to end — only Cloudinary and Upstash (external
// services this environment has no live account for) are faked. Covers the
// ground docs/import-pipeline.md previously flagged as untested: upload ->
// group -> collection classification -> explicit confirmation -> draft
// product creation -> review approval -> publish, proving the review gate
// actually unblocks after approval.
let stopFakeUpstash: () => Promise<void>;
test.beforeAll(async () => {
  stopFakeUpstash = await startFakeUpstash();
});
test.afterAll(async () => {
  await stopFakeUpstash();
});

test("import a batch of photos through to an approved, publishable product", async ({ page }) => {
  await mockImportCloudinaryUpload(page);
  await loginAsAdmin(page);

  // Start a new batch without pinning a collection up front, so
  // classification has to go through the "unresolved -> explicit admin
  // pick" path rather than the deterministic manifest shortcut.
  await page.goto("/admin/import/new");
  await page.getByRole("button", { name: "Start import" }).click();
  await page.waitForURL(/\/admin\/import\/[0-9a-f-]+$/);

  // Upload two images so grouping has more than one asset to work with.
  const fakeJpeg = (n: number) => ({
    name: `saree-${n}.jpg`,
    mimeType: "image/jpeg",
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, n]),
  });
  await page.getByTestId("import-desktop-file-input").setInputFiles([fakeJpeg(1), fakeJpeg(2)]);

  // Both uploads go through sign -> Cloudinary (mocked) -> complete for
  // real; wait for both rows to reach "done".
  await expect(page.getByText("done")).toHaveCount(2, { timeout: 20_000 });

  // Group the (still ungrouped) uploaded assets into a proposed product.
  await page.getByRole("button", { name: "Group these into products" }).click();
  await expect(page.getByText(/Proposed products \(1\)/)).toBeVisible();

  // No batch manifest, alias, or admin description was given, and there's
  // no AI key configured in this test env, so classification must resolve
  // to unresolved — never a silent guess.
  await page.getByRole("button", { name: "Check collection" }).click();
  await expect(page.getByText("Collection unresolved")).toBeVisible();

  // "Create draft product" must stay disabled while unresolved — the
  // fail-closed invariant this whole pipeline exists to protect.
  await expect(page.getByRole("button", { name: "Create draft product" })).toBeDisabled();

  // Admin explicitly picks a real, existing collection and confirms it.
  // With exactly one group and no assets left ungrouped, its collection
  // dropdown is the only <select> on the page at this point.
  await page.locator("select").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Collection confirmed")).toBeVisible();

  // Now the gate opens and the draft product can be created.
  await page.getByRole("button", { name: "Create draft product" }).click();
  await expect(page.getByRole("link", { name: "Edit product" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve for publish" })).toBeVisible();

  // Approve the review — this is the only thing allowed to lift the gate.
  await page.getByRole("button", { name: "Approve for publish" }).click();
  await expect(page.getByText("Review approved")).toBeVisible();

  // Follow through to the real product and confirm publishing now
  // succeeds — proving saveProduct's review gate actually unblocks once
  // review_status is approved, not just that the UI shows a badge.
  const editLink = page.getByRole("link", { name: "Edit product" });
  const href = await editLink.getAttribute("href");
  await page.goto(href!);
  // Publishing has its own general readiness gate (productInputSchema's
  // superRefine in src/lib/validation.ts) independent of the import review
  // gate: category, fabric type, a real description, and a starting price
  // are required for ANY product before it can be published. The imported
  // draft has none of these (createProductFromGroup deliberately leaves
  // fabric/price unset — it must never fabricate them), so a real admin
  // filling them in here is exactly what proves the review gate was the
  // only thing that changed, not that validation was bypassed.
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Fabric type").fill("Pure Silk");
  await page.getByLabel("Base price min (₹)").fill("4500");
  await page.getByLabel("Description").fill("A handpicked saree imported through the bulk media pipeline for end-to-end testing.");
  await page.getByLabel("Status").selectOption("published");
  await page.getByRole("button", { name: "Save product" }).click();
  // saveProduct redirects to the product list on success; it would instead
  // show an inline error and stay put if the review gate were still
  // blocking the publish.
  await page.waitForURL(/\/admin\/products$/, { timeout: 10_000 });
});
