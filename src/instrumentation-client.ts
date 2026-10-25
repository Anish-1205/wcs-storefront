import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, DENY_URLS, replaysOnErrorSampleRate } from "@/lib/sentry-options";
import { whenIdle } from "@/lib/when-idle";
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
  // Sampling happens below, before the download; a session that loads Replay is already in the sample.
  replaysOnErrorSampleRate: 1,
  debug: false,
});

// Replay is the heaviest part of the Sentry bundle and only matters once an
// error happens, so it is fetched after the page has loaded and gone idle
// instead of on every page's critical path. Errors are still captured from
// the first moment; only a replay of the first second or two is lost.
// Imported from @sentry/replay (pinned to the @sentry/nextjs version) rather
// than @sentry/nextjs, which is already in the first-load bundle and so would
// not split out.
//
// The error-replay sample (default 20%) is drawn here, so the other visitors
// never download or run Replay at all — the same overall rate as before.
if (Math.random() < replaysOnErrorSampleRate()) {
  whenIdle(() => {
    void import("@sentry/replay").then(({ replayIntegration }) => {
      Sentry.addIntegration(replayIntegration({ maskAllText: true, blockAllMedia: false }));
    });
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
