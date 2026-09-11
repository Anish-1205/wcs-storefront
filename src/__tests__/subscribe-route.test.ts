import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInsert = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

// The route reads SUPABASE_SERVICE_ROLE_KEY at module scope, so it has to be
// set before the import below is evaluated.
vi.hoisted(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: () => ({ insert: mockInsert }) }),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));

import { POST } from "@/app/api/subscribe/route";

const validPayload = {
  name: "Riya",
  phone: "+91 98765 43210",
  source: "direct",
  website: "",
};

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("subscribe route", () => {
  beforeEach(() => {
    mockInsert.mockReset().mockResolvedValue({ error: null });
    mockCheckRateLimit.mockReset().mockResolvedValue({ success: true });
  });

  it("stores a validated subscriber through the service-role client", async () => {
    const response = await post(validPayload);
    expect(response.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Riya", source: "direct" }),
    );
  });

  it("does not store honeypot submissions", async () => {
    const response = await post({ ...validPayload, website: "https://spam.invalid" });
    expect(response.status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("enforces rate limiting before parsing", async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 });
    const response = await post({});
    expect(response.status).toBe(429);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
