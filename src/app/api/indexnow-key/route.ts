import { NextResponse } from "next/server";
import { indexNowKey } from "@/lib/indexnow";

export const dynamic = "force-dynamic";

/**
 * The IndexNow key file (T5.8), reached as /<key>.txt through a rewrite in
 * next.config.mjs. Answers only for the configured key; anything else is 404,
 * so the route cannot be used to discover the key.
 */
export async function GET(req: Request) {
  const asked = new URL(req.url).searchParams.get("k");
  const key = indexNowKey();
  if (!key || asked !== key) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(key, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
}
