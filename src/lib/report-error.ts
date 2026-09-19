import * as Sentry from "@sentry/nextjs";

/**
 * Sentry's `onRequestError` hook (src/instrumentation.ts) only fires for errors
 * that escape a request uncaught. Every API route and Server Action here
 * deliberately catches instead — returning `{ ok: false, error }` or a JSON 500
 * so the caller gets a usable message — which meant that until this helper
 * existed, the failures worth paging on (a rejected insert, a dead Resend key,
 * a Cloudinary timeout) were only ever a console line in the Vercel log.
 *
 * `console.error` is kept alongside the capture so local development, where
 * Sentry's DSN is usually unset, still shows the failure inline.
 */

/**
 * A failure the caller is expected to hit and correct — a broken business rule
 * ("Move or reassign products before deleting this category"), not a bug. These
 * are the normal outcome of an admin workflow, so they're returned to the UI
 * but never reported: they'd bury real defects in noise.
 *
 * Note that a Zod parse failure is deliberately NOT in this category. The admin
 * forms validate client-side first, so a schema violation arriving at the
 * server means either a genuine bug or a bypassed form — both worth seeing.
 */
export class ExpectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpectedError";
  }
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (error instanceof ExpectedError) return;

  console.error(context?.scope ? `[${String(context.scope)}]` : "[error]", error);
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
