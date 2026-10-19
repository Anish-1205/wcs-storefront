#!/usr/bin/env node
/**
 * Lighthouse in CI (T5.4): mobile lab scores for a few key pages against the
 * budgets below, written to the GitHub job summary.
 *
 *   node scripts/lighthouse-ci.mjs [baseUrl]      (default http://localhost:3000)
 *
 * Warn-only: a page over budget is reported, and the run still passes unless
 * LIGHTHOUSE_ENFORCE=1 (the plan: two weeks of warnings, then enforce).
 * These are lab numbers on a CI runner, not what customers see: INP and real
 * user timings are field metrics. TBT stands in for responsiveness here.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

export const BUDGETS = {
  lcpMs: 3000,
  cls: 0.1,
  accessibility: 0.9,
  seo: 0.95,
};

/** One page's audit result → its row and any budget breaches. */
export function evaluate(path, lhr) {
  const score = (key) => lhr.categories?.[key]?.score ?? null;
  const metric = (key) => lhr.audits?.[key]?.numericValue ?? null;
  const row = {
    path,
    performance: score("performance"),
    accessibility: score("accessibility"),
    seo: score("seo"),
    bestPractices: score("best-practices"),
    lcpMs: metric("largest-contentful-paint"),
    cls: metric("cumulative-layout-shift"),
    tbtMs: metric("total-blocking-time"),
  };
  const breaches = [];
  if (row.lcpMs !== null && row.lcpMs > BUDGETS.lcpMs) breaches.push(`LCP ${Math.round(row.lcpMs)} ms > ${BUDGETS.lcpMs} ms`);
  if (row.cls !== null && row.cls > BUDGETS.cls) breaches.push(`CLS ${row.cls.toFixed(3)} > ${BUDGETS.cls}`);
  if (row.accessibility !== null && row.accessibility < BUDGETS.accessibility) breaches.push(`accessibility ${row.accessibility} < ${BUDGETS.accessibility}`);
  if (row.seo !== null && row.seo < BUDGETS.seo) breaches.push(`SEO ${row.seo} < ${BUDGETS.seo}`);
  return { row, breaches };
}

export function summary(results, enforce) {
  const pct = (v) => (v === null ? "—" : String(Math.round(v * 100)));
  const lines = [
    "### Lighthouse (mobile, lab)",
    "",
    `Budgets: LCP ≤ ${BUDGETS.lcpMs} ms, CLS ≤ ${BUDGETS.cls}, accessibility ≥ ${BUDGETS.accessibility * 100}, SEO ≥ ${BUDGETS.seo * 100}. ${enforce ? "**Enforced.**" : "Warn-only."}`,
    "",
    "| Page | Perf | A11y | SEO | BP | LCP ms | CLS | TBT ms | Over budget |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map(({ row, breaches }) =>
      `| \`${row.path}\` | ${pct(row.performance)} | ${pct(row.accessibility)} | ${pct(row.seo)} | ${pct(row.bestPractices)} | ${row.lcpMs === null ? "—" : Math.round(row.lcpMs)} | ${row.cls === null ? "—" : row.cls.toFixed(3)} | ${row.tbtMs === null ? "—" : Math.round(row.tbtMs)} | ${breaches.join("; ") || "—"} |`),
  ];
  return lines.join("\n");
}

async function firstProductPath(base) {
  try {
    const xml = await (await fetch(`${base}/sitemap.xml`)).text();
    const match = xml.match(/<loc>[^<]*?(\/sarees\/[^<]+)<\/loc>/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function main() {
  const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
  const enforce = process.env.LIGHTHOUSE_ENFORCE === "1";
  const { default: lighthouse } = await import("lighthouse");
  const chromeLauncher = await import("chrome-launcher");
  const product = await firstProductPath(base);
  const paths = ["/", "/catalog", ...(product ? [product] : []), "/enquiry"];

  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-sandbox"] });
  const results = [];
  try {
    for (const path of paths) {
      const run = await lighthouse(`${base}${path}`, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "seo", "best-practices"],
        formFactor: "mobile",
      });
      results.push(evaluate(path, run.lhr));
    }
  } finally {
    await chrome.kill();
  }

  const text = summary(results, enforce);
  console.log(text);
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/lighthouse-ci.json", JSON.stringify(results.map((r) => r.row), null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  const over = results.filter((r) => r.breaches.length);
  if (over.length) console.log(`${enforce ? "::error::" : "::warning::"}${over.length} page(s) over budget`);
  process.exit(enforce && over.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("lighthouse-ci.mjs")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
