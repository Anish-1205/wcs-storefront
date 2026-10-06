import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/report-error";
import { sweepSenders } from "@/lib/whatsapp-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const SWEEP_MS = 110_000;

/** Constant-time comparison that does not leak the secret's length. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Scheduler entry point for the WhatsApp inbox: applies quiet periods and
 * timeouts and drains parked or abandoned work for every sender. Vercel Cron
 * calls it with "Authorization: Bearer $CRON_SECRET"; any other per-minute
 * caller (see docs/deployment.md) uses the same header. Fails closed when the
 * secret is not configured.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ") || !sameSecret(header.slice(7), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const senders = await sweepSenders(createAdminClient(), Date.now() + SWEEP_MS);
    return NextResponse.json({ ok: true, senders });
  } catch (error) {
    reportError(error, { scope: "whatsapp-sweep" });
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
