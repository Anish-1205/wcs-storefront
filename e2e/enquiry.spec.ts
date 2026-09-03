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

  test("honeypot field is present but hidden from real users", async ({ page }) => {
    await page.goto("/contact");
    const honeypot = page.locator('input[name="website"]');
    await expect(honeypot).toBeHidden();
    await expect(honeypot).toHaveAttribute("tabindex", "-1");
  });
});
