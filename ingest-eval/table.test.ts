/**
 * Before/after table between two saved reports, re-scored with today's rules under BOTH rubrics, so a
 * change in the rubric is never mistaken for a change in the pipeline.
 *
 *   INGEST_FROM=baseline INGEST_TO=latest npx vitest run --config vitest.ingest.config.ts ingest-eval/table.test.ts
 *
 * Writes reports/ingest-eval/table-<from>-<to>.txt. Needs no database.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { evaluate, type Finding, type Rubric } from "./lib/rules";
import type { Snapshot } from "./lib/replay";
import { loadStreams } from "./lib/streams";

const COLUMNS: Record<string, string[]> = {
  price: ["price"],
  grouping: ["listing_created", "members_complete", "no_mixing", "no_lost_media", "no_stray_unassigned", "unassigned_set_aside", "no_unexpected_listing", "no_question_asked", "no_dead_letter", "draft_only"],
  name: ["name"],
  description: ["description"],
  cover: ["cover", "collage_placed"],
  "dedupe+cap": ["no_duplicates_visible", "within_image_cap"],
};
type Saved = { stream: string; ai: "off" | "oracle"; snapshot: Snapshot };
const dir = join(process.cwd(), "reports", "ingest-eval");
const load = (label: string): Saved[] => JSON.parse(readFileSync(join(dir, `${label}.json`), "utf8")).results;
const bare = (rule: string) => rule.replace(/^\[[A-Z]\]\s*/, "");

it("writes the before/after table", () => {
  const from = process.env.INGEST_FROM ?? "baseline", to = process.env.INGEST_TO ?? "latest";
  if (!existsSync(join(dir, `${from}.json`)) || !existsSync(join(dir, `${to}.json`))) return;
  const streams = new Map(loadStreams().map((s) => [s.name, s]));
  const score = (run: Saved | undefined, rubric: Rubric): Finding[] | null => {
    const stream = run && streams.get(run.stream);
    if (!run || !stream) return null;
    // Reports saved before a field existed simply do not have it.
    const snapshot = { ...run.snapshot, aiCalls: run.snapshot.aiCalls ?? 0, products: run.snapshot.products.map((p) => ({ ...p, hidden: p.hidden ?? [], reviewReasons: p.reviewReasons ?? [] })) };
    return evaluate(stream, snapshot, run.ai, rubric);
  };
  const cell = (findings: Finding[] | null, rules: string[]) => {
    if (!findings) return "n/a";
    const mine = findings.filter((f) => rules.includes(bare(f.rule)));
    return !mine.length ? "-" : mine.every((f) => f.pass) ? "ok" : "FAIL";
  };
  const before = load(from), after = load(to);
  const lines: string[] = [];
  const header = ["stream", "ai", ...Object.keys(COLUMNS)];
  lines.push(`Per stream, new rubric, ${from} -> ${to} (ok = every check in the column passes, - = not applicable, n/a = stream did not exist)`);
  lines.push(header.map((h, i) => h.padEnd(i === 0 ? 13 : i === 1 ? 7 : 14)).join(""));
  for (const run of after) {
    const old = before.find((r) => r.stream === run.stream && r.ai === run.ai);
    const a = score(old, "new"), b = score(run, "new");
    const cells = Object.values(COLUMNS).map((rules) => { const x = cell(a, rules), y = cell(b, rules); return (x === y ? x : `${x}>${y}`).padEnd(14); });
    lines.push(`${run.stream.padEnd(13)}${run.ai.padEnd(7)}${cells.join("")}`);
  }
  const totals = (runs: Saved[], rubric: Rubric) => {
    const all = runs.map((r) => score(r, rubric)).filter((f): f is Finding[] => !!f);
    const flat = all.flat();
    return `${flat.filter((f) => f.pass).length}/${flat.length} checks, ${all.filter((f) => f.every((x) => x.pass)).length}/${all.length} stream runs clean`;
  };
  lines.push("", "Pass counts, both rubrics (each report re-scored with today's rules):");
  for (const [label, runs] of [[from, before], [to, after]] as const) {
    lines.push(`  ${label.padEnd(10)} old rubric: ${totals(runs, "old")}`);
    lines.push(`  ${"".padEnd(10)} new rubric: ${totals(runs, "new")}`);
  }
  const columnTotals = (runs: Saved[]) => Object.entries(COLUMNS).map(([name, rules]) => {
    const cells = runs.map((r) => cell(score(r, "new"), rules)).filter((c) => c === "ok" || c === "FAIL");
    return `${name} ${cells.filter((c) => c === "ok").length}/${cells.length}`;
  }).join(", ");
  lines.push("", `Stream runs passing each column (new rubric): ${from}: ${columnTotals(before)}`, `${"".padEnd(47)}${to}: ${columnTotals(after)}`);
  writeFileSync(join(dir, `table-${from}-${to}.txt`), `${lines.join("\n")}\n`);
  expect(lines.length).toBeGreaterThan(5);
});
