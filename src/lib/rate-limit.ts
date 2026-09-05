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

async function limitWith(limiter: Ratelimit, req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwardedFor.split(",")[0]?.trim() || "unknown";

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
