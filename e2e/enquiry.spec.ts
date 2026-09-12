import { expect, test } from "@playwright/test";

test.describe("Enquiry form", () => {
  test("submits a valid enquiry and shows the thank-you state", async ({ page }) => {
    let requestBody: Record<string, unknown> | null = null;

    await page.route("**/api/inquiries", async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await page.goto("/contact");
    await page.getByLabel("Name *").fill("Asha Kapoor");
    await page.getByLabel("Phone / WhatsApp *").fill("+91 98765 43210");
    await page.getByLabel("Email (optional)").fill("asha@example.com");
    await page.getByLabel("Message", { exact: true }).fill("Please share availability for the Kanjivaram in red.");

    await page.getByRole("button", { name: "Send Enquiry" }).click();

    await expect(page.getByText("Thank you!")).toBeVisible();
    expect(requestBody).toMatchObject({
      name: "Asha Kapoor",
      phone: "+91 98765 43210",
      email: "asha@example.com",
      inquiry_type: "general",
      website: "", // honeypot must stay empty for a real submission
    });
  });

  test("blocks submission until required fields are filled", async ({ page }) => {
    await page.goto("/contact");
    const nameInput = page.getByLabel("Name *");
    await page.getByRole("button", { name: "Send Enquiry" }).click();
    await expect(nameInput).toBeFocused();
  });

  test("shows a friendly error and preserves WhatsApp fallback when the API fails", async ({ page }) => {
    await page.route("**/api/inquiries", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Could not save inquiry" }) });
    });

    await page.goto("/contact");
    await page.getByLabel("Name *").fill("Ravi Menon");
    await page.getByLabel("Phone / WhatsApp *").fill("9876543210");
    await page.getByRole("button", { name: "Send Enquiry" }).click();

    await expect(page.getByText("Could not send your enquiry. Please try WhatsApp instead.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Chat on WhatsApp" })).toBeVisible();
  });

  test("every form's honeypot is present but hidden from real users", async ({ page }) => {
    await page.goto("/contact");

    // /contact carries two independent forms — the page's enquiry form and the
    // site-wide footer subscribe form — and each needs its OWN honeypot, since
    // each handler reads `new FormData(form)`, which is form-scoped. Two
    // `input[name="website"]` on the page is therefore correct, not a
    // duplication to remove: deleting either would leave that form unprotected.
    // Assert per-form rather than page-wide (a page-wide locator matches both
    // and trips strict mode).
    const forms = [
      page.locator("form", { has: page.getByRole("button", { name: "Send Enquiry" }) }),
      page.locator("footer form"),
    ];

    for (const form of forms) {
      const honeypot = form.locator('input[name="website"]');
      await expect(honeypot).toHaveCount(1);
      await expect(honeypot).toBeHidden();
      await expect(honeypot).toHaveAttribute("tabindex", "-1");
      await expect(honeypot).toHaveAttribute("autocomplete", "off");
      await expect(honeypot).toHaveAttribute("aria-hidden", "true");
    }
  });
});
