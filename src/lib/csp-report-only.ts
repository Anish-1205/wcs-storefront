/**
 * The candidate Content-Security-Policy, sent as Report-Only (T3.6).
 *
 * The enforced policy (middleware.ts `buildCsp`) allows 'unsafe-inline'
 * scripts. This candidate does not: scripts must carry a per-request nonce or
 * be loaded by one ('strict-dynamic'). Nothing in the app sets a nonce yet, so
 * every inline script it reports is exactly the list T3.7 needs to decide
 * whether nonces are practical. The browser only reports; nothing is blocked.
 *
 * Sampled: Next's own inline scripts make every page view report, so the
 * header goes on CSP_REPORT_SAMPLE_RATE of responses (default 0.05).
 */

export const CSP_REPORT_PATH = "/api/csp-report";

export function reportSampleRate(raw = process.env.CSP_REPORT_SAMPLE_RATE): number {
  const parsed = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.05;
}

export function buildReportOnlyCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://www.googletagmanager.com https://www.clarity.ms https://s.pinimg.com`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://res.cloudinary.com https://images.unsplash.com https://www.google-analytics.com https://*.google-analytics.com https://*.clarity.ms https://ct.pinterest.com`,
    `media-src 'self' https://res.cloudinary.com`,
    `font-src 'self'`,
    `connect-src 'self' https://*.supabase.co https://api.cloudinary.com https://www.google-analytics.com https://*.google-analytics.com https://*.clarity.ms https://*.pinterest.com`,
    `worker-src 'self' blob:`,
    `frame-ancestors 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

/** What is kept from one violation: the directive and where the blocked thing came from, never the page's query string. */
export interface CspViolation {
  directive: string;
  blocked: string;
  page: string;
}

function origin(value: unknown): string {
  if (typeof value !== "string" || !value) return "unknown";
  if (["inline", "eval", "data", "blob", "self", "wasm-eval", "trusted-types-policy"].includes(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol.startsWith("http") ? url.origin : url.protocol.replace(":", "");
  } catch {
    return value.slice(0, 40);
  }
}

function pathOnly(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  try {
    return new URL(value).pathname.slice(0, 120);
  } catch {
    return "unknown";
  }
}

/** Both report formats: legacy `{ "csp-report": {...} }` and the Reporting API's `[{ type, body }]`. */
export function parseCspReports(payload: unknown): CspViolation[] {
  const out: CspViolation[] = [];
  const add = (r: Record<string, unknown> | undefined) => {
    if (!r) return;
    const directive = String(r["effective-directive"] ?? r.effectiveDirective ?? r["violated-directive"] ?? "unknown").split(" ")[0].slice(0, 40);
    out.push({ directive, blocked: origin(r["blocked-uri"] ?? r.blockedURL), page: pathOnly(r["document-uri"] ?? r.documentURL) });
  };
  if (Array.isArray(payload)) {
    for (const entry of payload.slice(0, 20)) {
      if (entry && typeof entry === "object" && (entry as { type?: string }).type === "csp-violation") add((entry as { body?: Record<string, unknown> }).body);
    }
  } else if (payload && typeof payload === "object") {
    add((payload as Record<string, Record<string, unknown> | undefined>)["csp-report"]);
  }
  return out;
}
