import { reportError } from "@/lib/report-error";

/**
 * Tell Bing/Yandex (IndexNow) that product URLs changed (T5.8). Google ignores
 * IndexNow; the sitemap covers it.
 *
 * A no-op unless INDEXNOW_KEY is set. Only the URLs passed in are submitted,
 * each at most once per THROTTLE_MS per instance. Never throws and never
 * delays the admin action it follows: callers fire and forget.
 * The key file IndexNow checks is served at /<key>.txt (next.config.mjs
 * rewrite → /api/indexnow-key).
 */

const ENDPOINT = "https://api.indexnow.org/indexnow";
const THROTTLE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;
const lastSent = new Map<string, number>();

export function indexNowKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.INDEXNOW_KEY?.trim();
  return key && /^[A-Za-z0-9-]{8,128}$/.test(key) ? key : null;
}

export function siteBase(env: Record<string, string | undefined> = process.env): string {
  return (env.NEXT_PUBLIC_SITE_URL || "https://weaversclubsarees.com").replace(/\/$/, "");
}

export async function submitToIndexNow(paths: string[]): Promise<{ submitted: string[] }> {
  const key = indexNowKey();
  if (!key) return { submitted: [] };
  const base = siteBase();
  const now = Date.now();
  const urls = [...new Set(paths)]
    .map((path) => `${base}${path.startsWith("/") ? path : `/${path}`}`)
    .filter((url) => (lastSent.get(url) ?? -Infinity) + THROTTLE_MS <= now);
  if (urls.length === 0) return { submitted: [] };
  for (const url of urls) lastSent.set(url, now);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: new URL(base).host, key, keyLocation: `${base}/${key}.txt`, urlList: urls }),
      signal: controller.signal,
    });
    // 200 and 202 are both success for IndexNow.
    if (!response.ok) throw new Error(`IndexNow answered ${response.status}`);
    return { submitted: urls };
  } catch (error) {
    reportError(error, { scope: "indexnow", count: urls.length });
    return { submitted: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Fire and forget from an admin action. */
export function pingIndexNow(paths: string[]): void {
  void submitToIndexNow(paths).catch(() => {});
}

/** Test seam. */
export function resetIndexNow(): void {
  lastSent.clear();
}
