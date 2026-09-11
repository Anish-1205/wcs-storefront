import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const rateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "10 m"),
  analytics: false,
  prefix: "wcs:ratelimit",
});

// Admin-only bulk upload endpoints (import sign/complete) are already gated
// behind admin auth, so they don't need the same tight budget as anonymous
// public forms — a single import batch can fire hundreds of sign+complete
// calls in a burst. This bucket only exists to bound a runaway client loop.
export const importRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(600, "10 m"),
  analytics: false,
  prefix: "wcs:ratelimit:import",
});

/**
 * The client IP to key the limiter on.
 *
 * `x-forwarded-for` is attacker-controlled unless the edge overwrites it: a
 * client can send its own header and, on any platform that appends rather
 * than replaces, land in a fresh bucket on every request — which would make
 * the limits below decorative. So prefer the headers the platform sets
 * itself and strips from inbound requests (`x-vercel-forwarded-for` on
 * Vercel, `x-real-ip` on most reverse proxies), and only fall back to the
 * leftmost `x-forwarded-for` entry when neither is present.
 *
 * When nothing identifies the caller, every such request shares the
 * "unknown" bucket. That is deliberate: it fails closed (one shared budget)
 * rather than open (unlimited).
 */
function clientIp(req: Request): string {
  const platformIp =
    req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-real-ip");
  if (platformIp?.trim()) return platformIp.split(",")[0]!.trim();

  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  return forwardedFor.split(",")[0]?.trim() || "unknown";
}

async function limitWith(limiter: Ratelimit, req: Request) {
  const ip = clientIp(req);

  const { success, limit, remaining, reset } = await limiter.limit(ip);

  return {
    success,
    limit,
    remaining,
    reset,
    retryAfter: Math.max(0, Math.ceil((reset - Date.now()) / 1000)),
  };
}

export async function checkRateLimit(req: Request) {
  return limitWith(rateLimiter, req);
}

export async function checkImportRateLimit(req: Request) {
  return limitWith(importRateLimiter, req);
}
