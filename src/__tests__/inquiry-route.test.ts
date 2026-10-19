import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.hoisted(() => vi.fn());
const mockReportError = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({ Resend: class { emails = { send: mockSend }; } }));
vi.mock("@/lib/report-error", () => ({ reportError: mockReportError }));

const mockInsert = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: () => ({ insert: mockInsert, upsert: (...args: unknown[]) => ({ select: () => mockUpsert(...args) }) }),
  }),
}));

// The real rateLimitResponse, so 429 vs 503 is decided by the helper itself.
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: mockCheckRateLimit,
}));

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
    mockUpsert.mockReset();
    mockSend.mockReset().mockResolvedValue({ error: null });
    mockCheckRateLimit.mockReset().mockResolvedValue({ success: true });
  });

  describe("idempotency key (T4.9)", () => {
    const KEY = "11111111-2222-4333-8444-555555555555";
    const post = () => POST(new Request("http://localhost/api/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validPayload, client_request_id: KEY }),
    }));

    it("two identical POSTs store one enquiry and send one e-mail", async () => {
      process.env.RESEND_API_KEY = "re_test";
      process.env.INQUIRY_NOTIFICATION_EMAIL = "owner@example.com";
      try {
        mockUpsert.mockResolvedValueOnce({ data: [{ id: "i-1" }], error: null }).mockResolvedValueOnce({ data: [], error: null });
        expect((await post()).status).toBe(200);
        expect((await post()).status).toBe(200);
        expect(mockUpsert).toHaveBeenCalledTimes(2);
        expect(mockUpsert.mock.calls[0][0]).toMatchObject({ client_request_id: KEY });
        expect(mockUpsert.mock.calls[0][1]).toEqual({ onConflict: "client_request_id", ignoreDuplicates: true });
        expect(mockSend).toHaveBeenCalledTimes(1);
      } finally {
        delete process.env.RESEND_API_KEY;
        delete process.env.INQUIRY_NOTIFICATION_EMAIL;
      }
    });

    it("a database from before migration 037 still gets the enquiry, without the key", async () => {
      mockUpsert.mockResolvedValue({ data: null, error: { code: "PGRST204", message: "Could not find the 'client_request_id' column of 'inquiries'" } });
      expect((await post()).status).toBe(200);
      expect(mockInsert).toHaveBeenCalledWith(expect.not.objectContaining({ client_request_id: expect.anything() }));
    });

    it("rejects a key that is not a UUID", async () => {
      const response = await POST(new Request("http://localhost/api/inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...validPayload, client_request_id: "not-a-uuid" }),
      }));
      expect(response.status).toBe(400);
    });
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
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60, degraded: false });
    const response = await POST(new Request("http://localhost/api/inquiries", { method: "POST", body: "{}" }));
    expect(response.status).toBe(429);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("still records the lead when the limiter itself is unavailable", async () => {
    // T1.7: this endpoint fails OPEN. A Redis outage used to 500 here, which
    // lost the enquiry; the limiter now reports and steps aside.
    mockCheckRateLimit.mockResolvedValue({ success: true, retryAfter: 30, degraded: true });

    const response = await POST(new Request("http://localhost/api/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    }));

    expect(response.status).toBe(200);
    expect(mockInsert).toHaveBeenCalled();
    expect(mockCheckRateLimit).toHaveBeenCalledWith(expect.anything(), { failure: "open" });
  });

  it("keeps validating and keeps the honeypot shut while the limiter is unavailable", async () => {
    mockCheckRateLimit.mockResolvedValue({ success: true, retryAfter: 30, degraded: true });

    const invalid = await POST(new Request("http://localhost/api/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validPayload, phone: "" }),
    }));
    expect(invalid.status).toBe(400);

    const bot = await POST(new Request("http://localhost/api/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validPayload, website: "https://spam.invalid" }),
    }));
    expect(bot.status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});


it("F21 reports resolved Resend API errors while preserving the saved inquiry", async () => {
  vi.stubEnv("RESEND_API_KEY", "test"); vi.stubEnv("INQUIRY_NOTIFICATION_EMAIL", "test@example.invalid");
  mockCheckRateLimit.mockResolvedValue({ success: true });
  mockInsert.mockResolvedValue({ error: null });
  mockSend.mockResolvedValue({ data: null, error: { message: "Invalid API key" } });
  try {
    const response = await POST(new Request("http://localhost/api/inquiries", { method: "POST", body: JSON.stringify(validPayload) }));
    expect(response.status).toBe(200);
    expect(mockReportError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Invalid API key") }), { scope: "inquiry-notification" });
  } finally { vi.unstubAllEnvs(); }
});
