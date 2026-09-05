"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X, Search, Home } from "lucide-react";
import { NAV_LINKS, SITE } from "@/lib/site";
import { buildWhatsAppURL, WHATSAPP_CONFIGURED } from "@/lib/whatsapp";
import { CartButton } from "@/components/cart/CartButton";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { AccountButton } from "@/components/auth/AccountButton";
import { cn } from "@/lib/utils";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b bg-ivory/90 backdrop-blur transition-colors",
        scrolled ? "border-line" : "border-transparent",
      )}
    >
      <nav className="container-px mx-auto flex h-[4.25rem] max-w-[90rem] items-center gap-2 sm:h-[4.5rem] sm:justify-between sm:gap-6">
        <button
          className="-ml-2 shrink-0 p-2 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        {/* Home (top-left) */}
        <Link
          href="/"
          onClick={() => setOpen(false)}
          aria-label="Home"
          className="hidden shrink-0 text-deep-brown/80 transition-colors hover:text-oxblood sm:inline-flex md:-ml-1"
        >
          <Home className="h-[1.05rem] w-[1.05rem]" />
        </Link>

        {/* Desktop links (left) */}
        <div className="hidden flex-1 items-center gap-6 md:flex lg:gap-7">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="link-underline whitespace-nowrap text-[0.78rem] uppercase tracking-[0.12em] text-deep-brown/80 hover:text-oxblood lg:text-[0.82rem] lg:tracking-[0.14em]"
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Wordmark */}
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="min-w-0 shrink text-center md:shrink-0"
        >
          <span className="block truncate font-serif text-[0.88rem] leading-none tracking-[0.06em] text-oxblood sm:text-[1.15rem] sm:tracking-[0.12em] lg:text-[1.3rem]">
            {SITE.name.toUpperCase()}
          </span>
        </Link>

        {/* Actions (right) */}
        <div className="ml-auto flex shrink-0 items-center justify-end gap-3 sm:ml-0 sm:flex-1 sm:gap-5">
          <Link
            href="/search"
            aria-label="Search"
            className="hidden text-deep-brown/80 hover:text-oxblood sm:block"
          >
            <Search className="h-[1.05rem] w-[1.05rem]" />
          </Link>
          <ThemeToggle />
          <AccountButton />
          <CartButton />
          {WHATSAPP_CONFIGURED && (
            <a
              href={buildWhatsAppURL()}
              target="_blank"
              rel="noopener noreferrer"
              className="link-underline hidden whitespace-nowrap text-[0.82rem] uppercase tracking-[0.14em] text-oxblood lg:inline-flex"
            >
              Speak to Us ↗
            </a>
          )}
        </div>
      </nav>

      {open && (
        <div className="border-t border-line bg-ivory md:hidden">
          <div className="container-px mx-auto flex max-w-[90rem] flex-col py-3">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="py-3 text-[0.9rem] uppercase tracking-[0.14em] text-deep-brown/85"
            >
              Home
            </Link>
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="py-3 text-[0.9rem] uppercase tracking-[0.14em] text-deep-brown/85"
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/search"
              onClick={() => setOpen(false)}
              className="py-3 text-[0.9rem] uppercase tracking-[0.14em] text-deep-brown/85"
            >
              Search
            </Link>
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="py-3 text-[0.9rem] uppercase tracking-[0.14em] text-deep-brown/85"
            >
              Account
            </Link>
            {WHATSAPP_CONFIGURED && (
              <a
                href={buildWhatsAppURL()}
                target="_blank"
                rel="noopener noreferrer"
                className="py-3 text-[0.9rem] uppercase tracking-[0.14em] text-oxblood"
              >
                Speak to Us ↗
              </a>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
