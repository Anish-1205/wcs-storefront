import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { SITE } from "@/lib/site";
import { SignOutButton } from "@/components/admin/SignOutButton";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/collections", label: "Collections" },
  { href: "/admin/inquiries", label: "Inquiries" },
  { href: "/admin/subscribers", label: "Subscribers" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Secondary defence-in-depth check (middleware is the first layer).
  const { user } = await requireAdmin();

  return (
    <div className="flex min-h-screen bg-ivory">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-white md:flex md:flex-col">
        <div className="border-b border-border p-5">
          <p className="font-serif text-lg font-semibold text-burgundy">
            {SITE.name}
          </p>
          <p className="text-xs uppercase tracking-widest text-gold-dark">
            Admin
          </p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="block rounded-sm px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-secondary"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <p className="mb-2 truncate px-3 text-xs text-muted-foreground">
            {user.email}
          </p>
          <SignOutButton />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-white px-4 py-3 md:hidden">
          <span className="font-serif font-semibold text-burgundy">Admin</span>
          <nav className="flex gap-3 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-foreground/70">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 p-5 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
