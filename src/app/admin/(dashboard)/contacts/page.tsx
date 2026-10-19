import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { ContactTable } from "@/components/admin/ContactTable";
import type { Contact } from "@/lib/supabase/types";
import { contactsPageQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const CONTACT_COLUMNS =
  "id, name, phone, role, status_tag, city, source, whatsapp_opt_in, rating, notes, last_contacted_at, next_follow_up_on, created_at, updated_at";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ContactsPage(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  const { admin } = await requireAdmin();
  // Filters, sort and paging live in the URL and run in Postgres (T4.7). The
  // CSV export (exportContactsCsv) still reads the whole filtered set.
  const query = contactsPageQuerySchema.parse({
    q: first(searchParams.q) ?? "",
    role: first(searchParams.role) ?? "",
    status_tag: first(searchParams.status_tag) ?? "",
    source: first(searchParams.source) ?? "",
    sort: first(searchParams.sort) ?? "updated_at",
    dir: first(searchParams.dir) ?? "desc",
    page: first(searchParams.page) ?? 1,
    per: first(searchParams.per) ?? undefined,
  });

  let q = admin.from("contacts").select(CONTACT_COLUMNS, { count: "exact" });
  if (query.q) {
    const escaped = query.q.replace(/%/g, "\\%").replace(/_/g, "\\_");
    q = q.or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%,notes.ilike.%${escaped}%`);
  }
  if (query.role) q = q.eq("role", query.role);
  if (query.status_tag) q = q.eq("status_tag", query.status_tag);
  if (query.source) q = q.eq("source", query.source);
  const from = (query.page - 1) * query.per;
  q = q.order(query.sort, { ascending: query.dir === "asc" }).range(from, from + query.per - 1);

  const { data, count, error } = await q;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-3xl text-primary">Contacts CRM</h1>
        <div className="flex gap-3">
          <Link href="/admin/contacts/new" className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-light">+ Add Contact</Link>
        </div>
      </div>
      {error && (
        <p className="mb-4 rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Could not load contacts: {error.message}
        </p>
      )}
      <ContactTable contacts={(data ?? []) as Contact[]} total={count ?? 0} query={query} />
    </div>
  );
}
