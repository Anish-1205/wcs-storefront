import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

/**
 * `scripts/check-env.mjs` is what `npm run check:env` runs before a deploy, so
 * it is the last place the incident override can be caught before it reaches
 * customers. Run as a real subprocess, because what matters is the exit code
 * and what an operator sees in the log.
 *
 * Every required variable is supplied here so the script reaches its warnings
 * rather than stopping at "missing"; the WhatsApp set is supplied in full
 * because a partial one is itself an error.
 */
const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "cloud",
  CLOUDINARY_API_KEY: "key",
  CLOUDINARY_API_SECRET: "secret",
  NEXT_PUBLIC_WHATSAPP_NUMBER: "919876543210",
  NEXT_PUBLIC_BUSINESS_NAME: "Test Sarees",
  NEXT_PUBLIC_SITE_URL: "https://sarees.test",
  ADMIN_EMAILS: "owner@sarees.test",
  UPSTASH_REDIS_REST_URL: "https://redis.test",
  UPSTASH_REDIS_REST_TOKEN: "token",
  WHATSAPP_ACCESS_TOKEN: "token",
  WHATSAPP_PHONE_NUMBER_ID: "1",
  WHATSAPP_VERIFY_TOKEN: "verify",
  WHATSAPP_APP_SECRET: "secret",
  WHATSAPP_ADMIN_NUMBERS: "919876543210",
  VERCEL_ENV: "",
  NODE_ENV: "development",
  VISIBILITY_MAX_STALE_MS: "",
  VISIBILITY_FAIL_OPEN: "",
  CATALOG_SNAPSHOT_OPTIONAL: "",
};

/** Runs the script and returns its exit code with stdout and stderr together,
 *  which is what an operator actually reads in a deploy log (the warnings go
 *  to stderr, the pass line to stdout). */
function run(overrides: Record<string, string> = {}, args: string[] = []) {
  const result = spawnSync(process.execPath, ["scripts/check-env.mjs", ...args], {
    // `NODE_ENV` is one of the values under test, so this is a plain string
    // map rather than the narrowed ProcessEnv type.
    env: { ...process.env, ...BASE_ENV, ...overrides } as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  return { code: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe("the environment check", () => {
  it("passes with the visibility settings left at their defaults", () => {
    const { code, output } = run();

    expect(code).toBe(0);
    expect(output).toContain("passed required checks");
    expect(output).not.toContain("VISIBILITY_FAIL_OPEN");
  });

  it("rejects a staleness budget that is not a positive number", () => {
    for (const value of ["abc", "0", "-5"]) {
      const { code, output } = run({ VISIBILITY_MAX_STALE_MS: value });

      expect(code).toBe(1);
      expect(output).toContain("VISIBILITY_MAX_STALE_MS must be a positive number");
    }
  });

  it("accepts a budget that is a positive number", () => {
    expect(run({ VISIBILITY_MAX_STALE_MS: "300000" }).code).toBe(0);
  });

  it("rejects an override set to anything other than 1", () => {
    const { code, output } = run({ VISIBILITY_FAIL_OPEN: "yes" });

    expect(code).toBe(1);
    expect(output).toContain('VISIBILITY_FAIL_OPEN must be "1" or unset');
  });

  it("warns loudly, and names the risk, when the override is on in production", () => {
    // Each of the three ways this script can tell it is looking at production.
    const productionCases: { env: Record<string, string>; args: string[] }[] = [
      { env: {}, args: ["--production"] },
      { env: { VERCEL_ENV: "production" }, args: [] },
      { env: { NODE_ENV: "production" }, args: [] },
    ];

    for (const { env, args } of productionCases) {
      const { code, output } = run({ VISIBILITY_FAIL_OPEN: "1", ...env }, args);

      // A warning, not a failure: it is a deliberate incident setting.
      expect(code).toBe(0);
      expect(output).toContain("WARNING: VISIBILITY_FAIL_OPEN=1 IN PRODUCTION");
      expect(output).toContain("can therefore be shown to customers");
      expect(output).toContain("================");
    }
  });

  it("mentions the override more quietly outside production", () => {
    const { code, output } = run({ VISIBILITY_FAIL_OPEN: "1" });

    expect(code).toBe(0);
    expect(output).toContain("VISIBILITY_FAIL_OPEN=1");
    expect(output).not.toContain("IN PRODUCTION");
  });

  it("notes a build that was allowed to skip the visibility snapshot", () => {
    const { output } = run({ CATALOG_SNAPSHOT_OPTIONAL: "1" });

    expect(output).toContain("CATALOG_SNAPSHOT_OPTIONAL=1");
  });
});
