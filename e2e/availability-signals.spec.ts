import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

test("signals save, reload, filter, bulk update, undo, history and retry", async ({ page, context }) => {
  test.skip(process.env.SIGNAL_SMOKE !== "1", "Opt-in: run with playwright.signals.config.ts and configured admin credentials.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = process.env.ADMIN_EMAILS!.split(",")[0].trim();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw new Error("Could not create the admin test session");
  const cookies: Array<{ name: string; value: string }> = [];
  const sessionClient = createServerClient(url, anon, { cookies: {
    getAll: () => cookies,
    setAll: (values: Array<{ name: string; value: string }>) => { for (const { name, value } of values) cookies.push({ name, value }); },
  } });
  const { error: sessionError } = await sessionClient.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (sessionError) throw new Error("Could not verify the admin test session");
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: process.env.SIGNAL_BASE_URL ?? "http://127.0.0.1:3100", sameSite: "Lax" })));

  const prefix = `signal-smoke-${Date.now()}`;
  const fixtures = [1, 2].map((n) => ({ name: `${prefix}-${n}`, slug: `${prefix}-${n}`, status: "draft", source: "admin" }));
  const { data: products, error } = await admin.from("products").insert(fixtures).select("id, slug");
  if (error) throw new Error("Could not create draft test fixtures");
  try {
    await page.goto(`/admin/products?per=100&q=${prefix}`);
    const signal = page.getByLabel(`Stock signal for ${fixtures[0].name}`, { exact: true });
    const row = page.locator("tr", { has: signal });
    await expect(signal).toHaveValue("");
    await expect(signal.locator('option[value=""]')).toHaveText(/Default — Availability on Request/);
    await signal.selectOption("sold");
    await expect(row.getByRole("status")).toHaveText("Saved");
    await page.reload();
    await expect(signal).toHaveValue("sold");
    await row.getByRole("button", { name: "History", exact: true }).click();
    await expect(row.getByText(email, { exact: false })).toBeVisible();
    await row.getByRole("button", { name: "Undo latest change" }).click();
    await expect(signal).toHaveValue("");

    await page.getByLabel("Select all products on this page").check();
    await page.getByLabel("Bulk stock signal", { exact: true }).selectOption("limited");
    await page.getByRole("button", { name: "Apply to selected" }).click();
    await expect(signal).toHaveValue("limited");
    await expect(page.getByLabel(`Stock signal for ${fixtures[1].name}`, { exact: true })).toHaveValue("limited");
    await page.getByLabel("Filter by stock signal override").selectOption("limited");
    await expect(page).toHaveURL(/signal=limited/);
    await expect(page.getByLabel(/Stock signal for signal-smoke/)).toHaveCount(2);
    await page.getByRole("button", { name: "Undo bulk change" }).click();
    await expect(page.getByText("No products found.")).toBeVisible();
    await page.getByLabel("Filter by stock signal override").selectOption("");
    await expect(signal).toHaveValue("");

    // A failed server-action request must restore the old value and allow retry.
    await page.route("**/admin/products?**", async (route) => {
      if (route.request().method() === "POST") await route.abort("failed");
      else await route.continue();
    });
    await signal.selectOption("available");
    await expect(row.getByRole("alert")).toBeVisible();
    await expect(signal).toHaveValue("");
    await page.unroute("**/admin/products?**");
    await row.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(signal).toHaveValue("available");
    await expect(row.getByRole("status")).toHaveText("Saved");

    // Signals survive a rename through the real database trigger.
    const renamed = `${fixtures[0].slug}-renamed`;
    const { error: renameError } = await admin.from("products").update({ slug: renamed }).eq("id", products!.find((p) => p.slug === fixtures[0].slug)!.id);
    expect(renameError).toBeNull();
    await page.reload();
    await expect(signal).toHaveValue("available");
    await page.setViewportSize({ width: 390, height: 844 });
    await signal.scrollIntoViewIfNeeded();
    await expect(signal).toBeVisible();
  } finally {
    const { error: cleanupError } = await admin.from("products").delete().in("id", products!.map((p) => p.id));
    if (cleanupError) throw new Error(`Draft fixture cleanup failed for ${prefix}`);
    const { data: leftover } = await admin.from("storefront_availability_overrides").select("slug").like("slug", `${prefix}%`);
    expect(leftover).toEqual([]);
    const { error: historyCleanupError } = await admin.from("storefront_availability_history").delete().in("slug", [...fixtures.map((f) => f.slug), `${fixtures[0].slug}-renamed`]);
    if (historyCleanupError) throw new Error(`Test history cleanup failed for ${prefix}`);
    await sessionClient.auth.signOut({ scope: "local" });
  }
});
