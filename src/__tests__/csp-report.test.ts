import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const reportError = vi.fn();
vi.mock("@/lib/report-error", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

import { buildReportOnlyCsp, parseCspReports, reportSampleRate } from "@/lib/csp-report-only";

const legacy = (blocked: string, directive = "script-src-elem") => ({
  "csp-report": { "document-uri": "https://weaversclubsarees.com/sarees/x?utm=private", "effective-directive": directive, "blocked-uri": blocked },
});

let POST: (req: Request) => Promise<Response>;
beforeEach(async () => {
  reportError.mockReset();
  vi.resetModules();
  ({ POST } = await import("@/app/api/csp-report/route"));
});

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/csp-report", { method: "POST", body, headers: { "content-type": "application/csp-report", ...headers } }));

describe("CSP report-only (T3.6)", () => {
  it("the candidate has no unsafe-inline for scripts, a nonce, worker-src and a report-uri", () => {
    const policy = buildReportOnlyCsp("abc123");
    const scriptSrc = policy.split("; ").find((d) => d.startsWith("script-src "))!;
    expect(scriptSrc).toContain("'nonce-abc123'");
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("report-uri /api/csp-report");
  });

  it("parses both report formats, keeping origins and paths only", () => {
    expect(parseCspReports(legacy("https://evil.example/x.js?token=1"))).toEqual([
      { directive: "script-src-elem", blocked: "https://evil.example", page: "/sarees/x" },
    ]);
    expect(parseCspReports([{ type: "csp-violation", body: { effectiveDirective: "script-src-elem", blockedURL: "inline", documentURL: "https://x/" } }, { type: "other" }]))
      .toEqual([{ directive: "script-src-elem", blocked: "inline", page: "/" }]);
  });

  it("reports each distinct violation once per window, with a count", async () => {
    for (let i = 0; i < 5; i++) expect((await post(JSON.stringify(legacy("inline")))).status).toBe(204);
    await post(JSON.stringify(legacy("https://cdn.example/a.js")));
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError.mock.calls[0][1]).toMatchObject({ scope: "csp-report", directive: "script-src-elem", blocked: "inline", page: "/sarees/x" });
  });

  it("refuses oversized and malformed bodies", async () => {
    expect((await post("x".repeat(20_000))).status).toBe(413);
    expect((await post("{not json")).status).toBe(400);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("samples 5 % by default and rejects nonsense rates", () => {
    expect(reportSampleRate(undefined)).toBe(0.05);
    expect(reportSampleRate("0.5")).toBe(0.5);
    expect(reportSampleRate("2")).toBe(0.05);
  });

  it("the enforced policy now allows blob: workers", async () => {
    const { middleware } = await import("@/middleware");
    const res = await middleware(new NextRequest("http://localhost/"));
    expect(res.headers.get("Content-Security-Policy")).toContain("worker-src 'self' blob:");
  });
});
