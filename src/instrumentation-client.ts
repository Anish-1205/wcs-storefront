import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, DENY_URLS, replaysOnErrorSampleRate } from "@/lib/sentry-options";
// replaysSessionSampleRate was 0.1 — a continuous screen-recording integration
// running for 1 in 10 *every* visit, not just error cases. replaysOnErrorSampleRate
// (still 1.0) already captures a replay buffer around any real error, which is
// the actually-useful case, so ongoing session recording for otherwise-healthy
// visits is dropped here for perceived speed.
//
// replaysOnErrorSampleRate was 1.0; the Developer plan includes 50 replays a
// month, so it now defaults to 0.2 (NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_RATE).
Sentry.init({
  ...baseSentryOptions(),
  denyUrls: DENY_URLS,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: replaysOnErrorSampleRate(),
  integrations: [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: false })],
  debug: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
