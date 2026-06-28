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

export async function checkRateLimit(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwardedFor.split(",")[0]?.trim() || "unknown";

  const { success, limit, remaining, reset } = await rateLimiter.limit(ip);

  return {
    success,
    limit,
    remaining,
    reset,
    retryAfter: Math.max(0, Math.ceil((reset - Date.now()) / 1000)),
  };
}
