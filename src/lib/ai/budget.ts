import { createAdminClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/report-error";

/**
 * The only module that sends a request to Anthropic (T2.1/T2.2). Every call:
 *
 *  1. is refused when `AI_KILL_SWITCH=1`;
 *  2. reserves against the feature's daily cap in Postgres (`ai_try_reserve`,
 *     migration 035), which also refuses while the DB kill switch is on or a
 *     provider spend limit has paused AI. If the reserve cannot be made at all
 *     (DB down, migration missing) the call is refused: fail closed, because
 *     every caller has a deterministic fallback and an unmetered call does not;
 *  3. waits for one of AI_MAX_CONCURRENCY slots (per instance);
 *  4. is sent once. Nothing here retries a paid call, on any error;
 *  5. on a provider spend-limit response, pauses AI until the next UTC month;
 *  6. records the tokens the response reports.
 *
 * A refusal returns null, the same as any other AI failure, so callers degrade
 * exactly as they already do when AI is unavailable. Logs carry the feature
 * name and reason only, never prompt text.
 */

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export type AiFeature = "metadata" | "collection" | "color_variants" | "listing";

/** Conservative daily defaults; override with AI_DAILY_CAP_<FEATURE>. */
export const DEFAULT_DAILY_CAPS: Record<AiFeature, number> = {
  metadata: 200,
  collection: 200,
  color_variants: 200,
  listing: 200,
};

export type AiDenial = "kill_switch" | "paused" | "cap" | "ledger_unavailable" | "not_configured";

export function dailyCap(feature: AiFeature): number {
  const raw = process.env[`AI_DAILY_CAP_${feature.toUpperCase()}`];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_DAILY_CAPS[feature];
}

function maxConcurrency(): number {
  const parsed = Number(process.env.AI_MAX_CONCURRENCY);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
}

// ── Per-instance concurrency limit ───────────────────────────────────────

let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < maxConcurrency()) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

// ── Reporting, throttled per reason ──────────────────────────────────────

const REPORT_WINDOW_MS = 30 * 60 * 1000;
const lastReport = new Map<string, number>();

function reportOnce(key: string, error: unknown, context: Record<string, unknown>): void {
  const now = Date.now();
  if ((lastReport.get(key) ?? -Infinity) + REPORT_WINDOW_MS > now) return;
  lastReport.set(key, now);
  reportError(error, { scope: "ai-budget", ...context });
}

// ── Spend limits ─────────────────────────────────────────────────────────

/**
 * The two documented spend-limit answers: the organisation's own limit
 * (400 invalid_request_error, "...reached your specified API usage limits")
 * and the tier cap (429 with error.details.error_code
 * "enforced_spend_limit_reached"). Both last until the next month, so neither
 * may be retried.
 */
export function isSpendLimit(status: number, body: unknown): boolean {
  const error = (body as { error?: { type?: string; message?: string; details?: { error_code?: string } } } | null)?.error;
  if (!error) return false;
  if (status === 429 && error.details?.error_code === "enforced_spend_limit_reached") return true;
  return status === 400 && error.type === "invalid_request_error" && /usage limits?/i.test(error.message ?? "");
}

export function startOfNextUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// ── The gate ─────────────────────────────────────────────────────────────

async function reserve(feature: AiFeature): Promise<"ok" | AiDenial> {
  if (process.env.AI_KILL_SWITCH === "1") return "kill_switch";
  try {
    const { data, error } = await createAdminClient().rpc("ai_try_reserve", {
      p_feature: feature,
      p_cap: dailyCap(feature),
    });
    if (error) throw new Error(error.message);
    if (data === "ok" || data === "kill_switch" || data === "paused" || data === "cap") return data;
    throw new Error(`unexpected reserve answer: ${String(data)}`);
  } catch (error) {
    reportOnce("ledger", error, { feature, reason: "ledger_unavailable" });
    return "ledger_unavailable";
  }
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: unknown[];
}

export interface GatedResult {
  /** The parsed response body when the call was made and answered 2xx. */
  body: unknown | null;
  /** Why no call was made, when it was refused before sending. */
  denied?: AiDenial;
}

/**
 * Sends one request to Anthropic if the budget allows it. Never throws and
 * never retries; `body` is null on refusal, timeout, non-2xx or a bad body.
 */
export async function sendAnthropicRequest(
  feature: AiFeature,
  request: AnthropicRequest,
  options: { timeoutMs: number },
): Promise<GatedResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { body: null, denied: "not_configured" };

  const decision = await reserve(feature);
  if (decision !== "ok") {
    console.warn(`ai budget: ${feature} call refused (${decision})`);
    return { body: null, denied: decision };
  }

  await acquire();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      console.warn(`anthropic provider: request failed (${response.status})`);
      if (isSpendLimit(response.status, body)) await pause(feature, response.status);
      return { body: null };
    }
    await recordUsage(feature, body);
    return { body };
  } catch (error) {
    console.warn("anthropic provider: request errored", error instanceof Error ? error.message : error);
    return { body: null };
  } finally {
    clearTimeout(timeout);
    release();
  }
}

async function pause(feature: AiFeature, status: number): Promise<void> {
  const until = startOfNextUtcMonth();
  const reason = status === 429 ? "provider tier spend cap reached" : "organisation spend limit reached";
  reportOnce("spend-limit", new Error(`AI paused until ${until.toISOString()}: ${reason}`), { feature, status });
  try {
    const { error } = await createAdminClient().rpc("ai_pause", { p_until: until.toISOString(), p_reason: reason });
    if (error) throw new Error(error.message);
  } catch (error) {
    reportOnce("pause", error, { feature });
  }
}

async function recordUsage(feature: AiFeature, body: unknown): Promise<void> {
  const usage = (body as { usage?: { input_tokens?: number; output_tokens?: number } } | null)?.usage;
  if (!usage) return;
  try {
    const { error } = await createAdminClient().rpc("ai_record_usage", {
      p_feature: feature,
      p_input: usage.input_tokens ?? 0,
      p_output: usage.output_tokens ?? 0,
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    reportOnce("usage", error, { feature });
  }
}

/** Test seam: forget throttles and the concurrency state. */
export function resetAiBudgetForTests(): void {
  lastReport.clear();
  active = 0;
  waiting.length = 0;
}
