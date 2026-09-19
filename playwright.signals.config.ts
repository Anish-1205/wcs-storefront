import { defineConfig } from "@playwright/test";

// Opt-in smoke test using the configured database. Only uniquely named draft
// fixtures are created; they are removed in finally. No customer products change.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "availability-signals.spec.ts",
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  use: { baseURL: process.env.SIGNAL_BASE_URL ?? "http://127.0.0.1:3100", channel: "chrome", trace: "off", screenshot: "only-on-failure" },
  webServer: process.env.SIGNAL_BASE_URL ? undefined : {
    command: "node node_modules/next/dist/bin/next dev -p 3100",
    url: "http://127.0.0.1:3100/admin/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
