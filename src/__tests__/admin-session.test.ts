import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { evaluateSession, LAST_SEEN_COOKIE, readLastSeen, sessionPolicy, signLastSeen } from "@/lib/admin-session";

const SECRET = "a-test-secret-of-length";
const policy = (idleMinutes?: number, maxHours?: number) =>
  sessionPolicy({ ADMIN_IDLE_TIMEOUT_MINUTES: idleMinutes?.toString(), ADMIN_MAX_SESSION_HOURS: maxHours?.toString(), ADMIN_SESSION_SECRET: SECRET });

const NOW = Date.parse("2026-10-19T12:00:00Z");
const minutesAgo = (m: number) => NOW - m * 60_000;
const iso = (t: number) => new Date(t).toISOString();

describe("session lifetime rules (T3.5)", () => {
  it("is off until the limits are set, and the idle limit needs a secret", () => {
    expect(sessionPolicy({})).toEqual({ idleMs: null, maxMs: null, secret: null });
    expect(sessionPolicy({ ADMIN_IDLE_TIMEOUT_MINUTES: "30" }).idleMs).toBeNull();
    expect(sessionPolicy({ ADMIN_IDLE_TIMEOUT_MINUTES: "30", ADMIN_SESSION_SECRET: "short" }).idleMs).toBeNull();
    expect(policy(30, 12)).toMatchObject({ idleMs: 30 * 60_000, maxMs: 12 * 3_600_000 });
    expect(sessionPolicy({ ADMIN_MAX_SESSION_HOURS: "abc" }).maxMs).toBeNull();
  });

  it("idle: 29 minutes since the last request is fine, 31 is not", () => {
    const p = policy(30);
    expect(evaluateSession({ now: NOW, lastSeen: minutesAgo(29), lastSignInAt: iso(minutesAgo(600)), policy: p })).toBe("ok");
    expect(evaluateSession({ now: NOW, lastSeen: minutesAgo(31), lastSignInAt: iso(minutesAgo(600)), policy: p })).toBe("idle");
  });

  it("idle without a cookie falls back to the sign-in time, never to 'fine'", () => {
    const p = policy(30);
    expect(evaluateSession({ now: NOW, lastSeen: null, lastSignInAt: iso(minutesAgo(2)), policy: p })).toBe("ok");
    expect(evaluateSession({ now: NOW, lastSeen: null, lastSignInAt: iso(minutesAgo(90)), policy: p })).toBe("idle");
  });

  it("absolute: 12 hours after the password sign-in, however active", () => {
    const p = policy(30, 12);
    expect(evaluateSession({ now: NOW, lastSeen: minutesAgo(1), lastSignInAt: iso(minutesAgo(11 * 60)), policy: p })).toBe("ok");
    expect(evaluateSession({ now: NOW, lastSeen: minutesAgo(1), lastSignInAt: iso(minutesAgo(13 * 60)), policy: p })).toBe("absolute");
  });

  it("the last-seen cookie cannot be edited, moved to another user, or forged", async () => {
    const cookie = await signLastSeen("user-1", minutesAgo(5), SECRET);
    expect(await readLastSeen(cookie, "user-1", SECRET)).toBe(minutesAgo(5));
    const [id, , sig] = cookie.split(".");
    expect(await readLastSeen(`${id}.${NOW}.${sig}`, "user-1", SECRET)).toBeNull();
    expect(await readLastSeen(cookie, "user-2", SECRET)).toBeNull();
    expect(await readLastSeen(cookie, "user-1", "another-secret-entirely")).toBeNull();
    expect(await readLastSeen("garbage", "user-1", SECRET)).toBeNull();
  });
});

const mocks = vi.hoisted(() => ({ user: null as null | Record<string, unknown>, signOut: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: mocks.user } }),
      signOut: mocks.signOut,
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) },
    },
  }),
}));

describe("middleware enforcement", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    vi.stubEnv("ADMIN_IDLE_TIMEOUT_MINUTES", "30");
    vi.stubEnv("ADMIN_MAX_SESSION_HOURS", "12");
    vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    mocks.signOut.mockReset().mockResolvedValue({ error: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const go = async (cookie?: string) => {
    const { middleware } = await import("@/middleware");
    const headers: Record<string, string> = cookie ? { cookie: `${LAST_SEEN_COOKIE}=${cookie}` } : {};
    return middleware(new NextRequest("http://localhost/admin/products", { headers }));
  };

  it("an active session passes and its last-seen cookie moves forward", async () => {
    mocks.user = { id: "user-1", email: "admin@example.com", last_sign_in_at: iso(minutesAgo(60)) };
    const res = await go(await signLastSeen("user-1", minutesAgo(5), SECRET));
    expect(res.headers.get("location")).toBeNull();
    expect(await readLastSeen(res.cookies.get(LAST_SEEN_COOKIE)?.value, "user-1", SECRET)).toBe(NOW);
  });

  it("an idle session is signed out and sent to the login page with the reason", async () => {
    mocks.user = { id: "user-1", email: "admin@example.com", last_sign_in_at: iso(minutesAgo(60)) };
    const res = await go(await signLastSeen("user-1", minutesAgo(45), SECRET));
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(res.headers.get("location")).toBe("http://localhost/admin/login?expired=idle&redirect=%2Fadmin%2Fproducts");
  });

  it("an over-age session is signed out even if it was just active", async () => {
    mocks.user = { id: "user-1", email: "admin@example.com", last_sign_in_at: iso(minutesAgo(13 * 60)) };
    const res = await go(await signLastSeen("user-1", minutesAgo(1), SECRET));
    expect(res.headers.get("location")).toContain("expired=absolute");
  });
});
