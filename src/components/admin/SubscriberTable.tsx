"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { buildWhatsAppContactURL } from "@/lib/whatsapp";
import type { WhatsAppSubscriber } from "@/lib/supabase/types";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toCSV(rows: WhatsAppSubscriber[]): string {
  const header = ["Date", "Name", "Phone", "Source"];
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [fmtDate(r.opted_in_at), r.name, r.phone, r.source].map(esc).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function SubscriberTable({
  subscribers,
}: {
  subscribers: WhatsAppSubscriber[];
}) {
  const [sourceFilter, setSourceFilter] = useState("");
  const sources = Array.from(new Set(subscribers.map((s) => s.source)));
  const filtered = subscribers.filter(
    (s) => !sourceFilter || s.source === sourceFilter,
  );

  function exportCSV() {
    const csv = toCSV(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="h-9 w-44"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <span className="text-sm text-muted-foreground">
          {filtered.length} subscribers
        </span>
        <Button
          variant="gold"
          size="sm"
          className="ml-auto"
          onClick={exportCSV}
          disabled={filtered.length === 0}
        >
          Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto rounded-sm border border-border bg-white">
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
            {filtered.map((s) => (
              <tr key={s.id} className="border-b border-border/60 last:border-0">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {fmtDate(s.opted_in_at)}
                </td>
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3">
                  <a
                    href={buildWhatsAppContactURL(s.phone, s.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-burgundy hover:underline"
                  >
                    {s.phone}
                  </a>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{s.source}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  No subscribers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
