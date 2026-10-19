import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
  levels: { currentLevel: "aal1", nextLevel: "aal1" } as { currentLevel: string; nextLevel: string } | null,
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
}));

const auth = {
  getUser: async () => ({ data: { user: mocks.user } }),
  signOut: vi.fn(),
  mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: mocks.levels, error: null }) },
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }), createAdminClient: () => ({}) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
// React's per-request cache would keep the first answer across tests.
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import { decideMfa } from "@/lib/admin-mfa";
import { assertAdmin, requireAdmin } from "@/lib/admin-auth";
import { middleware } from "@/middleware";

const admin = { id: "admin-1", email: "admin@example.com" };
const set = (current: string, next: string) => { mocks.levels = { currentLevel: current, nextLevel: next }; };

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  mocks.user = admin;
  set("aal1", "aal1");
  mocks.redirect.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("the two-factor decision (T3.3)", () => {
  it.each([
    ["aal1", "aal1", false, "ok"],        // no factor, not required: the rollout state
    ["aal1", "aal1", true, "enroll"],     // required, none yet
    ["aal1", "aal2", false, "challenge"], // has a factor, password only so far
    ["aal1", "aal2", true, "challenge"],
    ["aal2", "aal2", false, "ok"],
    ["aal2", "aal2", true, "ok"],
  ])("current %s, next %s, required %s → %s", (current, next, required, expected) => {
    expect(decideMfa({ currentLevel: current, nextLevel: next }, required as boolean)).toBe(expected);
  });
});

describe("server-side guards", () => {
  it("assertAdmin refuses an aal1 session that has a factor", async () => {
    set("aal1", "aal2");
    await expect(assertAdmin()).rejects.toThrow("Two-factor verification required.");
    set("aal2", "aal2");
    await expect(assertAdmin()).resolves.toMatchObject({ user: admin });
  });

  it("assertAdmin refuses a factor-less session once ADMIN_REQUIRE_MFA=1, and not before", async () => {
    await expect(assertAdmin()).resolves.toMatchObject({ user: admin });
    vi.stubEnv("ADMIN_REQUIRE_MFA", "1");
    await expect(assertAdmin()).rejects.toThrow("Set up two-factor sign-in first.");
  });

  it("requireAdmin sends pending sessions to the page that resolves them, except from those pages", async () => {
    set("aal1", "aal2");
    await expect(requireAdmin()).rejects.toThrow("REDIRECT /admin/mfa");
    await expect(requireAdmin({ allowPendingMfa: true })).resolves.toMatchObject({ mfa: "challenge" });
    set("aal1", "aal1");
    vi.stubEnv("ADMIN_REQUIRE_MFA", "1");
    await expect(requireAdmin()).rejects.toThrow("REDIRECT /admin/security");
  });
});

describe("middleware", () => {
  const go = (path: string) => middleware(new NextRequest(`http://localhost${path}`));

  it("redirects an aal1 session with a factor to /admin/mfa, keeping where it was going", async () => {
    set("aal1", "aal2");
    const res = await go("/admin/products");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/admin/mfa?redirect=%2Fadmin%2Fproducts");
  });

  it("lets the challenge and set-up pages through, and an aal2 session everywhere", async () => {
    set("aal1", "aal2");
    expect((await go("/admin/mfa")).headers.get("location")).toBeNull();
    expect((await go("/admin/security")).headers.get("location")).toBeNull();
    set("aal2", "aal2");
    expect((await go("/admin/products")).headers.get("location")).toBeNull();
  });

  it("does nothing for an admin without a factor while MFA is not required", async () => {
    expect((await go("/admin/products")).headers.get("location")).toBeNull();
  });
});

describe("edge allowlist (T3.11)", () => {
  const go = (path: string) => middleware(new NextRequest(`http://localhost${path}`));

  it("a signed-in non-admin gets no admin page and is not bounced in a loop", async () => {
    mocks.user = { id: "u-2", email: "staff@example.com" };
    expect((await go("/admin/products")).headers.get("location")).toBe("http://localhost/admin/login");
    expect((await go("/admin/login")).headers.get("location")).toBeNull();
  });

  it("the admin API routes answer 401/403 at the edge", async () => {
    mocks.user = null;
    expect((await go("/api/upload")).status).toBe(401);
    mocks.user = { id: "u-2", email: "staff@example.com" };
    expect((await go("/api/import/sign")).status).toBe(403);
    mocks.user = admin;
    expect((await go("/api/import/complete")).status).toBe(200);
  });
});
