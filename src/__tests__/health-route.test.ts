import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.hoisted(() => vi.fn());
const mockReportError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ limit: mockSelect }) }) }),
}));
vi.mock("@/lib/report-error", () => ({ reportError: mockReportError }));

import { GET } from "@/app/api/health/route";

function request(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, { headers });
}

describe("health route", () => {
  beforeEach(() => {
    mockSelect.mockReset().mockResolvedValue({ error: null, data: [] });
    mockReportError.mockReset();
    vi.unstubAllEnvs();
  });

  it("returns { ok: true } for the public liveness check, with no-store", async () => {
    const response = await GET(request("/api/health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("rejects the deep check without a token configured", async () => {
    const response = await GET(request("/api/health?deep=1"));
    expect(response.status).toBe(401);
  });

  it("rejects the deep check with the wrong bearer token", async () => {
    vi.stubEnv("HEALTH_TOKEN", "correct-token");
    const response = await GET(request("/api/health?deep=1", { authorization: "Bearer wrong-token" }));
    expect(response.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("runs the deep check and reports db: ok with the right token", async () => {
    vi.stubEnv("HEALTH_TOKEN", "correct-token");
    const response = await GET(request("/api/health?deep=1", { authorization: "Bearer correct-token" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe("ok");
    expect(body.rateLimit).toBeTypeOf("object");
    expect(body.catalog).toBeTypeOf("object");
  });

  it("flips db to fail and returns 503 with Retry-After when the query errors", async () => {
    vi.stubEnv("HEALTH_TOKEN", "correct-token");
    mockSelect.mockResolvedValue({ error: { message: "connection refused" }, data: null });
    const response = await GET(request("/api/health?deep=1", { authorization: "Bearer correct-token" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.db).toBe("fail");
  });

  it("flips db to fail and reports when the query throws", async () => {
    vi.stubEnv("HEALTH_TOKEN", "correct-token");
    mockSelect.mockRejectedValue(new Error("network down"));
    const response = await GET(request("/api/health?deep=1", { authorization: "Bearer correct-token" }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.db).toBe("fail");
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), { scope: "health-deep" });
  });

  it("never exposes secret-looking keys, hostnames or raw error text", async () => {
    vi.stubEnv("HEALTH_TOKEN", "correct-token");
    mockSelect.mockRejectedValue(new Error("password=supersecret host=db.internal.example.com"));
    const response = await GET(request("/api/health?deep=1", { authorization: "Bearer correct-token" }));
    const text = JSON.stringify(await response.json());
    expect(text).not.toMatch(/password|supersecret|internal\.example\.com|SUPABASE|KEY|SECRET|TOKEN/i);
  });
});
