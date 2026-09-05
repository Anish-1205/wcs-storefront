"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";

export function AdminMobileNav({
  links,
}: {
  links: { href: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="admin-mobile-menu"
        aria-label={open ? "Close admin menu" : "Open admin menu"}
        className="rounded-sm p-2 text-primary"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open && (
        <nav
          id="admin-mobile-menu"
          className="absolute inset-x-0 top-full z-50 grid grid-cols-2 gap-1 border-b border-border bg-card p-3 shadow-lg"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-sm px-3 py-3 text-sm text-foreground/80 hover:bg-secondary"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
