import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  limit: vi.fn(),
  audit: vi.fn(),
  headers: new Headers({ "x-vercel-forwarded-for": "203.0.113.9", "x-request-id": "req-1" }),
}));
vi.mock("next/headers", () => ({ headers: async () => mocks.headers }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signInWithPassword: mocks.signIn } }) }));
vi.mock("@/lib/rate-limit", () => ({ checkLoginRateLimit: mocks.limit }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn() }));

import { adminSignIn } from "@/app/admin/login/actions";

const allowed = { success: true, degraded: false, retryAfter: 0, limit: 5, remaining: 4, reset: 0 };

beforeEach(() => {
  mocks.signIn.mockReset();
  mocks.limit.mockReset().mockResolvedValue(allowed);
  mocks.audit.mockReset();
});

describe("admin sign-in on the server (T3.4)", () => {
  it("signs in and audits the success with the user id, not the e-mail", async () => {
    mocks.signIn.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    expect(await adminSignIn({ email: " Admin@Example.com ", password: "pw" })).toEqual({ ok: true });
    expect(mocks.signIn).toHaveBeenCalledWith({ email: "admin@example.com", password: "pw" });
    expect(mocks.limit.mock.calls[0][1]).toBe("admin@example.com");
    expect(mocks.audit).toHaveBeenCalledWith({ action: "login.success", actorId: "u-1", entity: "user", entityId: "u-1", requestId: "req-1" });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("example.com");
  });

  it("answers a wrong password and an unknown e-mail identically", async () => {
    mocks.signIn.mockResolvedValue({ data: { user: null }, error: { status: 400, message: "Invalid login credentials" } });
    const wrong = await adminSignIn({ email: "admin@example.com", password: "nope" });
    const unknown = await adminSignIn({ email: "nobody@example.com", password: "nope" });
    expect(wrong).toEqual({ ok: false, error: "Invalid email or password." });
    expect(unknown).toEqual(wrong);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "login.failure" }));
  });

  it("refuses without calling Supabase once throttled (6th attempt)", async () => {
    mocks.limit.mockResolvedValue({ ...allowed, success: false, retryAfter: 600 });
    const result = await adminSignIn({ email: "admin@example.com", password: "pw" });
    expect(result).toEqual({ ok: false, error: "Too many sign-in attempts. Please try again in 10 minutes." });
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "login.throttled" }));
  });

  it("says so when the limiter is unavailable (fail closed)", async () => {
    mocks.limit.mockResolvedValue({ ...allowed, success: false, degraded: true, retryAfter: 30 });
    expect(await adminSignIn({ email: "admin@example.com", password: "pw" })).toMatchObject({ ok: false, error: expect.stringContaining("temporarily unavailable") });
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("rejects malformed input before the limiter or Supabase", async () => {
    expect(await adminSignIn({ email: "not-an-email", password: "pw" })).toEqual({ ok: false, error: "Invalid email or password." });
    expect(await adminSignIn({ email: "a@b.co", password: "" })).toEqual({ ok: false, error: "Invalid email or password." });
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});
