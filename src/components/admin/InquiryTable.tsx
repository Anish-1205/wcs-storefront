"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Pagination } from "./Pagination";
import { buildWhatsAppContactURL } from "@/lib/whatsapp";
import { VALID_SOURCES } from "@/lib/source-tracking";
import { INQUIRY_STATUSES, isAdminPageSize, type AdminInquiriesQueryShape, type InquiryStatus } from "@/lib/validation";
import { exportInquiriesCsv, saveInquiryNotes, updateInquiryStatus } from "@/app/admin/inquiry-actions";
import type { Inquiry } from "@/lib/supabase/types";

const TYPE_VARIANT: Record<string, "gold" | "burgundy" | "gray"> = {
  retail: "gold",
  wholesale: "burgundy",
  general: "gray",
};

const STATUS_LABEL: Record<InquiryStatus, string> = { new: "New", contacted: "Contacted", won: "Won", lost: "Lost" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function buildQueryString(query: AdminInquiriesQueryShape): string {
  const params = new URLSearchParams();
  if (query.type) params.set("type", query.type);
  if (query.source) params.set("source", query.source);
  if (query.status) params.set("status", query.status);
  if (query.due) params.set("due", query.due);
  if (query.page > 1) params.set("page", String(query.page));
  params.set("per", String(query.per));
  return params.toString();
}

interface Props {
  inquiries: Inquiry[];
  /** Matching the filters, across all pages. */
  total: number;
  /** What the server ran: filters and paging live in the URL. */
  query: AdminInquiriesQueryShape;
  /** False until migration 037: no status, notes or follow-up. */
  workflow: boolean;
}

export function InquiryTable({ inquiries, total, query, workflow }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState<{ admin_notes: string; follow_up_on: string }>({ admin_notes: "", follow_up_on: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const apply = (patch: Partial<AdminInquiriesQueryShape>) => {
    const next = { ...query, page: 1, ...patch };
    startTransition(() => router.push(`/admin/inquiries?${buildQueryString(next)}`, { scroll: false }));
  };

  async function changeStatus(id: string, status: InquiryStatus) {
    setError(null);
    setBusy(id);
    const result = await updateInquiryStatus(id, status);
    setBusy(null);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  function toggle(inquiry: Inquiry) {
    if (open === inquiry.id) return setOpen(null);
    setNotes({ admin_notes: inquiry.admin_notes ?? "", follow_up_on: inquiry.follow_up_on ?? "" });
    setOpen(inquiry.id);
  }

  async function saveNotes(id: string) {
    setError(null);
    setBusy(id);
    const result = await saveInquiryNotes({ id, admin_notes: notes.admin_notes, follow_up_on: notes.follow_up_on || null });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setOpen(null);
    router.refresh();
  }

  async function download() {
    setError(null);
    const result = await exportInquiriesCsv(query);
    if (!result.ok) return setError(result.error);
    const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `inquiries-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    if (result.truncated) setError("Only the newest 5,000 matching enquiries were exported. Narrow the filters for the rest.");
  }

  const columns = workflow ? 9 : 7;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Type" value={query.type} onChange={(e) => apply({ type: e.target.value as AdminInquiriesQueryShape["type"] })} className="h-9 w-40">
          <option value="">All types</option>
          <option value="retail">Retail</option>
          <option value="wholesale">Wholesale</option>
          <option value="general">General</option>
        </Select>
        <Select aria-label="Source" value={query.source} onChange={(e) => apply({ source: e.target.value })} className="h-9 w-40">
          <option value="">All sources</option>
          {[...VALID_SOURCES, "unknown"].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        {workflow && (
          <>
            <Select aria-label="Status" value={query.status} onChange={(e) => apply({ status: e.target.value as AdminInquiriesQueryShape["status"] })} className="h-9 w-40">
              <option value="">All statuses</option>
              {INQUIRY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={query.due === "due"} onChange={(e) => apply({ due: e.target.checked ? "due" : "" })} />
              Follow-up due
            </label>
          </>
        )}
        <button type="button" onClick={download} className="ml-auto rounded-sm border border-border px-3 py-1.5 text-sm hover:bg-secondary">
          Export CSV
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className={`overflow-x-auto rounded-sm border border-border bg-card ${pending ? "opacity-60" : ""}`}>
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
              {workflow && <th className="px-4 py-3">Status</th>}
              {workflow && <th className="px-4 py-3">Follow-up</th>}
            </tr>
          </thead>
          <tbody>
            {inquiries.map((i) => (
              <Fragment key={i.id}>
                <tr className="border-b border-border/60 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtDate(i.created_at)}</td>
                  <td className="px-4 py-3 font-medium">{i.name}</td>
                  <td className="px-4 py-3">
                    <a href={buildWhatsAppContactURL(i.phone, i.name)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {i.phone}
                    </a>
                  </td>
                  <td className="px-4 py-3"><Badge variant={TYPE_VARIANT[i.inquiry_type] ?? "gray"}>{i.inquiry_type}</Badge></td>
                  <td className="px-4 py-3 text-muted-foreground">{i.source}</td>
                  <td className="px-4 py-3 text-muted-foreground">{i.product_name ?? "—"}</td>
                  <td className="max-w-xs px-4 py-3 text-muted-foreground"><span className="line-clamp-2">{i.message ?? "—"}</span></td>
                  {workflow && (
                    <td className="px-4 py-3">
                      <Select aria-label={`Status of ${i.name}'s enquiry`} value={i.status ?? "new"} disabled={busy === i.id}
                        onChange={(e) => changeStatus(i.id, e.target.value as InquiryStatus)} className="h-8 w-32">
                        {INQUIRY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </Select>
                    </td>
                  )}
                  {workflow && (
                    <td className="whitespace-nowrap px-4 py-3">
                      <button type="button" onClick={() => toggle(i)} className="text-primary hover:underline">
                        {i.follow_up_on ? fmtDate(i.follow_up_on) : i.admin_notes ? "Notes" : "Add"}
                      </button>
                    </td>
                  )}
                </tr>
                {workflow && open === i.id && (
                  <tr className="border-b border-border/60 bg-secondary/20">
                    <td colSpan={columns} className="px-4 py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <label className="flex-1 text-xs text-muted-foreground">
                          Notes (visible to admin only)
                          <textarea value={notes.admin_notes} maxLength={4000} rows={3}
                            onChange={(e) => setNotes((n) => ({ ...n, admin_notes: e.target.value }))}
                            className="mt-1 w-full rounded-sm border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
                        </label>
                        <label className="text-xs text-muted-foreground">
                          Follow up on
                          <input type="date" value={notes.follow_up_on}
                            onChange={(e) => setNotes((n) => ({ ...n, follow_up_on: e.target.value }))}
                            className="mt-1 block rounded-sm border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
                        </label>
                        <div className="flex gap-2">
                          <button type="button" disabled={busy === i.id} onClick={() => saveNotes(i.id)}
                            className="rounded-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">Save</button>
                          <button type="button" onClick={() => setOpen(null)} className="rounded-sm border border-border px-3 py-1.5 text-sm">Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {inquiries.length === 0 && (
              <tr>
                <td colSpan={columns} className="px-4 py-10 text-center text-muted-foreground">No enquiries match.</td>
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
          itemLabel="inquiry"
          disabled={pending}
        />
      </div>
    </div>
  );
}
