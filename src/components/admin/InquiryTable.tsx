"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { buildWhatsAppContactURL } from "@/lib/whatsapp";
import type { Inquiry } from "@/lib/supabase/types";

const TYPE_VARIANT: Record<string, "gold" | "burgundy" | "gray"> = {
  retail: "gold",
  wholesale: "burgundy",
  general: "gray",
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function InquiryTable({ inquiries }: { inquiries: Inquiry[] }) {
  const [typeFilter, setTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  const sources = Array.from(new Set(inquiries.map((i) => i.source)));

  const filtered = inquiries.filter(
    (i) =>
      (!typeFilter || i.inquiry_type === typeFilter) &&
      (!sourceFilter || i.source === sourceFilter),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-9 w-44"
        >
          <option value="">All types</option>
          <option value="retail">Retail</option>
          <option value="wholesale">Wholesale</option>
          <option value="general">General</option>
        </Select>
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
        <span className="self-center text-sm text-muted-foreground">
          {filtered.length} of {inquiries.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-sm border border-border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Message</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => (
              <tr key={i.id} className="border-b border-border/60 align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {fmtDate(i.created_at)}
                </td>
                <td className="px-4 py-3 font-medium">{i.name}</td>
                <td className="px-4 py-3">
                  <a
                    href={buildWhatsAppContactURL(i.phone, i.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-burgundy hover:underline"
                  >
                    {i.phone}
                  </a>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={TYPE_VARIANT[i.inquiry_type] ?? "gray"}>
                    {i.inquiry_type}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{i.source}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {i.product_name ?? "—"}
                </td>
                <td className="max-w-xs px-4 py-3 text-muted-foreground">
                  <span className="line-clamp-2">{i.message ?? "—"}</span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  No inquiries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
