/**
 * Structured logging (T2.6): one JSON line per event, so Vercel's log search
 * can filter by `scope`, `level` and `requestId`.
 *
 * Fields pass through `redact` first. Anything whose key names personal data
 * or a credential is replaced, and e-mail addresses, phone-like digit runs
 * and bearer tokens inside any string value are masked. Prefer passing ids
 * and counts; never pass a message body or a customer's free text.
 */

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

/** Keys whose value is never logged (matched case-insensitively, anywhere in the key). */
const SECRET_KEYS = /(pass(word)?|secret|token|authorization|cookie|api[_-]?key|dsn|signature)/i;
const PERSONAL_KEYS = /(phone|e-?mail|^name$|full_?name|contact_?name|address|message|body|text|caption|note)/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 10+ digits, optionally with +, spaces or dashes between them: phone numbers.
const PHONE = /\+?\d(?:[\s-]?\d){9,}/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

function redactString(value: string): string {
  return value
    .replace(BEARER, "Bearer [redacted]")
    .replace(EMAIL, "[email]")
    .replace(PHONE, (match) => `[phone …${match.replace(/\D/g, "").slice(-4)}]`)
    .slice(0, 500);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[nested]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { error: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_KEYS.test(key)) out[key] = "[redacted]";
    else if (PERSONAL_KEYS.test(key)) out[key] = inner == null ? inner : "[personal]";
    else out[key] = redact(inner, depth + 1);
  }
  return out;
}

/** The id middleware put on the request (or the platform's own), if any. */
export function requestIdFrom(req: { headers: Headers }): string | undefined {
  return req.headers.get("x-request-id") ?? req.headers.get("x-vercel-id") ?? undefined;
}

export function log(level: LogLevel, scope: string, message: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    level,
    scope,
    message: redactString(message),
    ...(redact(fields) as LogFields),
    at: new Date().toISOString(),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (scope: string, message: string, fields?: LogFields) => log("info", scope, message, fields),
  warn: (scope: string, message: string, fields?: LogFields) => log("warn", scope, message, fields),
  error: (scope: string, message: string, fields?: LogFields) => log("error", scope, message, fields),
};
