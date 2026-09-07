import * as Sentry from "@sentry/nextjs";
// replaysSessionSampleRate was 0.1 — a continuous screen-recording integration
// running for 1 in 10 *every* visit, not just error cases. replaysOnErrorSampleRate
// (still 1.0) already captures a replay buffer around any real error, which is
// the actually-useful case, so ongoing session recording for otherwise-healthy
// visits is dropped here for perceived speed.
Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: 0.1, replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 1.0, integrations: [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: false })], debug: false });

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
