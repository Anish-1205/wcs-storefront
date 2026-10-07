/**
 * Prints reports/ingest-eval/<label>.json (written by eval.test.ts).
 *   node ingest-eval/print-report.mjs [label] [--summary]
 * Per stream and AI mode: input, grouping, extracted fields, name, description, rule results.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const summaryOnly = args.includes("--summary");
const label = args.find((a) => !a.startsWith("--")) ?? process.env.INGEST_LABEL ?? "latest";
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const report = JSON.parse(readFileSync(join("reports", "ingest-eval", `${label}.json`), "utf8"));
const generated = report.generated;
const results = report.results.filter((r) => !only.length || only.includes(r.stream));

const clip = (value, n = 150) => { const s = String(value ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const label2 = (p) => (p.unassigned ? "UNASSIGNED" : p.descriptionEvent ?? "?");

if (!summaryOnly) {
  for (const r of results) {
    const failed = r.findings.filter((f) => !f.pass);
    console.log(`\n━━ ${r.stream} [ai=${r.ai}] ${r.findings.length - failed.length}/${r.findings.length} pass ${"━".repeat(20)}`);
    if (r.ai === "off") console.log(`   ${r.description}`);
    console.log(`   input     ${r.counts.images} images, ${r.counts.videos} videos, ${r.counts.texts} text(s): ${r.texts.map((t) => `"${clip(t.text, 60)}"`).join(" | ") || "—"}`);
    const s = r.snapshot;
    console.log(`   grouping  ${s.products.length} product(s)${s.questions.length ? `, ${s.questions.length} question(s) asked` : ""}${s.dead.length ? `, ${s.dead.length} dead-lettered` : ""}`);
    for (const p of s.products) {
      const imgs = p.variants.reduce((n, v) => n + v.images.filter((i) => i.kind === "image").length, 0);
      const vids = p.variants.reduce((n, v) => n + v.images.filter((i) => i.kind === "video").length, 0);
      console.log(`     • ${label2(p)}: ${imgs} img + ${vids} vid, variants [${p.variants.map((v) => `${v.color}×${v.images.length}`).join(", ")}]`);
      console.log(`       price ${p.priceMin ?? "—"} | fabric ${p.fabric ?? "—"} | category ${p.categoryId ? "set" : "—"} | highlights ${p.highlights.length}`);
      console.log(`       name         "${p.name}"`);
      console.log(`       description  "${clip(p.description)}"`);
    }
    for (const q of s.questions) console.log(`     ? ${clip(q, 110)}`);
    for (const f of r.findings) if (!f.pass) console.log(`   ✗ ${f.rule}: ${f.detail}`);
  }
}

console.log(`\n══ Summary (${generated}) ══`);
const rules = new Map();
for (const r of results) for (const f of r.findings) {
  const rule = f.rule.replace(/^\[[A-Z]\]\s*/, "");
  const row = rules.get(rule) ?? { pass: 0, fail: 0, bad: [] };
  if (f.pass) row.pass++; else { row.fail++; row.bad.push(`${r.stream}${r.ai === "oracle" ? "*" : ""}`); }
  rules.set(rule, row);
}
console.log("rule".padEnd(26), "pass fail  failing streams (* = AI oracle run)");
for (const [rule, row] of [...rules].sort((a, b) => b[1].fail - a[1].fail)) {
  console.log(rule.padEnd(26), String(row.pass).padStart(4), String(row.fail).padStart(4), " ", [...new Set(row.bad)].slice(0, 9).join(" ") + (new Set(row.bad).size > 9 ? ` …+${new Set(row.bad).size - 9}` : ""));
}
const clean = results.filter((r) => r.findings.every((f) => f.pass)).length;
const tally = (key) => {
  const all = results.flatMap((r) => r[key] ?? []);
  if (!all.length) return "not recorded in this report";
  return `${all.filter((f) => f.pass).length}/${all.length} checks, ${results.filter((r) => (r[key] ?? []).every((f) => f.pass)).length}/${results.length} stream runs clean`;
};
console.log(`\n${clean}/${results.length} stream runs pass every rule.`);
console.log(`new rubric: ${tally("findings")}`);
console.log(`old rubric: ${tally("findingsOld")}`);
