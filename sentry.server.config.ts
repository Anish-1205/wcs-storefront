// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions } from "./src/lib/sentry-options";

Sentry.init({
  // DSN, environment, sampling, ignore list and the preview filter (T2.4).
  ...baseSentryOptions(),

  // Enable logs to be sent to Sentry
  enableLogs: process.env.NODE_ENV !== "production" && process.env.SENTRY_ENABLE_LOGS === "true",

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: process.env.SENTRY_SEND_DEFAULT_PII === "true",
});
