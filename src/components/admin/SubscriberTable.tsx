"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Pagination } from "./Pagination";
import { buildWhatsAppContactURL } from "@/lib/whatsapp";
import { VALID_SOURCES } from "@/lib/source-tracking";
import { isAdminPageSize, type AdminSubscribersQueryShape } from "@/lib/validation";
import { exportSubscribersCsv } from "@/app/admin/subscriber-actions";
import type { WhatsAppSubscriber } from "@/lib/supabase/types";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function buildQueryString(query: AdminSubscribersQueryShape): string {
  const params = new URLSearchParams();
  if (query.source) params.set("source", query.source);
  if (query.page > 1) params.set("page", String(query.page));
  params.set("per", String(query.per));
  return params.toString();
}

export function SubscriberTable({
  subscribers,
  total,
  query,
}: {
  subscribers: WhatsAppSubscriber[];
  /** Matching the filter, across all pages. */
  total: number;
  /** What the server ran: filter and paging live in the URL (T4.7). */
  query: AdminSubscribersQueryShape;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const apply = (patch: Partial<AdminSubscribersQueryShape>) =>
    startTransition(() => router.push(`/admin/subscribers?${buildQueryString({ ...query, page: 1, ...patch })}`, { scroll: false }));

  async function exportCSV() {
    setError(null);
    const result = await exportSubscribersCsv(query);
    if (!result.ok) return setError(result.error);
    const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Source" value={query.source} onChange={(e) => apply({ source: e.target.value })} className="h-9 w-44">
          <option value="">All sources</option>
          {[...VALID_SOURCES, "unknown"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <span className="text-sm text-muted-foreground">{total} subscribers</span>
        <Button variant="gold" size="sm" className="ml-auto" onClick={exportCSV} disabled={total === 0}>
          Export CSV
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className={`overflow-x-auto rounded-sm border border-border bg-card ${pending ? "opacity-60" : ""}`}>
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {subscribers.map((s) => (
              <tr key={s.id} className="border-b border-border/60 last:border-0">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtDate(s.opted_in_at)}</td>
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3">
                  <a href={buildWhatsAppContactURL(s.phone, s.name)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {s.phone}
                  </a>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{s.source}</td>
              </tr>
            ))}
            {subscribers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No subscribers match.</td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          page={query.page}
          pageSize={query.per}
          total={total}
          onPageChange={(page) => apply({ page })}
          onPageSizeChange={(per) => isAdminPageSize(per) && apply({ per })}
          itemLabel="subscriber"
          disabled={pending}
        />
      </div>
    </div>
  );
}
