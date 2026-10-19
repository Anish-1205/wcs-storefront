import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ rpc }) }));
const reportError = vi.fn();
vi.mock("@/lib/report-error", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

import {
  dailyCap,
  isSpendLimit,
  resetAiBudgetForTests,
  sendAnthropicRequest,
  startOfNextUtcMonth,
} from "@/lib/ai/budget";

const request = { model: "m", max_tokens: 10, system: "s", messages: [] };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });

function reserveAnswers(answer: string) {
  rpc.mockImplementation(async (name: string) => ({ data: name === "ai_try_reserve" ? answer : null, error: null }));
}

beforeEach(() => {
  resetAiBudgetForTests();
  rpc.mockReset();
  reportError.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.AI_KILL_SWITCH;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_DAILY_CAP_LISTING;
});

describe("the AI budget gate refuses before any HTTP call", () => {
  it.each(["cap", "paused", "kill_switch"])("ledger says %s: no request", async (answer) => {
    reserveAnswers(answer);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await sendAnthropicRequest("listing", request, { timeoutMs: 1000 });
    expect(result).toEqual({ body: null, denied: answer });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("AI_KILL_SWITCH=1 refuses without even asking the ledger", async () => {
    process.env.AI_KILL_SWITCH = "1";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await sendAnthropicRequest("metadata", request, { timeoutMs: 1000 })).denied).toBe("kill_switch");
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the ledger cannot be reached, and reports it once", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function ai_try_reserve does not exist" } });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (let i = 0; i < 3; i++) {
      expect((await sendAnthropicRequest("metadata", request, { timeoutMs: 1000 })).denied).toBe("ledger_unavailable");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("not configured: no ledger call and no request", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await sendAnthropicRequest("metadata", request, { timeoutMs: 1000 })).denied).toBe("not_configured");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("a paid call is made once and never retried", () => {
  it.each([
    ["the organisation's own limit", 400, { error: { type: "invalid_request_error", message: "You have reached your specified API usage limits." } }],
    ["the tier cap", 429, { error: { type: "rate_limit_error", message: "x", details: { error_code: "enforced_spend_limit_reached" } } }],
  ])("%s pauses AI until the next UTC month", async (_label, status, body) => {
    reserveAnswers("ok");
    const fetchSpy = vi.fn().mockResolvedValue(fail(status, body));
    vi.stubGlobal("fetch", fetchSpy);
    expect((await sendAnthropicRequest("listing", request, { timeoutMs: 1000 })).body).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const pause = rpc.mock.calls.find(([name]) => name === "ai_pause");
    expect(pause?.[1].p_until).toBe(startOfNextUtcMonth().toISOString());
  });

  it.each([[500], [529], [429]])("a %s that is not a spend limit is not retried and does not pause", async (status) => {
    reserveAnswers("ok");
    const fetchSpy = vi.fn().mockResolvedValue(fail(status, { error: { type: "overloaded_error", message: "busy" } }));
    vi.stubGlobal("fetch", fetchSpy);
    await sendAnthropicRequest("listing", request, { timeoutMs: 1000 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.some(([name]) => name === "ai_pause")).toBe(false);
  });

  it("a network error is not retried", async () => {
    reserveAnswers("ok");
    const fetchSpy = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchSpy);
    expect((await sendAnthropicRequest("listing", request, { timeoutMs: 1000 })).body).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("records the tokens the response reports", async () => {
    reserveAnswers("ok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ content: [], usage: { input_tokens: 1200, output_tokens: 80 } })));
    await sendAnthropicRequest("collection", request, { timeoutMs: 1000 });
    expect(rpc).toHaveBeenCalledWith("ai_record_usage", { p_feature: "collection", p_input: 1200, p_output: 80 });
  });
});

describe("limits", () => {
  it("holds a third concurrent call until a slot frees", async () => {
    reserveAnswers("ok");
    const pending: Array<() => void> = [];
    const fetchSpy = vi.fn(() => new Promise((resolve) => pending.push(() => resolve(ok({ content: [] })))));
    vi.stubGlobal("fetch", fetchSpy);
    const calls = [1, 2, 3].map(() => sendAnthropicRequest("metadata", request, { timeoutMs: 5000 }));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    pending.shift()!();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
    pending.forEach((resolve) => resolve());
    await Promise.all(calls);
  });

  it("daily caps come from AI_DAILY_CAP_<FEATURE>, with a safe default for a bad value", () => {
    expect(dailyCap("listing")).toBe(200);
    process.env.AI_DAILY_CAP_LISTING = "25";
    expect(dailyCap("listing")).toBe(25);
    process.env.AI_DAILY_CAP_LISTING = "lots";
    expect(dailyCap("listing")).toBe(200);
  });

  it("recognises only the two documented spend-limit answers", () => {
    expect(isSpendLimit(429, { error: { type: "rate_limit_error", details: { error_code: "enforced_spend_limit_reached" } } })).toBe(true);
    expect(isSpendLimit(429, { error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" } })).toBe(false);
    expect(isSpendLimit(400, { error: { type: "invalid_request_error", message: "You have reached your specified API usage limits" } })).toBe(true);
    expect(isSpendLimit(400, { error: { type: "invalid_request_error", message: "messages: field required" } })).toBe(false);
    expect(startOfNextUtcMonth(new Date("2026-12-31T23:59:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("only budget.ts talks to Anthropic", () => {
  it("no other file under src/ contains the API URL", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { if (name !== "__tests__") walk(path); continue; }
        if (/\.(ts|tsx|js|mjs)$/.test(name) && readFileSync(path, "utf8").includes("api.anthropic.com")) hits.push(path.replace(/\\/g, "/"));
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits).toEqual([expect.stringMatching(/src\/lib\/ai\/budget\.ts$/)]);
  });
});
