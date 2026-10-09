import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The limiter's own failure policy: what each endpoint gets when Upstash
 * cannot be consulted at all.
 *
 * The real `src/lib/rate-limit.ts` is under test; only the two Upstash
 * packages are stood in for. The Redis stand-in keeps the one behaviour that
 * matters here — the real client throws for a URL that is not https, which is
 * why the client is built lazily rather than at module load.
 */
const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  report: vi.fn(),
  constructed: 0,
}));

vi.mock("@/lib/report-error", () => ({ reportError: mocks.report }));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor({ url }: { url: string; token: string }) {
      mocks.constructed += 1;
      if (!url.startsWith("https://")) throw new Error("Upstash Redis client was passed an invalid URL");
    }
  },
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = (limit: number, window: string) => ({ limit, window });
    limit(key: string) {
      return mocks.limit(key);
    }
  },
}));

import {
  checkImportRateLimit,
  checkRateLimit,
  getRateLimitStatus,
  rateLimitResponse,
  resetRateLimitState,
} from "@/lib/rate-limit";

const BACK_OFF_MS = 30_000;

const allowed = () => ({ success: true, limit: 5, remaining: 4, reset: Date.now() + 600_000 });
const exhausted = () => ({ success: false, limit: 5, remaining: 0, reset: Date.now() + 120_000 });
const unreachable = () => Promise.reject(new TypeError("fetch failed"));
const hangs = () => new Promise(() => {});

const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/inquiries", { method: "POST", headers });

beforeEach(() => {
  vi.resetAllMocks();
  resetRateLimitState();
  mocks.constructed = 0;
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  mocks.limit.mockResolvedValue(allowed());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("while the limiter is healthy", () => {
  it("allows a request inside the budget and reports nothing", async () => {
    const result = await checkRateLimit(request(), { failure: "open" });

    expect(result).toMatchObject({ success: true, degraded: false, limit: 5, remaining: 4 });
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(rateLimitResponse(result)).toBeNull();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("refuses a caller that spent its budget with 429 and a Retry-After", async () => {
    mocks.limit.mockResolvedValue(exhausted());

    const response = rateLimitResponse(await checkRateLimit(request(), { failure: "open" }));

    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(response?.json()).resolves.toMatchObject({ error: expect.stringContaining("Too many requests") });
  });

  it("builds the Redis client once, however many checks run", async () => {
    await checkRateLimit(request(), { failure: "open" });
    await checkRateLimit(request(), { failure: "open" });
    await checkImportRateLimit(request(), { failure: "closed" });

    expect(mocks.constructed).toBe(1);
  });
});

describe("when the limiter cannot be consulted", () => {
  const failures: [string, () => void][] = [
    ["Upstash is unreachable", () => mocks.limit.mockImplementation(unreachable)],
    ["Upstash answers an error", () => mocks.limit.mockRejectedValue(new Error("max daily request limit exceeded"))],
  ];

  it.each(failures)("lets a fail-open caller through when %s", async (_name, fail) => {
    fail();

    const result = await checkRateLimit(request(), { failure: "open" });

    expect(result).toMatchObject({ success: true, degraded: true });
    expect(rateLimitResponse(result)).toBeNull();
  });

  it.each(failures)("refuses a fail-closed caller with 503 when %s", async (_name, fail) => {
    fail();

    const result = await checkRateLimit(request(), { failure: "closed" });
    const response = rateLimitResponse(result);

    expect(result).toMatchObject({ success: false, degraded: true });
    // 503, not 429: the caller did nothing wrong, the limiter is down.
    expect(response?.status).toBe(503);
    expect(response?.headers.get("Retry-After")).toBe("30");
    await expect(response?.json()).resolves.toMatchObject({
      error: expect.stringContaining("temporarily unavailable"),
    });
  });

  it("refuses by default, for an endpoint that states no policy", async () => {
    mocks.limit.mockImplementation(unreachable);

    expect(await checkRateLimit(request())).toMatchObject({ success: false, degraded: true });
    expect(await checkImportRateLimit(request())).toMatchObject({ success: false, degraded: true });
  });

  it("gives up on a limiter that hangs instead of hanging the form with it", async () => {
    vi.useFakeTimers();
    mocks.limit.mockImplementation(hangs);

    const pending = checkRateLimit(request(), { failure: "open" });
    await vi.advanceTimersByTimeAsync(1000);

    expect(await pending).toMatchObject({ success: true, degraded: true });
    expect((mocks.report.mock.calls[0][0] as Error).message).toContain("timed out");
  });

  it("does not retry a failed limiter on every request", async () => {
    vi.useFakeTimers();
    mocks.limit.mockImplementation(unreachable);

    for (let attempt = 0; attempt < 20; attempt += 1) await checkRateLimit(request(), { failure: "open" });
    expect(mocks.limit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(BACK_OFF_MS + 1);
    await checkRateLimit(request(), { failure: "open" });
    expect(mocks.limit).toHaveBeenCalledTimes(2);
  });

  it("keeps applying the policy while it is backing off", async () => {
    mocks.limit.mockImplementation(unreachable);
    await checkRateLimit(request(), { failure: "open" });

    // Second call never reaches Upstash, and still answers per policy.
    expect(await checkRateLimit(request(), { failure: "closed" })).toMatchObject({ success: false, degraded: true });
    expect(await checkRateLimit(request(), { failure: "open" })).toMatchObject({ success: true, degraded: true });
    expect(mocks.limit).toHaveBeenCalledTimes(1);
  });

  it("enforces the budget again as soon as Upstash answers", async () => {
    vi.useFakeTimers();
    mocks.limit.mockImplementation(unreachable);
    await checkRateLimit(request(), { failure: "open" });

    vi.advanceTimersByTime(BACK_OFF_MS + 1);
    mocks.limit.mockResolvedValue(exhausted());

    expect(await checkRateLimit(request(), { failure: "open" })).toMatchObject({ success: false, degraded: false });
  });

  it("backs off each bucket on its own", async () => {
    mocks.limit.mockImplementationOnce(unreachable);
    await checkRateLimit(request(), { failure: "open" });

    // The import bucket has not failed, so it is still consulted.
    expect(await checkImportRateLimit(request(), { failure: "closed" })).toMatchObject({ degraded: false });
  });
});

describe("when the limiter is not configured", () => {
  it("applies the policy instead of throwing, and says it is unconfigured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRateLimitState();

    expect(await checkRateLimit(request(), { failure: "open" })).toMatchObject({ success: true, degraded: true });
    expect(mocks.report.mock.calls[0][1]).toMatchObject({ scope: "rate-limit", configured: false, stage: "configure" });
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("survives a URL the client refuses outright", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "http://localhost:8079";
    resetRateLimitState();

    // The real client throws for a non-https URL. Because it is built lazily,
    // that lands here rather than while the route module is being imported,
    // where no try/catch at the call site could have caught it.
    expect(await checkRateLimit(request(), { failure: "closed" })).toMatchObject({ success: false, degraded: true });
    const causes = mocks.report.mock.calls.map(([error]) => (error as Error).message);
    expect(causes.some((cause) => cause.includes("invalid URL"))).toBe(true);
  });
});

describe("reporting a limiter outage", () => {
  it("reports once per bucket per window, however many requests arrive", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-09T00:00:00Z") });
    mocks.limit.mockImplementation(unreachable);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      vi.advanceTimersByTime(BACK_OFF_MS + 1);
      await checkRateLimit(request(), { failure: "open" });
    }
    expect(mocks.report).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31 * 60 * 1000);
    await checkRateLimit(request(), { failure: "open" });
    expect(mocks.report).toHaveBeenCalledTimes(2);
  });

  it("reports each bucket separately", async () => {
    mocks.limit.mockImplementation(unreachable);

    await checkRateLimit(request(), { failure: "open" });
    await checkImportRateLimit(request(), { failure: "closed" });

    expect(mocks.report.mock.calls.map(([, context]) => (context as { bucket: string }).bucket)).toEqual([
      "public",
      "import",
    ]);
  });

  it("says nothing about the caller", async () => {
    mocks.limit.mockImplementation(unreachable);

    await checkRateLimit(request({ "x-vercel-forwarded-for": "203.0.113.7" }), { failure: "open" });

    const [, context] = mocks.report.mock.calls[0] as [Error, Record<string, unknown>];
    expect(Object.keys(context).sort()).toEqual(["bucket", "configured", "scope", "stage"]);
    expect(JSON.stringify(context)).not.toContain("203.0.113");
  });

  it("decides the same way when reporting itself throws", async () => {
    mocks.report.mockImplementation(() => {
      throw new Error("Sentry is down too");
    });
    mocks.limit.mockImplementation(unreachable);

    expect(await checkRateLimit(request(), { failure: "open" })).toMatchObject({ success: true, degraded: true });
  });

  it("counts failures and degraded decisions for a health check", async () => {
    mocks.limit.mockImplementation(unreachable);
    await checkRateLimit(request(), { failure: "open" });
    await checkRateLimit(request(), { failure: "closed" });

    const status = getRateLimitStatus();

    expect(status).toMatchObject({
      configured: true,
      failures: { public: 1 },
      degradedDecisions: { "public:open": 1, "public:closed": 1 },
      backingOff: ["public"],
    });
    expect(status.lastFailureAt).not.toBeNull();
  });
});

describe("the key the budget is spent against", () => {
  it("ignores a client-supplied x-forwarded-for when the platform sets its own header", async () => {
    await checkRateLimit(
      request({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }),
      { failure: "open" },
    );

    expect(mocks.limit).toHaveBeenCalledWith("203.0.113.7");
  });

  it("prefers x-real-ip behind an ordinary reverse proxy", async () => {
    await checkRateLimit(request({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1" }), {
      failure: "open",
    });

    expect(mocks.limit).toHaveBeenCalledWith("203.0.113.9");
  });

  it("falls back to the leftmost x-forwarded-for entry, and never a later one", async () => {
    await checkRateLimit(request({ "x-forwarded-for": "203.0.113.5, 198.51.100.1" }), { failure: "open" });

    expect(mocks.limit).toHaveBeenCalledWith("203.0.113.5");
  });

  it("puts every unidentifiable caller in one shared bucket", async () => {
    await checkRateLimit(request(), { failure: "open" });
    await checkRateLimit(request({ "x-forwarded-for": "  " }), { failure: "open" });

    expect(mocks.limit).toHaveBeenNthCalledWith(1, "unknown");
    expect(mocks.limit).toHaveBeenNthCalledWith(2, "unknown");
  });
});
