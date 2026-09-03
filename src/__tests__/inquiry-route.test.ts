import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInsert = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: () => ({ insert: mockInsert }) }),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));

import { POST } from "@/app/api/inquiries/route";

const validPayload = {
  name: "Asha",
  phone: "+91 98765 43210",
  email: "",
  message: "Please confirm availability",
  inquiry_type: "retail",
  product_id: null,
  variant_id: null,
  product_name: null,
  source: "direct",
  website: "",
};

describe("inquiry route", () => {
  beforeEach(() => {
    mockInsert.mockReset().mockResolvedValue({ error: null });
    mockCheckRateLimit.mockReset().mockResolvedValue({ success: true });
  });

  it("stores a validated inquiry through the server client", async () => {
    const response = await POST(new Request("http://localhost/api/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    }));
    expect(response.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ name: "Asha", source: "direct" }));
  });

  it("does not store honeypot submissions", async () => {
    const response = await POST(new Request("http://localhost/api/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validPayload, website: "https://spam.invalid" }),
    }));
    expect(response.status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("enforces rate limiting before parsing", async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 });
    const response = await POST(new Request("http://localhost/api/inquiries", { method: "POST", body: "{}" }));
    expect(response.status).toBe(429);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
