import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, loginAsAdmin } from "./helpers";

test.describe("Admin authentication", () => {
  test("rejects an invalid password", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("logs in, reaches the dashboard, and signs out", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/admin\/login/);

    // Session is really gone — direct navigation to a protected route bounces back.
    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/admin\/login\?redirect=%2Fadmin%2Fproducts/);
  });

  test("redirects a non-admin email back to login", async ({ page }) => {
    // ADMIN_EMAILS only allow-lists admin@example.com; a second registered user
    // (seeded by the E2E runbook as staff@example.com) authenticates fine with
    // Supabase but must be rejected by the app-level ADMIN_EMAILS check.
    await page.goto("/admin/login");
    await page.getByLabel("Email").fill("staff@example.com");
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/admin\/login/);
  });
});
