import { requireAdmin } from "@/lib/admin-auth";
import { SITE } from "@/lib/site";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminMobileNav } from "@/components/admin/AdminMobileNav";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/pages", label: "Website pages" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/storefront-availability", label: "Storefront Signals" },
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
    <div className="flex h-screen overflow-hidden bg-ivory">
      <AdminSidebar links={NAV} siteName={SITE.name} userEmail={user.email} />

      {/* Mobile top bar + main content — its own scroll region, independent
          of the sidebar's (see AdminSidebar's md:overflow-y-auto). */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3 md:hidden">
          <span className="font-serif font-semibold text-primary">Admin</span>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <AdminMobileNav links={NAV} />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-5 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
