import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { SITE } from "@/lib/site";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { AdminMobileNav } from "@/components/admin/AdminMobileNav";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/import", label: "Import" },
  { href: "/admin/collections", label: "Collections" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/contacts", label: "Contacts" },
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
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card md:flex md:flex-col">
        <div className="border-b border-border p-5">
          <p className="font-serif text-lg font-semibold text-primary">
            {SITE.name}
          </p>
          <p className="text-xs uppercase tracking-widest text-antique-gold">
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
          <div className="mb-2 flex items-center justify-between px-3">
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
            <ThemeToggle className="shrink-0" />
          </div>
          <SignOutButton />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex items-center justify-between border-b border-border bg-card px-4 py-3 md:hidden">
          <span className="font-serif font-semibold text-primary">Admin</span>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <AdminMobileNav links={NAV} />
          </div>
        </header>
        <main className="flex-1 p-5 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
