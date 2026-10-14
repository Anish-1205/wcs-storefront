import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The hidden-slug copy kept in Redis, used only when Supabase cannot answer. */
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  report: vi.fn(),
  constructed: 0,
  config: undefined as unknown,
}));

vi.mock("@/lib/report-error", () => ({ reportError: mocks.report }));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor(config: unknown) {
      mocks.constructed += 1;
      mocks.config = config;
    }
    get = mocks.get;
    set = mocks.set;
  },
}));

import {
  readVisibilityMirror,
  resetVisibilityMirrorClient,
  writeVisibilityMirror,
} from "@/lib/catalog-visibility-mirror";

const record = (slugs: string[], at = 1_760_000_000_000) => ({ slugs, at });

beforeEach(() => {
  vi.resetAllMocks();
  resetVisibilityMirrorClient();
  mocks.constructed = 0;
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.com";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  mocks.set.mockResolvedValue("OK");
});

afterEach(() => vi.useRealTimers());

describe("reading the mirror", () => {
  it("returns the mirrored hidden set", async () => {
    mocks.get.mockResolvedValue(record(["a", "b"]));

    expect(await readVisibilityMirror()).toEqual({ slugs: ["a", "b"], at: 1_760_000_000_000 });
  });

  it("accepts the record as a JSON string, as Redis may hand it back", async () => {
    mocks.get.mockResolvedValue(JSON.stringify(record(["a"])));

    expect((await readVisibilityMirror())?.slugs).toEqual(["a"]);
  });

  it("returns an empty set when the mirror genuinely records nothing hidden", async () => {
    mocks.get.mockResolvedValue(record([]));

    expect(await readVisibilityMirror()).toEqual({ slugs: [], at: 1_760_000_000_000 });
  });

  it.each([
    ["nothing stored", null],
    ["unparseable text", "{oops"],
    ["no timestamp", { slugs: ["a"] }],
    ["a timestamp that is not a number", { slugs: ["a"], at: "yesterday" }],
    ["no slug list", { at: 1_760_000_000_000 }],
    ["a slug that is not a string", { slugs: ["a", 7], at: 1_760_000_000_000 }],
    ["an empty slug", { slugs: [""], at: 1_760_000_000_000 }],
  ])("treats %s as no mirror rather than as an empty hidden list", async (_name, stored) => {
    mocks.get.mockResolvedValue(stored);

    expect(await readVisibilityMirror()).toBeNull();
  });

  it("reports a Redis failure and carries on without a mirror", async () => {
    mocks.get.mockRejectedValue(new Error("connection reset"));

    expect(await readVisibilityMirror()).toBeNull();
    expect(mocks.report.mock.calls[0][1]).toMatchObject({ scope: "catalog-visibility-mirror", op: "read" });
  });

  it("gives up quickly rather than holding a page open", async () => {
    vi.useFakeTimers();
    mocks.get.mockImplementation(() => new Promise(() => {}));

    const pending = readVisibilityMirror();
    await vi.advanceTimersByTimeAsync(1500);

    expect(await pending).toBeNull();
  });

  it("never asks for a no-store fetch, which would turn a static page dynamic mid-render", async () => {
    mocks.get.mockResolvedValue(null);
    await readVisibilityMirror();

    expect(mocks.config).toMatchObject({ cache: "default" });
  });

  it("does nothing at all when Upstash is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    resetVisibilityMirrorClient();

    expect(await readVisibilityMirror()).toBeNull();
    expect(mocks.constructed).toBe(0);
    expect(mocks.report).not.toHaveBeenCalled();
  });
});

describe("writing the mirror", () => {
  it("stores the sorted slugs with a timestamp and an expiry", async () => {
    expect(await writeVisibilityMirror(["b", "a"], 1_760_000_000_000)).toBe(true);

    const [key, value, options] = mocks.set.mock.calls[0];
    expect(key).toBe("wcs:catalog:hidden-slugs");
    expect(JSON.parse(value as string)).toEqual({ slugs: ["a", "b"], at: 1_760_000_000_000 });
    expect(options).toMatchObject({ ex: expect.any(Number) });
  });

  it("writes nothing the second time the set has not changed", async () => {
    await writeVisibilityMirror(["a", "b"]);
    await writeVisibilityMirror(["b", "a"]);

    expect(mocks.set).toHaveBeenCalledTimes(1);
  });

  it("writes again as soon as the set does change", async () => {
    await writeVisibilityMirror(["a"]);
    await writeVisibilityMirror(["a", "b"]);
    await writeVisibilityMirror([]);

    expect(mocks.set).toHaveBeenCalledTimes(3);
  });

  it("reports a failed write and retries it later rather than assuming it stuck", async () => {
    vi.useFakeTimers();
    mocks.set.mockRejectedValueOnce(new Error("redis down"));

    expect(await writeVisibilityMirror(["a"])).toBe(false);
    expect(mocks.report.mock.calls[0][1]).toMatchObject({ scope: "catalog-visibility-mirror", op: "write", slugCount: 1 });

    // The same set is retried once the back-off window has passed, because the
    // failed write was never recorded as current.
    vi.advanceTimersByTime(30_001);
    mocks.set.mockResolvedValue("OK");
    expect(await writeVisibilityMirror(["a"])).toBe(true);
    expect(mocks.set).toHaveBeenCalledTimes(2);
  });

  it("never stores anything but slugs and a timestamp", async () => {
    await writeVisibilityMirror(["purple-tanchoi-silk"]);

    expect(Object.keys(JSON.parse(mocks.set.mock.calls[0][1] as string)).sort()).toEqual(["at", "slugs"]);
  });
});

describe("backing off when Redis is unreachable", () => {
  it("stops calling Redis for a while after a failed read, so a fallback render pays the wait once", async () => {
    mocks.get.mockRejectedValue(new Error("connection reset"));

    expect(await readVisibilityMirror()).toBeNull();
    expect(await readVisibilityMirror()).toBeNull();
    expect(await readVisibilityMirror()).toBeNull();

    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("reports an unreachable mirror once per window, not once per page view", async () => {
    mocks.get.mockRejectedValue(new Error("connection reset"));

    for (let read = 0; read < 25; read += 1) await readVisibilityMirror();

    expect(mocks.report).toHaveBeenCalledTimes(1);
  });

  it("skips the write too while backing off, and tries again once the window passes", async () => {
    vi.useFakeTimers();
    mocks.get.mockRejectedValue(new Error("connection reset"));
    await readVisibilityMirror();

    expect(await writeVisibilityMirror(["a"])).toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_001);
    mocks.set.mockResolvedValue("OK");
    expect(await writeVisibilityMirror(["a"])).toBe(true);
  });
});
