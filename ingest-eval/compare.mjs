/**
 * Rule-level diff between two saved reports: what got fixed, what regressed.
 *   node ingest-eval/compare.mjs baseline step1
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [from, to] = process.argv.slice(2);
const load = (l) => JSON.parse(readFileSync(join("reports", "ingest-eval", `${l}.json`), "utf8")).results;
const key = (r, f) => `${r.stream}|${r.ai}|${f.rule}`;
const before = new Map(load(from).flatMap((r) => r.findings.map((f) => [key(r, f), f.pass])));
const fixed = [], broken = [];
let total = 0;
for (const r of load(to)) for (const f of r.findings) {
  total++;
  const was = before.get(key(r, f));
  if (was === undefined) continue;
  if (!was && f.pass) fixed.push(`${r.stream}${r.ai === "oracle" ? "*" : ""} ${f.rule}`);
  if (was && !f.pass) broken.push(`${r.stream}${r.ai === "oracle" ? "*" : ""} ${f.rule}: ${f.detail}`);
}
const byRule = (list) => [...list.reduce((m, s) => m.set(s.split(" ")[1].replace(":", ""), (m.get(s.split(" ")[1].replace(":", "")) ?? 0) + 1), new Map())].map(([k, n]) => `${k}×${n}`).join(", ");
console.log(`${from} → ${to}: ${fixed.length} checks fixed (${byRule(fixed) || "none"}), ${broken.length} regressed`);
for (const b of broken) console.log(`  REGRESSION ${b}`);
