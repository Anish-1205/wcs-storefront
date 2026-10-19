import type { createAdminClient } from "@/lib/supabase/server";

export interface AiUsageRow {
  day: string;
  feature: string;
  requests: number;
  rejected: number;
  input_tokens: number;
  output_tokens: number;
}

export interface AiSettingsRow {
  kill_switch: boolean;
  paused_until: string | null;
  pause_reason: string | null;
  updated_at: string;
}

export type AiUsageData =
  | { ok: true; rows: AiUsageRow[]; settings: AiSettingsRow | null; envKillSwitch: boolean }
  | { ok: false; error: string };

/** The last 30 UTC days of the AI ledger (migration 035), newest first. */
export async function loadAiUsage(admin: ReturnType<typeof createAdminClient>): Promise<AiUsageData> {
  const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [usage, settings] = await Promise.all([
    admin.from("ai_usage_daily").select("day, feature, requests, rejected, input_tokens, output_tokens")
      .gte("day", since).order("day", { ascending: false }).order("feature"),
    admin.from("ai_settings").select("kill_switch, paused_until, pause_reason, updated_at").maybeSingle(),
  ]);
  const error = usage.error ?? settings.error;
  if (error) {
    return { ok: false, error: `The AI usage ledger could not be read (${error.message}). Is migration 035 applied?` };
  }
  return {
    ok: true,
    rows: ((usage.data ?? []) as AiUsageRow[]).map((r) => ({
      ...r,
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
    })),
    settings: (settings.data as AiSettingsRow | null) ?? null,
    envKillSwitch: process.env.AI_KILL_SWITCH === "1",
  };
}
