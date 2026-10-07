/**
 * `npm run eval:ingest` — replays every fixture through the current code and
 * writes reports/ingest-eval/<INGEST_LABEL|latest>.json. It never fails on a
 * rule failure: the report is the product. ingest-eval/print-report.mjs shows it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", async () => (await import("./lib/mocks")).serverMock);
vi.mock("@/lib/ai", async () => (await import("./lib/mocks")).aiMock);
vi.mock("@/lib/report-error", async () => (await import("./lib/mocks")).reportMock);

import { createRunDb, ensureTemplate, type RunDb } from "./lib/db";
import { installFetch } from "./lib/mocks";
import { replay } from "./lib/replay";
import { evaluate } from "./lib/rules";
import { loadStreams } from "./lib/streams";

let db: RunDb;
beforeAll(async () => {
  vi.stubGlobal("fetch", installFetch());
  // The route logs every reply it sends; errors are still captured by the reportError mock.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  db = await createRunDb(await ensureTemplate());
});
afterAll(async () => { await db?.close(); });

it("replays every fixture", async () => {
  const results = [];
  for (const stream of loadStreams()) {
    for (const ai of ["off", "oracle"] as const) {
      await db.reset();
      const started = Date.now();
      const snap = await replay(db, stream, { ai });
      const findings = evaluate(stream, snap, ai);
      results.push({
        stream: stream.name, ai, description: stream.description, ms: Date.now() - started,
        counts: {
          images: stream.events.filter((e) => e.type === "image").length,
          videos: stream.events.filter((e) => e.type === "video").length,
          texts: stream.events.filter((e) => e.type === "text").length,
        },
        texts: stream.events.filter((e) => e.type === "text").map((e) => ({ id: e.id, text: e.text })),
        snapshot: snap, findings, findingsOld: evaluate(stream, snap, ai, "old"),
      });
    }
  }
  const dir = join(process.cwd(), "reports", "ingest-eval");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${process.env.INGEST_LABEL ?? "latest"}.json`), JSON.stringify({ generated: new Date().toISOString(), results }, null, 1));
  expect(results.length).toBeGreaterThan(0);
});
