import { WHATSAPP_CONFIGURED } from "@/lib/whatsapp";

/**
 * What to tell a customer when a form POST comes back refused.
 *
 * The lead forms used to treat every `!res.ok` the same ("something went
 * wrong, try again"), which is wrong in both directions: a 429 means waiting
 * will work and retrying now will not, and a 503 from the rate-limit guard
 * (see src/lib/rate-limit.ts) means our limiter is unavailable — the customer
 * did nothing wrong, and WhatsApp will reach us while the form cannot.
 *
 * Returns `null` for anything else, so each form keeps its own wording for an
 * ordinary failure; only these two cases have something specific worth saying.
 */

export type SubmitFailureKind = "limited" | "unavailable";

export interface SubmitFailure {
  kind: SubmitFailureKind;
  message: string;
  /** From `Retry-After`, when the server sent a usable one. */
  retryAfterSeconds: number | null;
}

/** `Retry-After` in seconds. Anything that is not a sane positive number of
 *  seconds (including the HTTP-date form, which we never send) is ignored
 *  rather than turned into a misleading wait. */
export function retryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // A day is far past anything worth quoting to someone filling in a form.
  return seconds > 86_400 ? null : Math.ceil(seconds);
}

/** "a minute", "3 minutes" — vague on purpose: an exact countdown would be
 *  wrong by the time it is read. */
function wait(seconds: number | null): string {
  if (seconds === null) return "a few minutes";
  if (seconds <= 90) return "a minute";
  return `${Math.round(seconds / 60)} minutes`;
}

export function describeSubmitFailure(response: {
  status: number;
  headers: { get(name: string): string | null };
}): SubmitFailure | null {
  const after = retryAfterSeconds(response.headers.get("Retry-After"));

  if (response.status === 429) {
    return {
      kind: "limited",
      retryAfterSeconds: after,
      message: `That was sent a few times already. Please try again in ${wait(after)}.`,
    };
  }

  if (response.status === 503) {
    return {
      kind: "unavailable",
      retryAfterSeconds: after,
      message: WHATSAPP_CONFIGURED
        ? "We can’t take that just now — nothing to do with your details. Please message us on WhatsApp and we’ll pick it up there."
        : "We can’t take that just now — nothing to do with your details. Please try again shortly, or reach us from the contact page.",
    };
  }

  return null;
}
