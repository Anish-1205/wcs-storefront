import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mockGetUser = vi.hoisted(() => vi.fn());
const mockSignUpload = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

vi.mock("@/lib/cloudinary", () => ({
  signUpload: mockSignUpload,
}));

// The real rateLimitResponse, so 429 vs 503 is decided by the helper itself.
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: mockCheckRateLimit,
}));

import { POST } from "@/app/api/upload/route";

describe("upload route auth", () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = "admin@example.com";
    mockCheckRateLimit.mockResolvedValue({ success: true, degraded: false, retryAfter: 0 });
    mockSignUpload.mockResolvedValue({
      signature: "sig",
      apiKey: "key",
      cloudName: "cloud",
      uploadUrl: "https://upload.example.com",
    });
    mockGetUser.mockReset();
    mockSignUpload.mockClear();
    mockCheckRateLimit.mockClear();
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAILS;
    vi.restoreAllMocks();
  });

  it("returns 401 for unauthenticated requests", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(new Request("http://localhost/api/upload", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mockSignUpload).not.toHaveBeenCalled();
    expect(JSON.parse(warnSpy.mock.calls.at(-1)![0] as string)).toMatchObject({ scope: "upload", message: "upload signing denied: unauthenticated" });
  });

  it("returns 403 for authenticated non-admin users", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockGetUser.mockResolvedValue({ data: { user: { email: "staff@example.com" } } });

    const response = await POST(new Request("http://localhost/api/upload", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(mockSignUpload).not.toHaveBeenCalled();
    expect(JSON.parse(warnSpy.mock.calls.at(-1)![0] as string)).toMatchObject({ scope: "upload", message: "upload signing denied: forbidden" });
  });

  it("refuses with 503 when the limiter itself is unavailable", async () => {
    // T1.7: this endpoint fails CLOSED. Auth keeps strangers out; the bucket
    // is what bounds a runaway client against real Cloudinary quota, so with
    // no limiter there is nothing left to bound it.
    mockGetUser.mockResolvedValue({ data: { user: { email: "admin@example.com" } } });
    mockCheckRateLimit.mockResolvedValue({ success: false, degraded: true, retryAfter: 30 });

    const response = await POST(new Request("http://localhost/api/upload", { method: "POST" }));

    // 503, not 429 — the admin did nothing wrong.
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(mockSignUpload).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).toHaveBeenCalledWith(expect.anything(), { failure: "closed" });
  });

  it("returns the signed payload for admins", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: "admin@example.com" } } });

    const response = await POST(new Request("http://localhost/api/upload", { method: "POST" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      signature: "sig",
      apiKey: "key",
      cloudName: "cloud",
      uploadUrl: "https://upload.example.com",
      folder: "sarees",
    });
    expect(mockSignUpload).toHaveBeenCalledTimes(1);
    // "auto" lets Cloudinary classify image vs video per file, so the admin
    // panel's variant image uploader can accept video too (previously
    // hardcoded to "image", which rejected any video file with a Cloudinary
    // upload error).
    expect(mockSignUpload).toHaveBeenCalledWith(expect.objectContaining({ folder: "sarees" }), "auto");
  });
});