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

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

import { POST } from "@/app/api/upload/route";

describe("upload route auth", () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = "admin@example.com";
    mockCheckRateLimit.mockResolvedValue({ success: true });
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
    expect(warnSpy).toHaveBeenCalledWith("upload signing denied: unauthenticated");
  });

  it("returns 403 for authenticated non-admin users", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockGetUser.mockResolvedValue({ data: { user: { email: "staff@example.com" } } });

    const response = await POST(new Request("http://localhost/api/upload", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(mockSignUpload).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("upload signing denied: forbidden");
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
  });
});