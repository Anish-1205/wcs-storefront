import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Options shared by the server, edge and browser Sentry configs (T2.4).
 *
 * Quota (Developer plan): 5k errors, 50 replays, 5M spans a month, and events
 * past it are dropped. So: every event says which environment it came from,
 * preview deployments send nothing unless SENTRY_PREVIEW_EVENTS=1, known
 * browser noise is ignored, and replays are sampled on errors only.
 */

/** Vercel's environment (production / preview / development), else NODE_ENV. */
export function sentryEnvironment(): string {
  return process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
}

/** Errors that say nothing about this app: browser quirks, extensions, aborted navigations. */
export const IGNORE_ERRORS: Array<string | RegExp> = [
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/,
  /^Non-Error promise rejection captured/,
  /^AbortError\b/,
  /The (user|operation) aborted a request/,
  // Safari's wording for a fetch cancelled by navigating away.
  /^TypeError: Load failed$/,
];

/** Stack frames from browser extensions are not ours. */
export const DENY_URLS: RegExp[] = [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-(web-)?extension:\/\//];

export function previewEventsEnabled(): boolean {
  return (process.env.NEXT_PUBLIC_SENTRY_PREVIEW_EVENTS || process.env.SENTRY_PREVIEW_EVENTS) === "1";
}

export function beforeSend(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  if (sentryEnvironment() === "preview" && !previewEventsEnabled()) return null;
  return event;
}

function rate(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export function tracesSampleRate(): number {
  if (process.env.NODE_ENV !== "production") return 1;
  return rate(process.env.SENTRY_TRACES_SAMPLE_RATE ?? process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 0.1);
}

/** 50 replays a month is the binding quota, so not every errored session gets one. */
export function replaysOnErrorSampleRate(): number {
  return rate(process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_RATE, 0.2);
}

export function baseSentryOptions() {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: sentryEnvironment(),
    tracesSampleRate: tracesSampleRate(),
    ignoreErrors: IGNORE_ERRORS,
    beforeSend,
  };
}
