import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { INQUIRY_STATUSES } from "@/lib/validation";

export const dynamic = "force-dynamic";

interface ReportRow {
  week: string;
  source: string;
  status: string;
  enquiries: number;
}

const WEEKS = 12;

/** Where enquiries come from and how they end up (T4.6): counts only, from inquiry_source_report (migration 039). */
export default async function InquirySourceReportPage() {
  const { admin } = await requireAdmin();
  const { data, error } = await admin.rpc("inquiry_source_report", { p_weeks: WEEKS });
  const rows = ((data ?? []) as ReportRow[]).map((r) => ({ ...r, enquiries: Number(r.enquiries) }));

  const sources = [...new Set(rows.map((r) => r.source))].sort();
  const weeks = [...new Set(rows.map((r) => r.week))].sort().reverse();
  const total = (filter: (r: ReportRow) => boolean) => rows.filter(filter).reduce((sum, r) => sum + r.enquiries, 0);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-serif text-3xl text-primary">Lead sources</h1>
        <Link href="/admin/inquiries" className="text-sm text-primary hover:underline">← Inquiries</Link>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Enquiries in the last {WEEKS} weeks by where the visitor first came from (the <code>ref</code> /{" "}
        <code>utm_source</code> link they arrived on, else &ldquo;direct&rdquo;), and what became of them.
      </p>

      {error ? (
        <p className="rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          The report is not available yet ({error.message}). It needs database migrations 037 and 039.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No enquiries in this period.</p>
      ) : (
        <div className="space-y-8">
          <div className="overflow-x-auto rounded-sm border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Source</th>
                  {INQUIRY_STATUSES.map((s) => <th key={s} className="px-4 py-3 text-right">{s}</th>)}
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Won</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => {
                  const all = total((r) => r.source === source);
                  const won = total((r) => r.source === source && r.status === "won");
                  return (
                    <tr key={source} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2 font-medium">{source}</td>
                      {INQUIRY_STATUSES.map((s) => (
                        <td key={s} className="px-4 py-2 text-right tabular-nums">{total((r) => r.source === source && r.status === s)}</td>
                      ))}
                      <td className="px-4 py-2 text-right tabular-nums">{all}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{all ? `${Math.round((won / all) * 100)}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-sm border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Week of</th>
                  {sources.map((s) => <th key={s} className="px-4 py-3 text-right">{s}</th>)}
                  <th className="px-4 py-3 text-right">All</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week} className="border-b border-border/60 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums">{week}</td>
                    {sources.map((s) => (
                      <td key={s} className="px-4 py-2 text-right tabular-nums">{total((r) => r.week === week && r.source === s) || ""}</td>
                    ))}
                    <td className="px-4 py-2 text-right tabular-nums">{total((r) => r.week === week)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
