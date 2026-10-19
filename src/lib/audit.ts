import { createAdminClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/report-error";

/**
 * Admin audit log (T3.1, migration 036). Call after an admin check, once the
 * action has happened. It never throws and never blocks the action: a failed
 * write is reported to Sentry and the action's own result stands.
 *
 * What may be recorded is deliberately narrow: who (the auth user id), what
 * (`entity.verb`), which row, and `meta`, which keeps only short scalar values
 * under plain keys. Pass field *names* that changed, counts, ids and enum
 * values. Never pass names, phone numbers, e-mails, prices a customer typed,
 * message text or tokens; keys that look like those are dropped here as a
 * second line of defence.
 */

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  entity?: string;
  entityId?: string | number | null;
  requestId?: string | null;
  meta?: Record<string, unknown>;
}

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const FORBIDDEN_KEY = /(pass|secret|token|key$|authorization|cookie|phone|e?mail|name$|address|message|body|text|caption|note|(^|_)ip$)/i;
const MAX_STRING = 120;
const MAX_LIST = 25;

function cleanValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, MAX_STRING);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_LIST).map(cleanValue).filter((item) => item !== undefined && typeof item !== "object");
    return items;
  }
  return undefined;
}

/** Exported for tests: the allowlist applied to `meta`. */
export function cleanAuditMeta(meta: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!KEY.test(key) || FORBIDDEN_KEY.test(key)) continue;
    const cleaned = cleanValue(value);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const { error } = await createAdminClient().from("admin_audit_log").insert({
      action: entry.action,
      actor_id: entry.actorId ?? null,
      entity: entry.entity ?? null,
      entity_id: entry.entityId == null ? null : String(entry.entityId).slice(0, 128),
      request_id: entry.requestId ?? null,
      meta: cleanAuditMeta(entry.meta),
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    reportError(error, { scope: "admin-audit", action: entry.action });
  }
}

/**
 * recordAudit for a server action that has just passed `assertAdmin()`:
 * takes the actor from that user and the request id from the request headers.
 */
export async function auditAdminAction(
  user: { id: string } | null | undefined,
  action: string,
  entry: Omit<AuditEntry, "action" | "actorId" | "requestId"> = {},
): Promise<void> {
  let requestId: string | null = null;
  try {
    const { headers } = await import("next/headers");
    requestId = (await headers()).get("x-request-id");
  } catch {
    // Outside a request (tests, scripts): no id.
  }
  await recordAudit({ ...entry, action, actorId: user?.id ?? null, requestId });
}
