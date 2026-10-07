/**
 * `npm run test:ingest` — behavioural guarantees of the WhatsApp ingestion, on real PostgreSQL.
 *
 *  1. Arrival order inside one second must never change the grouping.
 *  2. Delivering the same messages again (back to back, or the whole stream later)
 *     must never create another product.
 *
 * Kept out of `npm test`: it needs the local disposable cluster (ingest-eval/README.md).
 * INGEST_SHUFFLES (default 100) and INGEST_ONLY narrow the run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", async () => (await import("./lib/mocks")).serverMock);
vi.mock("@/lib/ai", async () => (await import("./lib/mocks")).aiMock);
vi.mock("@/lib/report-error", async () => (await import("./lib/mocks")).reportMock);

import { createRunDb, ensureTemplate, type RunDb } from "./lib/db";
import { installFetch } from "./lib/mocks";
import { replay, shuffleSameSecond, signature, type Stream } from "./lib/replay";
import { loadStreams } from "./lib/streams";

const SHUFFLES = Number(process.env.INGEST_SHUFFLES ?? 100);
// Streams where something sent in the same second as something else can change the answer.
const DEFAULT = ["F1", "F2", "F3F4", "F4", "F5", "DF1", "DF_two", "LATE_TEXT", "TIE_DF", "TIE_PF", "PF1"];
const streams = loadStreams().filter((s) => process.env.INGEST_ONLY || DEFAULT.includes(s.name));

/** mulberry32, so a failing shuffle can be reproduced from its index. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let db: RunDb;
beforeAll(async () => {
  vi.stubGlobal("fetch", installFetch());
  // The route logs every reply it sends; errors are still captured by the reportError mock.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  db = await createRunDb(await ensureTemplate());
});
afterAll(async () => { await db?.close(); });

const run = async (stream: Stream, options: Parameters<typeof replay>[2]) => {
  await db.reset();
  return replay(db, stream, options);
};

describe("arrival order within the same second never changes the grouping", () => {
  it.each(streams.map((s) => [s.name, s] as const))("%s", async (_name, stream) => {
    const canonical = signature(await run(stream, { ai: "off" }));
    const seen = new Map<string, number[]>();
    for (let i = 0; i < SHUFFLES; i++) {
      const order = shuffleSameSecond(stream.events, seeded(i + 1));
      const sig = signature(await run(stream, { ai: "off", order }));
      seen.set(sig, [...(seen.get(sig) ?? []), i + 1]);
    }
    const differing = [...seen.entries()].filter(([sig]) => sig !== canonical);
    const message = differing.length
      ? `${seen.size} distinct groupings over ${SHUFFLES} shuffles; ${differing.reduce((n, [, runs]) => n + runs.length, 0)} differ from the unshuffled one. ` +
        `First differing shuffle #${differing[0][1][0]}:\n${differing[0][0]}\nunshuffled:\n${canonical}`
      : "";
    expect(differing.length, message).toBe(0);
  });
});

describe("replaying the same messages creates no duplicate products", () => {
  it.each(streams.map((s) => [s.name, s] as const))("%s", async (_name, stream) => {
    const once = await run(stream, { ai: "off" });
    for (const redeliver of ["adjacent", "after"] as const) {
      const again = await run(stream, { ai: "off", redeliver });
      const label = `redeliver=${redeliver}`;
      expect(again.products.length, `${label}: product count`).toBe(once.products.length);
      expect(again.rows, `${label}: inbox rows`).toBe(once.rows);
      expect(signature(again), `${label}: grouping`).toBe(signature(once));
    }
  });
});
