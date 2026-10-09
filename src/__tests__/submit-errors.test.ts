import { describe, expect, it, vi } from "vitest";

/**
 * What a customer is told when a form POST is refused.
 *
 * The two cases worth distinguishing: 429 (their own budget — waiting works)
 * and 503 (our rate limiter is unavailable — nothing to do with them, and
 * WhatsApp still reaches us). Everything else stays each form's own wording.
 */
const mocks = vi.hoisted(() => ({ whatsappConfigured: true }));

vi.mock("@/lib/whatsapp", () => ({
  get WHATSAPP_CONFIGURED() {
    return mocks.whatsappConfigured;
  },
}));

import { describeSubmitFailure, retryAfterSeconds } from "@/lib/submit-errors";

const refused = (status: number, retryAfter?: string) =>
  new Response("{}", { status, headers: retryAfter ? { "Retry-After": retryAfter } : {} });

describe("a 429 — the caller's own budget", () => {
  it("says waiting will work, and quotes the server's own wait", () => {
    const failure = describeSubmitFailure(refused(429, "600"));

    expect(failure).toMatchObject({ kind: "limited", retryAfterSeconds: 600 });
    expect(failure?.message).toContain("10 minutes");
    expect(failure?.message).toContain("try again");
  });

  it("rounds a short wait to a minute rather than a countdown", () => {
    expect(describeSubmitFailure(refused(429, "30"))?.message).toContain("a minute");
  });

  it("stays vague when there is no usable Retry-After", () => {
    for (const header of [undefined, "", "soon", "0", "-5", "Wed, 21 Oct 2026 07:28:00 GMT", "999999"]) {
      const failure = describeSubmitFailure(refused(429, header));

      expect(failure?.retryAfterSeconds).toBeNull();
      expect(failure?.message).toContain("a few minutes");
    }
  });
});

describe("a 503 — our limiter is unavailable", () => {
  it("does not blame the customer, and points at WhatsApp", () => {
    mocks.whatsappConfigured = true;

    const failure = describeSubmitFailure(refused(503, "30"));

    expect(failure).toMatchObject({ kind: "unavailable", retryAfterSeconds: 30 });
    expect(failure?.message).toContain("nothing to do with your details");
    expect(failure?.message).toContain("WhatsApp");
  });

  it("points at the contact page when no WhatsApp number is configured", () => {
    mocks.whatsappConfigured = false;

    const failure = describeSubmitFailure(refused(503));

    expect(failure?.message).toContain("contact page");
    expect(failure?.message).not.toContain("WhatsApp");

    mocks.whatsappConfigured = true;
  });
});

describe("anything else", () => {
  it("leaves the form its own wording", () => {
    for (const status of [400, 401, 403, 404, 418, 500, 502, 504]) {
      expect(describeSubmitFailure(refused(status))).toBeNull();
    }
  });
});

describe("reading Retry-After", () => {
  it.each([
    ["60", 60],
    [" 90 ", 90],
    ["1.4", 2],
    ["86400", 86_400],
  ])("accepts %s", (header, expected) => {
    expect(retryAfterSeconds(header)).toBe(expected);
  });

  it.each(["", "   ", "abc", "0", "-1", "NaN", "Infinity", "86401"])("ignores %s", (header) => {
    expect(retryAfterSeconds(header)).toBeNull();
  });

  it("ignores a missing header", () => {
    expect(retryAfterSeconds(null)).toBeNull();
  });
});
