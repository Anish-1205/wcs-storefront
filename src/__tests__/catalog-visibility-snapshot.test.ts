import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fetchHiddenSlugs,
  parseVisibilitySnapshot,
  readSnapshotFile,
  writeVisibilitySnapshot,
} from "@/lib/catalog-visibility-snapshot.mjs";

const URL = "https://project.supabase.co";
const KEY = "anon-key";

/** A PostgREST stand-in serving `slugs` in pages, honouring the Range header. */
function postgrest(slugs: string[], { reportedTotal = slugs.length }: { reportedTotal?: number } = {}) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: { headers: Record<string, string> }) => {
    requests.push({ url, headers: init.headers });
    const [from, to] = init.headers.Range.split("-").map(Number);
    const page = slugs.slice(from, to + 1);
    const range = page.length ? `${from}-${from + page.length - 1}` : "*";
    return new Response(JSON.stringify(page.map((slug) => ({ slug }))), {
      status: 200,
      headers: { "content-range": `${range}/${reportedTotal}` },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

const failing = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
const offline = (async () => {
  throw new TypeError("fetch failed");
}) as unknown as typeof fetch;

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "catalog-snapshot-"));
  file = join(dir, "nested", "catalog-visibility.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reading the hidden slugs for the snapshot", () => {
  it("reads the whole view with the anon key", async () => {
    const { fetchImpl, requests } = postgrest(["a", "b"]);

    expect(await fetchHiddenSlugs({ url: `${URL}/`, anonKey: KEY, fetchImpl })).toEqual(["a", "b"]);
    expect(requests[0].url).toBe(`${URL}/rest/v1/storefront_hidden_slugs?select=slug&order=slug.asc`);
    expect(requests[0].headers.apikey).toBe(KEY);
  });

  it("returns an empty list for an empty view, which is a valid answer", async () => {
    expect(await fetchHiddenSlugs({ url: URL, anonKey: KEY, fetchImpl: postgrest([]).fetchImpl })).toEqual([]);
  });

  it("pages past PostgREST's 1000-row cap instead of silently stopping there", async () => {
    const slugs = Array.from({ length: 2300 }, (_, index) => `slug-${String(index).padStart(4, "0")}`);
    const { fetchImpl, requests } = postgrest(slugs);

    expect(await fetchHiddenSlugs({ url: URL, anonKey: KEY, fetchImpl })).toEqual(slugs);
    expect(requests).toHaveLength(3);
  });

  it.each([
    ["an HTTP error", failing(503)],
    ["a missing view", failing(404)],
    ["no network", offline],
    ["fewer rows than the view reports", postgrest(["a"], { reportedTotal: 5 }).fetchImpl],
    [
      "a row with no slug",
      (async () =>
        new Response(JSON.stringify([{ slug: null }]), { status: 200, headers: { "content-range": "0-0/1" } })) as unknown as typeof fetch,
    ],
    ["no row count", (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch],
  ])("throws on %s rather than returning a short list", async (_name, fetchImpl) => {
    await expect(fetchHiddenSlugs({ url: URL, anonKey: KEY, fetchImpl })).rejects.toThrow();
  });
});

describe("writing the snapshot", () => {
  it("writes a snapshot the storefront will accept", async () => {
    const result = await writeVisibilitySnapshot({ url: URL, anonKey: KEY, file, fetchImpl: postgrest(["a", "b"]).fetchImpl });

    expect(result).toEqual({ ok: true, count: 2 });
    const written = parseVisibilitySnapshot(readFileSync(file, "utf8"));
    expect(written?.hiddenSlugs).toEqual(["a", "b"]);
    expect(readSnapshotFile(file)).not.toBeNull();
  });

  it("contains slugs and a timestamp, and nothing else", async () => {
    await writeVisibilitySnapshot({ url: URL, anonKey: KEY, file, fetchImpl: postgrest(["a"]).fetchImpl });

    const text = readFileSync(file, "utf8");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["generatedAt", "hiddenSlugs", "version"]);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("supabase");
  });

  it("leaves a valid snapshot untouched when the read fails", async () => {
    await writeVisibilitySnapshot({ url: URL, anonKey: KEY, file, fetchImpl: postgrest(["a"]).fetchImpl });
    const before = readFileSync(file, "utf8");

    const result = await writeVisibilitySnapshot({ url: URL, anonKey: KEY, file, fetchImpl: offline });

    expect(result).toMatchObject({ ok: false, keptExisting: true });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("writes nothing at all when the read fails and there was no snapshot", async () => {
    const result = await writeVisibilitySnapshot({ url: URL, anonKey: KEY, file, fetchImpl: failing(500) });

    expect(result).toMatchObject({ ok: false, keptExisting: false });
    expect(readSnapshotFile(file)).toBeNull();
  });

  it("fails without touching the network when Supabase is not configured", async () => {
    const { fetchImpl, requests } = postgrest(["a"]);

    const result = await writeVisibilitySnapshot({ url: undefined, anonKey: undefined, file, fetchImpl });

    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("treats a corrupt file on disk as no snapshot", () => {
    writeFileSync(join(dir, "broken.json"), '{"version":1,"generatedAt":"2026-10-08T00:00:00Z","hiddenSlugs":');

    expect(readSnapshotFile(join(dir, "broken.json"))).toBeNull();
  });
});
