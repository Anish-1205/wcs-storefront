import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { subscriberSchema } from "@/lib/validation";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { reportError } from "@/lib/report-error";


export const runtime = "nodejs";

export async function POST(req: Request) {
  // Fails open, like /api/inquiries: validation and the honeypot still
  // apply, and the write is an upsert, so a duplicate costs nothing.
  const limited = rateLimitResponse(await checkRateLimit(req, { failure: "open" }));
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = subscriberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // Honeypot: a filled "website" field means a bot. Pretend success, store nothing.
  if (data.website) {
    return NextResponse.json({ ok: true });
  }

  // Built per request (T3.11): a missing service-role key is a handled 500
  // here, not a client built at module load.
  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (error) {
    reportError(error, { scope: "subscriber-insert" });
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { error: dbError } = await supabase.from("whatsapp_subscribers").insert({
    name: data.name,
    phone: data.phone,
    source: data.source,
  });

  if (dbError) {
    reportError(dbError, { scope: "subscriber-insert" });
    return NextResponse.json({ error: "Could not save subscriber" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
