import { requireAdmin } from "@/lib/admin-auth";
import { loadAiUsage, type AiUsageRow } from "@/lib/ai/usage";
import { AiKillSwitch } from "@/components/admin/AiKillSwitch";

// Live ledger state, never cached.
export const dynamic = "force-dynamic";

const FEATURE_LABELS: Record<string, string> = {
  listing: "WhatsApp listings",
  metadata: "Import / enrichment naming",
  collection: "Collection suggestions",
  color_variants: "Colour variants",
};

const number = new Intl.NumberFormat("en-IN");

function totals(rows: AiUsageRow[]) {
  const byFeature = new Map<string, AiUsageRow>();
  for (const row of rows) {
    const t = byFeature.get(row.feature) ?? { ...row, day: "", requests: 0, rejected: 0, input_tokens: 0, output_tokens: 0 };
    t.requests += row.requests;
    t.rejected += row.rejected;
    t.input_tokens += row.input_tokens;
    t.output_tokens += row.output_tokens;
    byFeature.set(row.feature, t);
  }
  return [...byFeature.values()].sort((a, b) => a.feature.localeCompare(b.feature));
}

export default async function AiUsagePage() {
  const { admin } = await requireAdmin();
  const data = await loadAiUsage(admin);

  return (
    <div>
      <h1 className="font-serif text-3xl text-primary">AI usage</h1>
      <p className="mb-6 mt-2 max-w-2xl text-sm text-muted-foreground">
        Every call to the AI provider, per feature, for the last 30 days (UTC). Counts and tokens only. The bill
        itself is on the Anthropic Console&rsquo;s Usage page. A refused call falls back to the non-AI path:
        drafts are built from the text alone and nothing is lost.
      </p>

      {!data.ok ? (
        <p className="rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {data.error}
        </p>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3 rounded-sm border border-border bg-card p-4">
            <h2 className="font-medium text-foreground">Status</h2>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                AI calls:{" "}
                <strong className="text-foreground">
                  {data.envKillSwitch || data.settings?.kill_switch ? "off" : "on"}
                </strong>
                {data.envKillSwitch && " (AI_KILL_SWITCH=1 is set in the environment; this page cannot override it)"}
              </li>
              {data.settings?.paused_until && new Date(data.settings.paused_until) > new Date() && (
                <li>
                  Paused until <strong className="text-foreground">{new Date(data.settings.paused_until).toUTCString()}</strong>
                  {data.settings.pause_reason ? `: ${data.settings.pause_reason}` : ""}. Raise the limit in the Anthropic
                  Console first, then clear the pause.
                </li>
              )}
            </ul>
            <AiKillSwitch
              on={!!data.settings?.kill_switch}
              paused={!!data.settings?.paused_until && new Date(data.settings.paused_until) > new Date()}
            />
          </section>

          <section>
            <h2 className="mb-3 font-medium text-foreground">Last 30 days</h2>
            {data.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No AI calls recorded yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 font-medium">Feature</th>
                      <th className="px-4 py-2 text-right font-medium">Calls</th>
                      <th className="px-4 py-2 text-right font-medium">Refused</th>
                      <th className="px-4 py-2 text-right font-medium">Input tokens</th>
                      <th className="px-4 py-2 text-right font-medium">Output tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals(data.rows).map((row) => (
                      <tr key={row.feature} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 text-foreground">{FEATURE_LABELS[row.feature] ?? row.feature}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{number.format(row.requests)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{number.format(row.rejected)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{number.format(row.input_tokens)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{number.format(row.output_tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {data.rows.length > 0 && (
            <section>
              <h2 className="mb-3 font-medium text-foreground">By day</h2>
              <div className="overflow-x-auto rounded-sm border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 font-medium">Day (UTC)</th>
                      <th className="px-4 py-2 font-medium">Feature</th>
                      <th className="px-4 py-2 text-right font-medium">Calls</th>
                      <th className="px-4 py-2 text-right font-medium">Refused</th>
                      <th className="px-4 py-2 text-right font-medium">Tokens in / out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={`${row.day}-${row.feature}`} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 tabular-nums">{row.day}</td>
                        <td className="px-4 py-2">{FEATURE_LABELS[row.feature] ?? row.feature}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{number.format(row.requests)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{number.format(row.rejected)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {number.format(row.input_tokens)} / {number.format(row.output_tokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
