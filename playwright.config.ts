import { defineConfig } from "@playwright/test";

// Local Supabase CLI demo keys — publicly documented defaults for `supabase start`,
// not secrets. See https://supabase.com/docs/guides/local-development/cli/getting-started.
const LOCAL_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Env for the Playwright-managed webServer only — requires `supabase start` to already
// be running locally. Real secrets (Cloudinary, WhatsApp, Upstash) are dummy/local values;
// those legs are mocked at the network layer in the relevant specs instead of hit for real.
const E2E_SERVER_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: LOCAL_SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "local-test-cloud",
  CLOUDINARY_API_KEY: "local-test-key",
  CLOUDINARY_API_SECRET: "local-test-secret",
  NEXT_PUBLIC_WHATSAPP_NUMBER: "919876543210",
  NEXT_PUBLIC_BUSINESS_NAME: "Weavers Club Sarees (Test)",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  ADMIN_EMAILS: "admin@example.com",
  UPSTASH_REDIS_REST_URL: "http://127.0.0.1:8079",
  UPSTASH_REDIS_REST_TOKEN: "local-test-token",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: E2E_SERVER_ENV,
  },
});
