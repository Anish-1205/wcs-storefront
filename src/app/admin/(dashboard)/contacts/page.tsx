import { requireAdmin } from "@/lib/admin-auth";
import { ContactTable } from "@/components/admin/ContactTable";
import type { Contact } from "@/lib/supabase/types";
import { contactsQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function ContactsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { admin } = await requireAdmin();
  const query = contactsQuerySchema.parse({
    q: typeof searchParams.q === "string" ? searchParams.q : "",
    role: typeof searchParams.role === "string" ? searchParams.role : "",
    status_tag: typeof searchParams.status_tag === "string" ? searchParams.status_tag : "",
    source: typeof searchParams.source === "string" ? searchParams.source : "",
    sort: typeof searchParams.sort === "string" ? searchParams.sort : "updated_at",
    dir: typeof searchParams.dir === "string" ? searchParams.dir : "desc",
  });

  let q = admin.from("contacts").select("*");
  if (query.q) {
    const escaped = query.q.replace(/%/g, "\\%").replace(/_/g, "\\_");
    q = q.or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%,notes.ilike.%${escaped}%`);
  }
  if (query.role) q = q.eq("role", query.role);
  if (query.status_tag) q = q.eq("status_tag", query.status_tag);
  if (query.source) q = q.eq("source", query.source);
  q = q.order(query.sort, { ascending: query.dir === "asc" });

  const { data } = await q;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-3xl text-burgundy">Contacts CRM</h1>
        <div className="flex gap-3">
          <a href="/admin/contacts/new" className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-burgundy-light">+ Add Contact</a>
        </div>
      </div>
      <ContactTable contacts={(data ?? []) as Contact[]} query={query} />
    </div>
  );
}
