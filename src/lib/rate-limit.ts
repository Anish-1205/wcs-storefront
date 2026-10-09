import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";

/**
 * Rate limiting, and what happens when the limiter itself is unavailable.
 *
 * Upstash is a network dependency on the hot path of every public form. It can
 * be unreachable, time out, answer 5xx, or start refusing once the free tier's
 * monthly command budget is spent — and the env vars can be missing in a
 * misconfigured deployment. None of that used to be handled: `limit()` was
 * called unguarded, so a limiter outage turned into a 500 on the enquiry form
 * and the lead was lost.
 *
 * So each caller now states what should happen when the limiter cannot be
 * consulted:
 *
 *   failure: "open"   — serve the request anyway. For the public lead forms,
 *                       where a lost enquiry is the real cost and Zod
 *                       validation plus the honeypot still apply. The worst
 *                       case is spam in the CRM for the length of an outage.
 *   failure: "closed" — refuse with 503 + Retry-After. For the admin upload
 *                       and import endpoints, where auth already keeps
 *                       strangers out and the limiter exists to bound a
 *                       runaway client that would spend real Cloudinary quota.
 *
 * "closed" is the default, so an endpoint that has not thought about it gets
 * the safe answer.
 *
 * `/api/whatsapp` deliberately has no limiter: it is gated by an HMAC
 * signature and a sender allowlist (src/lib/webhook-security.ts).
 */

export type RateLimitFailurePolicy = "open" | "closed";

export interface RateLimitResult {
  /** Whether the request may proceed. On a degraded check this is the policy. */
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter: number;
  /** True when the limiter could not be consulted and the policy decided. */
  degraded: boolean;
}

/** A limiter that has not answered by now counts as unavailable. Short on
 *  purpose: this sits in front of a form submission, and waiting is worse
 *  than deciding. */
const TIMEOUT_MS = 1000;
/** After a failure, skip the limiter entirely for this long — an outage must
 *  not pay the timeout above on every request, nor report once per request. */
const UNAVAILABLE_FOR_MS = 30_000;
/** One report per bucket per window; an outage lasts minutes or hours and
 *  Sentry's free quota is 5,000 events a month. */
const REPORT_WINDOW_MS = 30 * 60 * 1000;
/** What a refused-because-degraded response asks the client to wait. Matched
 *  to the back-off, so a client that honours it arrives when the limiter is
 *  actually retried. */
const DEGRADED_RETRY_AFTER_SECONDS = Math.ceil(UNAVAILABLE_FOR_MS / 1000);

type BucketName = "public" | "import";

/**
 * Admin-only bulk upload endpoints (import sign/complete) are already gated
 * behind admin auth, so they don't need the same tight budget as anonymous
 * public forms — a single import batch can fire hundreds of sign+complete
 * calls in a burst. That bucket only exists to bound a runaway client loop.
 */
const BUCKETS: Record<BucketName, { limit: number; window: `${number} ${"s" | "m"}`; prefix: string }> = {
  public: { limit: 5, window: "10 m", prefix: "wcs:ratelimit" },
  import: { limit: 600, window: "10 m", prefix: "wcs:ratelimit:import" },
};

let client: Redis | null | undefined;
const limiters = new Map<BucketName, Ratelimit | null>();
const unavailableUntil = new Map<BucketName, number>();
const lastReportedAt = new Map<string, number>();
const failures = new Map<BucketName, number>();
const degradedDecisions = new Map<string, number>();
let lastFailureAt: number | null = null;

/**
 * Built on first use rather than at module load, so a missing or malformed
 * `UPSTASH_REDIS_REST_URL` fails inside the guarded path instead of throwing
 * while the route module is still being imported — which no try/catch at the
 * call site could have caught.
 */
function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    client = url && token ? new Redis({ url, token }) : null;
  } catch (error) {
    // A URL the client rejects outright (anything but https).
    client = null;
    note("public", error, { stage: "connect" });
  }
  return client;
}

function limiterFor(name: BucketName): Ratelimit | null {
  const existing = limiters.get(name);
  if (existing !== undefined) return existing;
  const connection = redis();
  const config = BUCKETS[name];
  const limiter = connection
    ? new Ratelimit({
        redis: connection,
        limiter: Ratelimit.slidingWindow(config.limit, config.window),
        analytics: false,
        prefix: config.prefix,
      })
    : null;
  limiters.set(name, limiter);
  return limiter;
}

/** Reports a limiter failure at most once per bucket per window, and never
 *  throws: this is the guard's own error path. */
function note(name: BucketName, error: unknown, extra: Record<string, unknown> = {}): void {
  failures.set(name, (failures.get(name) ?? 0) + 1);
  lastFailureAt = Date.now();
  unavailableUntil.set(name, Date.now() + UNAVAILABLE_FOR_MS);
  try {
    const key = `bucket:${name}`;
    const previous = lastReportedAt.get(key);
    if (previous !== undefined && Date.now() - previous < REPORT_WINDOW_MS) return;
    lastReportedAt.set(key, Date.now());
    // No IP and no request body: nothing here identifies a customer.
    reportError(error, {
      scope: "rate-limit",
      bucket: name,
      configured: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      ...extra,
    });
  } catch {
    // Reporting must never be the reason a request fails.
  }
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`rate limiter timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The answer when the limiter could not be consulted: the policy decides,
 *  and `degraded` tells the caller which kind of refusal this is. */
function decide(name: BucketName, failure: RateLimitFailurePolicy): RateLimitResult {
  degradedDecisions.set(`${name}:${failure}`, (degradedDecisions.get(`${name}:${failure}`) ?? 0) + 1);
  return {
    success: failure === "open",
    limit: BUCKETS[name].limit,
    remaining: 0,
    reset: Date.now() + UNAVAILABLE_FOR_MS,
    retryAfter: DEGRADED_RETRY_AFTER_SECONDS,
    degraded: true,
  };
}

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

async function limitWith(
  name: BucketName,
  req: Request,
  failure: RateLimitFailurePolicy,
): Promise<RateLimitResult> {
  const waitUntil = unavailableUntil.get(name);
  if (waitUntil !== undefined && Date.now() < waitUntil) return decide(name, failure);

  const limiter = limiterFor(name);
  if (!limiter) {
    // No credentials, or a client that could not be built at all.
    note(name, new Error("rate limiter is not configured"), { stage: "configure" });
    return decide(name, failure);
  }

  try {
    const { success, limit, remaining, reset } = await withTimeout(limiter.limit(clientIp(req)));
    unavailableUntil.delete(name);
    return {
      success,
      limit,
      remaining,
      reset,
      retryAfter: Math.max(0, Math.ceil((reset - Date.now()) / 1000)),
      degraded: false,
    };
  } catch (error) {
    note(name, error, { stage: "limit" });
    return decide(name, failure);
  }
}

/** The public-form bucket: 5 requests per 10 minutes per caller. */
export async function checkRateLimit(
  req: Request,
  { failure = "closed" }: { failure?: RateLimitFailurePolicy } = {},
): Promise<RateLimitResult> {
  return limitWith("public", req, failure);
}

/** The admin import bucket: 600 requests per 10 minutes per caller. */
export async function checkImportRateLimit(
  req: Request,
  { failure = "closed" }: { failure?: RateLimitFailurePolicy } = {},
): Promise<RateLimitResult> {
  return limitWith("import", req, failure);
}

/**
 * The single place that turns a check into a response: `null` when the
 * request may proceed, otherwise the refusal.
 *
 * The two refusals are deliberately different. A caller that spent its own
 * budget gets **429** — it did something, and may do it again later. A caller
 * refused because the limiter is unavailable did nothing wrong, so it gets
 * **503**: the service is temporarily unable to handle the request, which is
 * also what tells a monitor that this is our problem rather than the client's.
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse | null {
  if (result.success) return null;
  const headers = { "Retry-After": String(result.retryAfter) };
  if (result.degraded) {
    return NextResponse.json(
      { error: "This is temporarily unavailable. Please try again shortly, or message us on WhatsApp." },
      { status: 503, headers },
    );
  }
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers },
  );
}

/** Counters for a health check to read. Nothing here is customer data. */
export function getRateLimitStatus() {
  return {
    configured: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
    failures: Object.fromEntries(failures),
    degradedDecisions: Object.fromEntries(degradedDecisions),
    lastFailureAt: lastFailureAt === null ? null : new Date(lastFailureAt).toISOString(),
    backingOff: [...unavailableUntil]
      .filter(([, until]) => Date.now() < until)
      .map(([bucket]) => bucket),
  };
}

/** Test-only: forget the memoized client, the buckets and the counters. */
export function resetRateLimitState(): void {
  client = undefined;
  limiters.clear();
  unavailableUntil.clear();
  lastReportedAt.clear();
  failures.clear();
  degradedDecisions.clear();
  lastFailureAt = null;
}
