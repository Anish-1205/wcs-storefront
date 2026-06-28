"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { NAV_LINKS, SITE } from "@/lib/site";
import { buildWhatsAppURL } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-ivory/95 backdrop-blur">
      <nav className="container-px mx-auto flex h-16 max-w-7xl items-center justify-between">
        {/* Wordmark — no logo file yet */}
        <Link href="/" className="flex flex-col leading-none" onClick={() => setOpen(false)}>
          <span className="font-serif text-xl font-semibold tracking-wide text-burgundy">
            {SITE.name}
          </span>
          <span className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-gold-dark">
            Handloom & Silk
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-foreground/80 transition-colors hover:text-burgundy"
            >
              {l.label}
            </Link>
          ))}
          <a href={buildWhatsAppURL()} target="_blank" rel="noopener noreferrer">
            <Button variant="gold" size="sm">
              Enquire on WhatsApp
            </Button>
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div className="border-t border-border/70 bg-ivory md:hidden">
          <div className="container-px mx-auto flex max-w-7xl flex-col py-4">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="py-3 text-base font-medium text-foreground/80"
              >
                {l.label}
              </Link>
            ))}
            <a
              href={buildWhatsAppURL()}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2"
            >
              <Button variant="gold" className="w-full">
                Enquire on WhatsApp
              </Button>
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
