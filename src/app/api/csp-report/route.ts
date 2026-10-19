import { NextResponse } from "next/server";
import { parseCspReports } from "@/lib/csp-report-only";
import { reportError } from "@/lib/report-error";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Receives Content-Security-Policy-Report-Only violations (T3.6).
 *
 * Browsers send these without credentials and anyone can post here, so: the
 * body is capped, only the directive, the blocked origin and the page path are
 * kept, and each distinct (directive, blocked origin) goes to Sentry at most
 * once per 30 minutes per instance, with how many times it was seen. No
 * Upstash call: the public limiter's per-IP budget belongs to the lead forms.
 */

const MAX_BYTES = 16 * 1024;
const WINDOW_MS = 30 * 60 * 1000;
const MAX_KEYS = 200;

const seen = new Map<string, { count: number; reportedAt: number }>();

export async function POST(req: Request) {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) return new NextResponse(null, { status: 413 });
  let text: string;
  try {
    text = await req.text();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (text.length > MAX_BYTES) return new NextResponse(null, { status: 413 });

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const now = Date.now();
  for (const violation of parseCspReports(payload)) {
    const key = `${violation.directive} ${violation.blocked}`;
    const entry = seen.get(key) ?? { count: 0, reportedAt: 0 };
    entry.count += 1;
    if (now - entry.reportedAt >= WINDOW_MS) {
      // A fixed message per key, so Sentry groups them; counts go in the context.
      reportError(new Error(`CSP report-only: ${key}`), {
        scope: "csp-report",
        directive: violation.directive,
        blocked: violation.blocked,
        page: violation.page,
        countSinceLastReport: entry.count,
      });
      logger.info("csp-report", "violation", { directive: violation.directive, blocked: violation.blocked, count: entry.count });
      entry.count = 0;
      entry.reportedAt = now;
    }
    seen.set(key, entry);
    if (seen.size > MAX_KEYS) seen.delete(seen.keys().next().value!);
  }
  return new NextResponse(null, { status: 204 });
}
