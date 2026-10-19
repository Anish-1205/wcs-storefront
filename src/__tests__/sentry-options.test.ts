import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import {
  baseSentryOptions,
  beforeSend,
  DENY_URLS,
  IGNORE_ERRORS,
  replaysOnErrorSampleRate,
  sentryEnvironment,
  tracesSampleRate,
} from "@/lib/sentry-options";

const event = { message: "boom" } as ErrorEvent;
const ignored = (message: string) =>
  IGNORE_ERRORS.some((pattern) => (typeof pattern === "string" ? message.includes(pattern) : pattern.test(message)));

afterEach(() => vi.unstubAllEnvs());

describe("Sentry options (T2.4)", () => {
  it("tags events with Vercel's environment", () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    expect(sentryEnvironment()).toBe("production");
    expect(baseSentryOptions().environment).toBe("production");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(sentryEnvironment()).toBe("preview");
  });

  it("drops preview events unless SENTRY_PREVIEW_EVENTS=1, keeps production", () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    expect(beforeSend(event)).toBeNull();
    vi.stubEnv("SENTRY_PREVIEW_EVENTS", "1");
    expect(beforeSend(event)).toBe(event);
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    vi.stubEnv("SENTRY_PREVIEW_EVENTS", "");
    expect(beforeSend(event)).toBe(event);
  });

  it("ignores known browser noise but not real errors", () => {
    expect(ignored("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(ignored("Non-Error promise rejection captured with value: undefined")).toBe(true);
    expect(ignored("AbortError: The user aborted a request.")).toBe(true);
    expect(ignored("TypeError: Load failed")).toBe(true);
    expect(ignored("TypeError: Cannot read properties of undefined (reading 'slug')")).toBe(false);
    expect(ignored("Failed to insert inquiry")).toBe(false);
    expect(DENY_URLS.some((r) => r.test("chrome-extension://abc/content.js"))).toBe(true);
  });

  it("samples replays on errors at 0.2 by default and rejects nonsense rates", () => {
    expect(replaysOnErrorSampleRate()).toBe(0.2);
    vi.stubEnv("NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_RATE", "0.5");
    expect(replaysOnErrorSampleRate()).toBe(0.5);
    vi.stubEnv("NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_RATE", "7");
    expect(replaysOnErrorSampleRate()).toBe(0.2);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", "abc");
    expect(tracesSampleRate()).toBe(0.1);
  });
});
