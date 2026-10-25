import { NextResponse } from "next/server";
import { indexNowKey } from "@/lib/indexnow";

export const dynamic = "force-dynamic";

/**
 * The IndexNow key file (T5.8), reached as /<key>.txt through a rewrite in
 * next.config.mjs. Answers only for the configured key; anything else is 404,
 * so the route cannot be used to discover the key.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  // Behind the rewrite, req.url can still be the original /<key>.txt, without ?k=.
  const asked = url.searchParams.get("k") ?? url.pathname.match(/^\/([A-Za-z0-9-]{8,128})\.txt$/)?.[1] ?? null;
  const key = indexNowKey();
  if (!key || asked !== key) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(key, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
}
