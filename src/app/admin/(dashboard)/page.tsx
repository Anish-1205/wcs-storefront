import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import type { SupabaseClient } from "@supabase/supabase-js";

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

  const [products, published, drafts, inquiries, subscribers] = await Promise.all([
    count(admin, "products"),
    count(admin, "products", { col: "status", val: "published" }),
    count(admin, "products", { col: "status", val: "draft" }),
    count(admin, "inquiries"),
    count(admin, "whatsapp_subscribers"),
  ]);

  const cards = [
    { label: "Total products", value: products, href: "/admin/products" },
    { label: "Published", value: published, href: "/admin/products" },
    { label: "Drafts", value: drafts, href: "/admin/products" },
    { label: "Inquiries", value: inquiries, href: "/admin/inquiries" },
    { label: "Subscribers", value: subscribers, href: "/admin/subscribers" },
  ];

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-3xl text-burgundy">Dashboard</h1>
        <Link
          href="/admin/products/new"
          className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-burgundy-light"
        >
          + Add Product
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-sm border border-border bg-white p-5 transition-shadow hover:shadow-sm"
          >
            <p className="text-3xl font-semibold text-burgundy">{c.value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{c.label}</p>
          </Link>
        ))}
      </div>

      <div className="mt-10 rounded-sm border border-border bg-white p-6">
        <h2 className="font-serif text-lg text-burgundy">Quick links</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <Link href="/admin/products/new" className="text-burgundy hover:underline">
              Add a new product →
            </Link>
          </li>
          <li>
            <Link href="/admin/inquiries" className="text-burgundy hover:underline">
              Review recent inquiries →
            </Link>
          </li>
          <li>
            <Link href="/admin/subscribers" className="text-burgundy hover:underline">
              Export WhatsApp subscribers →
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
