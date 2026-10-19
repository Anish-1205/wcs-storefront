import { describe, expect, it } from "vitest";
import { evaluate, summary } from "../../scripts/lighthouse-ci.mjs";

const lhr = (scores: Record<string, number>, metrics: Record<string, number>) => ({
  categories: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { score: v }])),
  audits: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, { numericValue: v }])),
});

describe("Lighthouse CI budgets (T5.4)", () => {
  it("passes a page inside every budget", () => {
    const result = evaluate("/", lhr({ performance: 0.9, accessibility: 0.97, seo: 1 }, { "largest-contentful-paint": 2400, "cumulative-layout-shift": 0.02 }));
    expect(result.breaches).toEqual([]);
  });

  it("lists each breach", () => {
    const result = evaluate("/catalog", lhr({ accessibility: 0.85, seo: 0.9 }, { "largest-contentful-paint": 4100, "cumulative-layout-shift": 0.25 }));
    expect(result.breaches).toEqual(["LCP 4100 ms > 3000 ms", "CLS 0.250 > 0.1", "accessibility 0.85 < 0.9", "SEO 0.9 < 0.95"]);
  });

  it("writes a summary table that says whether it is enforced", () => {
    const text = summary([evaluate("/", lhr({ performance: 0.91 }, {}))], false);
    expect(text).toContain("Warn-only.");
    expect(text).toContain("| `/` | 91 |");
  });
});
