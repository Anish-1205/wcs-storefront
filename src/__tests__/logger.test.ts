import { afterEach, describe, expect, it, vi } from "vitest";
import { log, redact, requestIdFrom } from "@/lib/logger";

afterEach(() => vi.restoreAllMocks());

describe("structured logging redacts personal data and credentials (T2.6)", () => {
  it("drops values under personal or secret keys", () => {
    expect(redact({
      phone: "919876543210",
      email: "someone@example.com",
      contact_name: "Asha",
      message: "Call me on 98765 43210",
      caption: "Red silk",
      apiKey: "sk-123",
      authorization: "Bearer abc",
      token: "t",
      productId: "p-1",
      count: 3,
    })).toEqual({
      phone: "[personal]",
      email: "[personal]",
      contact_name: "[personal]",
      message: "[personal]",
      caption: "[personal]",
      apiKey: "[redacted]",
      authorization: "[redacted]",
      token: "[redacted]",
      productId: "p-1",
      count: 3,
    });
  });

  it("masks e-mails, phone numbers and bearer tokens inside any string", () => {
    expect(redact("from someone@example.com about +91 98765-43210, Bearer eyJhbGciOi.x.y")).toBe(
      "from [email] about [phone …3210], Bearer [redacted]",
    );
    // Short numbers (prices, counts, years) are left alone.
    expect(redact("7 photos, ₹4500, 2026")).toBe("7 photos, ₹4500, 2026");
  });

  it("redacts nested objects, arrays and errors", () => {
    expect(redact({ meta: { inner: [{ email: "a@b.co" }, "x@y.io"] }, err: new Error("failed for a@b.co") })).toEqual({
      meta: { inner: [{ email: "[personal]" }, "[email]"] },
      err: { error: "Error", message: "failed for [email]" },
    });
  });

  it("writes one JSON line with level, scope and the request id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    log("warn", "upload", "denied for a@b.co", { requestId: "req-1", reason: "forbidden" });
    const line = JSON.parse(warn.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "warn", scope: "upload", message: "denied for [email]", requestId: "req-1", reason: "forbidden" });
  });

  it("reads the request id middleware set, else the platform's", () => {
    expect(requestIdFrom(new Request("http://x", { headers: { "x-request-id": "a" } }))).toBe("a");
    expect(requestIdFrom(new Request("http://x", { headers: { "x-vercel-id": "bom1::b" } }))).toBe("bom1::b");
    expect(requestIdFrom(new Request("http://x"))).toBeUndefined();
  });
});
