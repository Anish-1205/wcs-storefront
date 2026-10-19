import { sameSecret } from "@/lib/webhook-security";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/report-error";
import { getRateLimitStatus } from "@/lib/rate-limit";
import { getCatalogResilienceStatus } from "@/lib/storefront-catalog-resilience";
import { getVisibilityMirrorStatus } from "@/lib/catalog-visibility-mirror";
import { getWhatsAppQueueHealth } from "@/lib/whatsapp-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: Record<string, unknown>, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  if (status === 503) response.headers.set("Retry-After", "30");
  return response;
}

/**
 * `GET /api/health` is the public liveness probe Sentry's Uptime Monitor
 * polls: process-up only, no backing services, so it can never confuse "the
 * homepage is up" (it's file-driven) with "the database is reachable".
 *
 * `?deep=1` additionally runs one lightweight query through the admin client
 * and reports the rate-limit/catalog-resilience counters those modules already
 * keep — but only to a caller holding `HEALTH_TOKEN`, since those counters are
 * an operational signal, not something to hand to anonymous uptime pollers.
 * Never returns env values, hostnames, versions or raw error text.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("deep") !== "1") {
    return noStore({ ok: true }, 200);
  }

  const token = process.env.HEALTH_TOKEN;
  const header = req.headers.get("authorization") ?? "";
  if (!token || !header.startsWith("Bearer ") || !sameSecret(header.slice(7), token)) {
    return noStore({ error: "Unauthorized" }, 401);
  }

  let db: "ok" | "fail" = "ok";
  let whatsapp: Awaited<ReturnType<typeof getWhatsAppQueueHealth>> | null = null;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("categories").select("id").limit(1);
    if (error) db = "fail";
    // T6.8: counts only (no message ids); null when it cannot be read.
    else whatsapp = await getWhatsAppQueueHealth(admin).catch(() => null);
  } catch (error) {
    db = "fail";
    reportError(error, { scope: "health-deep" });
  }

  return noStore(
    {
      ok: db === "ok",
      db,
      rateLimit: getRateLimitStatus(),
      catalog: getCatalogResilienceStatus(),
      visibilityMirror: getVisibilityMirrorStatus(),
      whatsapp,
    },
    db === "ok" ? 200 : 503,
  );
}
