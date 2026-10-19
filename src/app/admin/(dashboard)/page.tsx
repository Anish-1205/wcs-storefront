import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInIndia } from "@/lib/inquiry-queries";

interface DueInquiry {
  id: string;
  name: string;
  follow_up_on: string;
  status: string;
  product_name: string | null;
}

/**
 * Enquiries whose follow-up date is today or past and that are still open
 * (T4.5). Empty, not an error, on a database without migration 037.
 */
async function dueFollowUps(admin: SupabaseClient): Promise<{ rows: DueInquiry[]; newCount: number | null }> {
  const [due, fresh] = await Promise.all([
    admin.from("inquiries").select("id, name, follow_up_on, status, product_name")
      .lte("follow_up_on", todayInIndia()).in("status", ["new", "contacted"])
      .order("follow_up_on").limit(10),
    admin.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "new"),
  ]);
  return { rows: due.error ? [] : ((due.data ?? []) as DueInquiry[]), newCount: fresh.error ? null : fresh.count ?? 0 };
}

export const dynamic = "force-dynamic";

async function count(
  admin: SupabaseClient,
  table: string,
  filter?: { col: string; val: string },
): Promise<number> {
  let q = admin.from(table).select("*", { count: "exact", head: true });
  if (filter) q = q.eq(filter.col, filter.val);
  const { count: c } = await q;
  return c ?? 0;
}

export default async function AdminDashboard() {
  const { admin } = await requireAdmin();

  const [products, published, drafts, inquiries, subscribers, followUps] = await Promise.all([
    count(admin, "products"),
    count(admin, "products", { col: "status", val: "published" }),
    count(admin, "products", { col: "status", val: "draft" }),
    count(admin, "inquiries"),
    count(admin, "whatsapp_subscribers"),
    dueFollowUps(admin),
  ]);
  const today = todayInIndia();

  const cards = [
    { label: "Website pages", value: "→", href: "/admin/pages" },
    { label: "Total products", value: products, href: "/admin/products" },
    { label: "Published", value: published, href: "/admin/products" },
    { label: "Drafts", value: drafts, href: "/admin/products" },
    { label: "Inquiries", value: inquiries, href: "/admin/inquiries" },
    ...(followUps.newCount !== null ? [{ label: "New inquiries", value: followUps.newCount, href: "/admin/inquiries?status=new" }] : []),
    { label: "Subscribers", value: subscribers, href: "/admin/subscribers" },
    { label: "Collections", value: "→", href: "/admin/collections" },
  ];

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-3xl text-primary">Dashboard</h1>
        <Link
          href="/admin/products/new"
          className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-light"
        >
          + Add Product
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-sm border border-border bg-card p-5 transition-shadow hover:shadow-sm"
          >
            <p className="text-3xl font-semibold text-primary">{c.value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{c.label}</p>
          </Link>
        ))}
      </div>

      {followUps.rows.length > 0 && (
        <div className="mt-10 rounded-sm border border-border bg-card p-6">
          <h2 className="font-serif text-lg text-primary">Follow-ups due</h2>
          <ul className="mt-3 divide-y divide-border text-sm">
            {followUps.rows.map((row) => (
              <li key={row.id} className="flex justify-between gap-4 py-2">
                <span>
                  {row.name}
                  {row.product_name ? <span className="text-muted-foreground"> · {row.product_name}</span> : null}
                </span>
                <span className={row.follow_up_on < today ? "text-destructive" : "text-muted-foreground"}>
                  {row.follow_up_on < today ? `overdue since ${row.follow_up_on}` : "today"}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/admin/inquiries?due=due" className="mt-3 inline-block text-sm text-primary hover:underline">
            All due follow-ups →
          </Link>
        </div>
      )}

      <div className="mt-10 rounded-sm border border-border bg-card p-6">
        <h2 className="font-serif text-lg text-primary">Quick links</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <Link href="/admin/products/new" className="text-primary hover:underline">
              Add a new product →
            </Link>
          </li>
          <li>
            <Link href="/admin/inquiries" className="text-primary hover:underline">
              Review recent inquiries →
            </Link>
          </li>
          <li>
            <Link href="/admin/subscribers" className="text-primary hover:underline">
              Export WhatsApp subscribers →
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
