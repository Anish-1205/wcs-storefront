import type { Page } from "@playwright/test";

// Matches the admin user created for local E2E runs — see docs/setup.md and
// the "supabase/auth/v1/admin/users" bootstrap step in the E2E runbook.
export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_PASSWORD = "TestPassw0rd!23";

export async function loginAsAdmin(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin(?!\/login)/);
}

/**
 * Intercepts the full image-upload leg: `/api/upload` (real handler needs
 * Upstash for rate limiting, which isn't running locally) and the actual
 * Cloudinary POST, so tests never need live Upstash or Cloudinary accounts.
 */
export async function mockCloudinaryUpload(page: Page) {
  await page.route("**/api/upload", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        signature: "test-signature",
        timestamp: Math.floor(Date.now() / 1000),
        folder: "sarees",
        apiKey: "local-test-key",
        cloudName: "local-test-cloud",
        uploadUrl: "https://api.cloudinary.com/v1_1/local-test-cloud/image/upload",
      }),
    });
  });

  await page.route("https://api.cloudinary.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        secure_url: `https://res.cloudinary.com/local-test-cloud/image/upload/v1/sarees/e2e-${Date.now()}.jpg`,
        public_id: `sarees/e2e-${Date.now()}`,
      }),
    });
  });
}
