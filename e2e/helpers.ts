import type { Page } from "@playwright/test";
import * as http from "node:http";

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

/**
 * Reads the `public_id` the browser actually sent in a signed Cloudinary
 * upload's multipart body and echoes it back in the response — needed for
 * the import pipeline, whose /api/import/complete strictly checks the
 * completed public_id matches `imports/<batch_id>/<client_upload_id>`
 * (a fixed value picked up-front wouldn't match, unlike the simpler
 * mockCloudinaryUpload above which nothing downstream re-validates).
 */
function readMultipartField(body: Buffer, contentType: string | undefined, field: string): string | null {
  if (!contentType?.includes("multipart/form-data")) return null;
  const text = body.toString("binary");
  const match = text.match(new RegExp(`name="${field}"\\r\\n\\r\\n([^\\r\\n]*)\\r\\n`));
  return match ? match[1] : null;
}

/**
 * Mocks the direct-to-Cloudinary upload leg the import pipeline's own
 * routes need. `page.route` only intercepts requests the *browser* makes —
 * this one qualifies, since the upload itself is a client-side XHR.
 */
export async function mockImportCloudinaryUpload(page: Page) {
  await page.route("https://api.cloudinary.com/**", async (route) => {
    const request = route.request();
    const body = request.postDataBuffer();
    const publicId = body ? readMultipartField(body, request.headers()["content-type"], "public_id") : null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        secure_url: `https://res.cloudinary.com/local-test-cloud/image/upload/v1/${publicId}.jpg`,
        public_id: publicId,
        etag: publicId ? `etag-${publicId}` : `etag-${Date.now()}`,
        bytes: 12345,
        width: 800,
        height: 1000,
      }),
    });
  });
}

/**
 * Starts a real local HTTP listener standing in for Upstash's Redis REST
 * API on the exact address the local dev env's UPSTASH_REDIS_REST_URL
 * points at (127.0.0.1:8079, nothing normally listens there).
 *
 * `page.route` cannot substitute for this: `checkRateLimit` runs inside
 * the Next.js API route handler, in the Node server process, not in the
 * browser — so only a real, reachable TCP listener works. Always replies
 * success in Upstash's `{ result: [...] }` envelope, matching the 2-tuple
 * `@upstash/ratelimit`'s sliding-window script returns
 * (`[remainingTokens, effectiveLimit]`) — rate limiting itself isn't what
 * any test using this exercises.
 */
export async function startFakeUpstash(): Promise<() => Promise<void>> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      // @upstash/redis auto-batches even a single command through its
      // pipeline path, which expects one { result } entry per command back
      // as a top-level array — a bare object crashes its response parser
      // with "s.map is not a function". Request body is a JSON array of
      // commands (each itself an array) either way, so its length tells us
      // how many { result } entries to echo back.
      let commandCount = 1;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "[]");
        if (Array.isArray(body) && Array.isArray(body[0])) commandCount = body.length;
      } catch {
        // fall back to treating it as a single command
      }
      const results = Array.from({ length: commandCount }, () => ({ result: [999_999, 999_999] }));
      res.end(JSON.stringify(results));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(8079, "127.0.0.1", () => resolve());
  });
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}
