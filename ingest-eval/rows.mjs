/**
 * Before/after rows (price, name, description) for the listings two saved reports produced.
 *   node ingest-eval/rows.mjs baseline step2 [--streams=F2,F4] [--ai=off]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const [from, to] = args.filter((a) => !a.startsWith("--"));
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `=${fallback}`).split("=")[1];
const ai = opt("ai", "off");
const only = opt("streams", "").split(",").filter(Boolean);
const load = (l) => JSON.parse(readFileSync(join("reports", "ingest-eval", `${l}.json`), "utf8")).results.filter((r) => r.ai === ai && (!only.length || only.includes(r.stream)));
const b = load(from), a = load(to);
const fmt = (v) => (v === null || v === undefined ? "—" : String(v));
const clip = (s, n) => { const t = fmt(s).replace(/\s+/g, " "); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

for (const after of a) {
  const before = b.find((r) => r.stream === after.stream);
  const text = after.texts.map((t) => t.text.replace(/\n/g, "⏎")).join("  ||  ");
  console.log(`\n${after.stream}  «${clip(text, 110)}»`);
  const pa = after.snapshot.products.filter((p) => !p.unassigned), pb = before.snapshot.products.filter((p) => !p.unassigned);
  if (!pa.length) { console.log(`   (no listing created in ${to}${after.snapshot.questions.length ? "; question asked" : ""})`); continue; }
  pa.forEach((p, i) => {
    const q = pb.find((x) => x.descriptionEvent === p.descriptionEvent);
    const dead = before.snapshot.dead.length && !q;
    console.log(`   price        ${dead ? "DEAD-LETTERED" : fmt(q?.priceMin)}  →  ${fmt(p.priceMin)}`);
    console.log(`   name         ${dead ? "—" : fmt(q?.name)}  →  ${p.name}`);
    console.log(`   description  ${dead ? "—" : clip(q?.description, 80)}  →  ${clip(p.description, 90)}`);
  });
}
