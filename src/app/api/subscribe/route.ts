import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { subscriberSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const runtime = "nodejs";

export async function POST(req: Request) {
  const rateLimit = await checkRateLimit(req);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = subscriberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const data = parsed.data;

  if (!serviceRoleKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { error: dbError } = await supabase.from("whatsapp_subscribers").insert({
    name: data.name,
    phone: data.phone,
    source: data.source,
  });

  if (dbError) {
    console.error("subscriber insert failed:", dbError.message);
    return NextResponse.json({ error: "Could not save subscriber" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
