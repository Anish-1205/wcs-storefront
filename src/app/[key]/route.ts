import { NextResponse } from "next/server";

/**
 * IndexNow key-verification file: https://<host>/<INDEXNOW_KEY>.txt must
 * respond with the key itself (plain text). This single dynamic segment
 * serves that one file — Next resolves the many static top-level routes
 * (/about, /catalog, ...) first, and only falls back here for anything else,
 * so it can't shadow real pages. Everything that isn't the exact key 404s.
 */
export function GET(
  _request: Request,
  { params }: { params: { key: string } },
) {
  const key = process.env.INDEXNOW_KEY;
  if (!key || params.key !== `${key}.txt`) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(key, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
