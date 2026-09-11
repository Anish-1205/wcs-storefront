import { expect, test } from "@playwright/test";

test("page editor preview exposes and updates text, images and sections", async ({ page }) => {
  await page.route("**/__editor_harness", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><script>window.fields=[];addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='content-fields')window.fields.push(...e.data.fields)});</script><iframe title="Preview" src="/about?contentEditor=1"></iframe></body></html>` }));
  await page.goto("/__editor_harness");
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("h1")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { fields: { key: string }[] }).fields.length)).toBeGreaterThan(20);
  const fields = await page.evaluate(() => (window as unknown as { fields: { key: string; scope: string; kind: string; value: string; label: string }[] }).fields);
  const title = fields.find((field) => field.scope === "/about" && typeof field.value === "string" && field.value === "A private")!;
  const image = fields.find((field) => field.scope === "/about" && field.kind === "image" && field.label === "A purple silk saree draped in the showroom")!;
  const section = fields.find((field) => field.scope === "/about" && field.kind === "section")!;
  expect(title).toBeTruthy(); expect(image).toBeTruthy(); expect(section).toBeTruthy();
  await page.evaluate(({ title, image, section }) => {
    document.querySelector("iframe")!.contentWindow!.postMessage({ type: "content-preview", content: { "/about": {
      [title.key]: { kind: "text", value: "Your private showroom" },
      [image.key]: { kind: "image", value: "/media/hero-poster.jpg" },
      [section.key]: { kind: "section", value: false },
    } } }, location.origin);
  }, { title, image, section });
  await expect(frame.locator("h1")).toContainText("Your private showroom");
  await expect(frame.locator('section[hidden]')).toHaveCount(1);
  await expect(frame.locator('img[alt="A purple silk saree draped in the showroom"]')).toHaveAttribute("src", /hero-poster/);
});

test("video thumbnail loads a still and selects playable media", async ({ page }) => {
  await page.goto("/sarees/antique-gold-patola-tissue");
  const video = page.getByRole("option", { name: "Video", exact: true }).first();
  await expect(video.locator("img")).toBeVisible();
  await expect.poll(() => video.locator("img").evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await video.click();
  await expect(page.locator(".product-stage video")).toBeVisible();
  await expect(page.locator(".product-stage video source")).toHaveAttribute("src", /\.mp4/);
});
