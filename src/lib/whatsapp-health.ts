import { createHash } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/report-error";

/**
 * WhatsApp ingestion tracing and alerting (T6.8).
 *
 * A WhatsApp message id (`wamid.…`) is base64 that contains the sender's phone
 * number, so it never goes to Sentry or a log as is: `messageRef` is a short
 * hash that still lets one event be matched to one inbox row
 * (`select * from whatsapp_inbox where left(encode(sha256(message_id::bytea),'hex'),12) = '<ref>'`).
 */
export function messageRef(messageId: string | null | undefined): string | null {
  return messageId ? createHash("sha256").update(messageId).digest("hex").slice(0, 12) : null;
}

export interface WhatsAppQueueHealth {
  deadLast24h: number;
  oldestUnsettledSec: number | null;
}

export const STUCK_AFTER_SEC = 15 * 60;
const REPORT_WINDOW_MS = 30 * 60 * 1000;
const lastReported = new Map<string, number>();

/** Two small reads: dead letters in the last day, and the oldest message still in flight. */
export async function getWhatsAppQueueHealth(admin: ReturnType<typeof createAdminClient>): Promise<WhatsAppQueueHealth> {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [dead, oldest] = await Promise.all([
    admin.from("whatsapp_inbox").select("message_id", { count: "exact", head: true }).eq("state", "dead").gte("completed_at", since),
    admin.from("whatsapp_inbox").select("created_at").in("state", ["pending", "processing", "failed"]).order("created_at").limit(1),
  ]);
  if (dead.error) throw new Error(dead.error.message);
  if (oldest.error) throw new Error(oldest.error.message);
  const first = (oldest.data ?? [])[0] as { created_at: string } | undefined;
  return {
    deadLast24h: dead.count ?? 0,
    oldestUnsettledSec: first ? Math.max(0, Math.round((Date.now() - Date.parse(first.created_at)) / 1000)) : null,
  };
}

function reportOnce(key: string, message: string, context: Record<string, unknown>): boolean {
  const now = Date.now();
  if ((lastReported.get(key) ?? -Infinity) + REPORT_WINDOW_MS > now) return false;
  lastReported.set(key, now);
  // A fixed message per condition, so Sentry groups it into one issue.
  reportError(new Error(message), { scope: "whatsapp-queue", ...context });
  return true;
}

/** Alert (throttled) on dead letters or a stuck message. Returns what was raised. */
export function alertOnQueue(health: WhatsAppQueueHealth): string[] {
  const raised: string[] = [];
  if (health.deadLast24h > 0 && reportOnce("dead", "WhatsApp messages dead-lettered in the last 24 h", { count: health.deadLast24h })) raised.push("dead");
  if (health.oldestUnsettledSec !== null && health.oldestUnsettledSec > STUCK_AFTER_SEC
    && reportOnce("stuck", "A WhatsApp message has been unsettled for over 15 minutes", { oldestUnsettledSec: health.oldestUnsettledSec })) raised.push("stuck");
  return raised;
}

/** Test seam. */
export function resetWhatsAppHealth(): void {
  lastReported.clear();
}
