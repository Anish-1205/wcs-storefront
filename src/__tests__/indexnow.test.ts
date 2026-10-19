import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn();
vi.mock("@/lib/report-error", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { resetIndexNow, submitToIndexNow } from "@/lib/indexnow";
import { GET } from "@/app/api/indexnow-key/route";

const KEY = "test-key-test-key";
let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetIndexNow();
  reportError.mockReset();
  fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 202 });
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://weaversclubsarees.com");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("IndexNow (T5.8)", () => {
  it("does nothing without a key", async () => {
    expect(await submitToIndexNow(["/sarees/a"])).toEqual({ submitted: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("submits only the changed URLs, once per window", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);
    expect((await submitToIndexNow(["/sarees/a", "/sarees/a"])).submitted).toEqual(["https://weaversclubsarees.com/sarees/a"]);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toEqual({ host: "weaversclubsarees.com", key: KEY, keyLocation: `https://weaversclubsarees.com/${KEY}.txt`, urlList: ["https://weaversclubsarees.com/sarees/a"] });
    expect((await submitToIndexNow(["/sarees/a"])).submitted).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a failure is reported, never thrown", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);
    fetchSpy.mockRejectedValue(new Error("offline"));
    await expect(submitToIndexNow(["/sarees/b"])).resolves.toEqual({ submitted: [] });
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("the key file answers only for the configured key", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);
    const ok = await GET(new Request(`http://x/api/indexnow-key?k=${KEY}`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe(KEY);
    expect((await GET(new Request("http://x/api/indexnow-key?k=guessing123"))).status).toBe(404);
    vi.stubEnv("INDEXNOW_KEY", "");
    expect((await GET(new Request(`http://x/api/indexnow-key?k=${KEY}`))).status).toBe(404);
  });
});
