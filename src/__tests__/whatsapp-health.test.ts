import { beforeEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn();
vi.mock("@/lib/report-error", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { alertOnQueue, getWhatsAppQueueHealth, messageRef, resetWhatsAppHealth } from "@/lib/whatsapp-health";

beforeEach(() => {
  resetWhatsAppHealth();
  reportError.mockReset();
});

describe("WhatsApp tracing and alerting (T6.8)", () => {
  it("never sends a message id, which contains the sender's phone number, only a short hash", () => {
    const id = "wamid.HBgMOTE4MzY5NzM0OTE0FQIAEhggQUM1RDY0NjRGNjhGNTQ1MDVFODc0MzlFMTNGN0M5RDAA";
    expect(Buffer.from(id.slice(6, 26), "base64").toString("latin1")).toContain("918369734914");
    const ref = messageRef(id)!;
    expect(ref).toMatch(/^[0-9a-f]{12}$/);
    expect(messageRef(id)).toBe(ref);
    expect(messageRef(null)).toBeNull();
  });

  it("raises one grouped issue per condition, at most once per half hour", () => {
    expect(alertOnQueue({ deadLast24h: 2, oldestUnsettledSec: 1200 })).toEqual(["dead", "stuck"]);
    expect(alertOnQueue({ deadLast24h: 3, oldestUnsettledSec: 1300 })).toEqual([]);
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError.mock.calls.map(([e]) => (e as Error).message)).toEqual([
      "WhatsApp messages dead-lettered in the last 24 h",
      "A WhatsApp message has been unsettled for over 15 minutes",
    ]);
  });

  it("a healthy queue raises nothing", () => {
    expect(alertOnQueue({ deadLast24h: 0, oldestUnsettledSec: 120 })).toEqual([]);
    expect(alertOnQueue({ deadLast24h: 0, oldestUnsettledSec: null })).toEqual([]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reads dead letters and the oldest unsettled message", async () => {
    const createdAt = new Date(Date.now() - 600_000).toISOString();
    const chain = (result: unknown) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "in", "order"]) c[m] = () => c;
      c.limit = async () => result;
      c.then = (resolve: (v: unknown) => unknown) => resolve(result);
      return c;
    };
    let call = 0;
    const admin = { from: () => (call++ === 0 ? chain({ count: 1, error: null }) : chain({ data: [{ created_at: createdAt }], error: null })) };
    const health = await getWhatsAppQueueHealth(admin as never);
    expect(health.deadLast24h).toBe(1);
    expect(health.oldestUnsettledSec).toBeGreaterThanOrEqual(599);
  });
});
