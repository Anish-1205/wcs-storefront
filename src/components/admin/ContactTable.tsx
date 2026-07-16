"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { deleteContact, exportContactsCsv, importContactsCsv } from "@/app/admin/actions";
import type { Contact } from "@/lib/supabase/types";
import type { ContactsQueryShape } from "@/lib/validation";

interface Props {
  contacts: Contact[];
  query?: Partial<ContactsQueryShape>;
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function ContactTable({ contacts, query }: Props) {
  const [search, setSearch] = useState(query?.q ?? "");
  const [role, setRole] = useState<ContactsQueryShape["role"] | "">(query?.role ?? "");
  const [statusTag, setStatusTag] = useState<ContactsQueryShape["status_tag"] | "">(query?.status_tag ?? "");
  const [source, setSource] = useState<ContactsQueryShape["source"] | "">(query?.source ?? "");
  const [sort, setSort] = useState<ContactsQueryShape["sort"]>(query?.sort ?? "updated_at");
  const [dir, setDir] = useState<ContactsQueryShape["dir"]>(query?.dir ?? "desc");
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return [...contacts]
      .filter((contact) =>
        !q ||
        contact.name.toLowerCase().includes(q) ||
        contact.phone.toLowerCase().includes(q) ||
        (contact.notes ?? "").toLowerCase().includes(q),
      )
      .filter((contact) => !role || contact.role === role)
      .filter((contact) => !statusTag || contact.status_tag === statusTag)
      .filter((contact) => !source || contact.source === source)
      .sort((a, b) => {
        const left = a[sort];
        const right = b[sort];
        const compare = sort === "name"
          ? a.name.localeCompare(b.name)
          : sort === "next_follow_up_on"
            ? String(left ?? "").localeCompare(String(right ?? ""))
            : new Date(String(left ?? "")).getTime() - new Date(String(right ?? "")).getTime();
        return dir === "asc" ? compare : -compare;
      });
  }, [contacts, dir, role, search, source, sort, statusTag]);

  function onDelete(id: string, name: string) {
    if (!confirm(`Delete contact "${name}"?`)) return;
    startTransition(() => {
      void deleteContact(id);
    });
  }

  function onExport() {
    startTransition(async () => {
      const csv = await exportContactsCsv({ q: search, role: role || undefined, status_tag: statusTag || undefined, source: source || undefined, sort, dir });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async function onImport(file: File | null) {
    if (!file) return;
    const text = await file.text();
    startTransition(async () => {
      const result = await importContactsCsv(text);
      setImportSummary(`Imported ${result.inserted} new, updated ${result.updated}, skipped ${result.skipped}.`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-6">
        <Input placeholder="Search name, phone, notes…" value={search} onChange={(e) => setSearch(e.target.value)} className="lg:col-span-2" />
        <Select value={role} onChange={(e) => setRole(e.target.value as ContactsQueryShape["role"]) }>
          <option value="">All roles</option>
          <option value="customer">customer</option>
          <option value="reseller">reseller</option>
          <option value="supplier">supplier</option>
          <option value="weaver">weaver</option>
          <option value="other">other</option>
        </Select>
        <Select value={statusTag} onChange={(e) => setStatusTag(e.target.value as ContactsQueryShape["status_tag"]) }>
          <option value="">All tags</option>
          <option value="regular">regular</option>
          <option value="priority">priority</option>
          <option value="good_payer">good_payer</option>
          <option value="delayed_payer">delayed_payer</option>
          <option value="quality_consistent">quality_consistent</option>
          <option value="quality_inconsistent">quality_inconsistent</option>
          <option value="blocked">blocked</option>
        </Select>
        <Select value={source} onChange={(e) => setSource(e.target.value as ContactsQueryShape["source"]) }>
          <option value="">All sources</option>
          <option value="manual">manual</option>
          <option value="import">import</option>
          <option value="inquiry">inquiry</option>
          <option value="subscriber">subscriber</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as ContactsQueryShape["sort"])}>
          <option value="updated_at">Updated</option>
          <option value="created_at">Created</option>
          <option value="name">Name</option>
          <option value="next_follow_up_on">Follow-up</option>
        </Select>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDir((value) => (value === "asc" ? "desc" : "asc"))}>
          Sort {dir === "asc" ? "↑" : "↓"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{filtered.length} contacts</span>
        <Button type="button" variant="gold" size="sm" onClick={onExport} disabled={filtered.length === 0}>
          Export CSV
        </Button>
        <label className="inline-flex h-9 cursor-pointer items-center rounded-sm border border-gold px-4 text-xs font-medium text-burgundy hover:bg-gold hover:text-white">
          <input type="file" accept=",text/csv,.csv" className="hidden" onChange={(e) => void onImport(e.target.files?.[0] ?? null)} />
          Import CSV
        </label>
        {importSummary && <span className="text-sm text-muted-foreground">{importSummary}</span>}
      </div>

      <div className="overflow-x-auto rounded-sm border border-border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status tag</th>
              <th className="px-4 py-3">City</th>
              <th className="px-4 py-3">Last contacted</th>
              <th className="px-4 py-3">Next follow-up</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((contact) => (
              <tr key={contact.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium">{contact.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{contact.phone}</td>
                <td className="px-4 py-3 text-muted-foreground">{contact.role}</td>
                <td className="px-4 py-3 text-muted-foreground">{contact.status_tag}</td>
                <td className="px-4 py-3 text-muted-foreground">{contact.city ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{fmtDate(contact.last_contacted_at)}</td>
                <td className="px-4 py-3 text-muted-foreground">{contact.next_follow_up_on ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{contact.source}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/contacts/${contact.id}`} className="text-xs font-medium text-burgundy hover:underline">Edit</Link>
                  <button onClick={() => onDelete(contact.id, contact.name)} className="ml-3 text-xs font-medium text-destructive hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">No contacts found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
