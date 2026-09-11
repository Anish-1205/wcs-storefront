"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ShoppingBag,
  Radio,
  UploadCloud,
  Layers,
  Tags,
  Users,
  MessageSquare,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

const ICONS: Record<string, LucideIcon> = {
  "/admin": LayoutDashboard,
  "/admin/products": ShoppingBag,
  "/admin/storefront-availability": Radio,
  "/admin/import": UploadCloud,
  "/admin/collections": Layers,
  "/admin/categories": Tags,
  "/admin/contacts": Users,
  "/admin/inquiries": MessageSquare,
  "/admin/subscribers": Mail,
};

const STORAGE_KEY = "wcs.admin.sidebarCollapsed";

export function AdminSidebar({
  links,
  siteName,
  userEmail,
}: {
  links: { href: string; label: string }[];
  siteName: string;
  userEmail?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Read the saved preference after mount only — localStorage isn't
  // available during SSR, and this keeps server/client markup identical on
  // first paint (a brief expanded->collapsed flash is an acceptable
  // tradeoff for an internal admin tool).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private browsing / storage disabled — just stay expanded.
    }
  }, []);

  function toggle() {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Nothing to persist to — the toggle still works for this session.
      }
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 md:flex md:h-full md:overflow-y-auto",
        collapsed ? "md:w-16" : "md:w-60",
      )}
    >
      <div
        className={cn(
          "flex items-center border-b border-border p-3",
          collapsed ? "flex-col gap-2" : "justify-between gap-2 p-5",
        )}
      >
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate font-serif text-lg font-semibold text-primary">{siteName}</p>
            <p className="text-xs uppercase tracking-widest text-antique-gold">Admin</p>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-pressed={collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="shrink-0 rounded-sm p-1.5 text-foreground/60 hover:bg-secondary hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {links.map((n) => {
          const Icon = ICONS[n.href];
          return (
            <Link
              key={n.href}
              href={n.href}
              title={collapsed ? n.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-secondary",
                collapsed && "justify-center px-2",
              )}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
              <span className={collapsed ? "sr-only" : "truncate"}>{n.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div
          className={cn(
            "mb-2 flex items-center px-3",
            collapsed ? "flex-col gap-2" : "justify-between",
          )}
        >
          {!collapsed && <p className="truncate text-xs text-muted-foreground">{userEmail}</p>}
          <ThemeToggle className="shrink-0" />
        </div>
        <SignOutButton iconOnly={collapsed} />
      </div>
    </aside>
  );
}
