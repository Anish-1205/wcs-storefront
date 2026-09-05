"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAllProducts } from "@/data/products";
import { SareeCard } from "@/components/catalog/SareeCard";
import { buildWhatsAppURL, WHATSAPP_CONFIGURED } from "@/lib/whatsapp";

export function SearchView() {
  const all = useMemo(() => getAllProducts(), []);
  const [q, setQ] = useState("");

  // Seed from ?q= and keep the URL in sync (shareable searches).
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial) setQ(initial);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
  }, [q]);

  const term = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!term) return all;
    return all.filter((p) => {
      const haystack = [
        p.title,
        p.reference,
        p.category,
        p.colour,
        p.colourFamily,
        p.description,
        p.weave ?? "",
        p.material ?? "",
        p.origin ?? "",
        ...p.details,
      ]
        .join(" ")
        .toLowerCase();
      // also match "wcs004" / "004" style
      return (
        haystack.includes(term) ||
        p.reference.toLowerCase().replace(/-/g, "").includes(term.replace(/-/g, ""))
      );
    });
  }, [term, all]);

  return (
    <>
      <input
        type="search"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by colour, motif or reference (e.g. WCS-004)…"
        className="w-full border-b border-line bg-transparent pb-3 font-serif text-xl text-deep-brown placeholder:text-muted-foreground/50 focus:border-oxblood focus:outline-none sm:text-2xl"
      />
      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
        {results.length} {results.length === 1 ? "result" : "results"}
        {term ? ` for “${q.trim()}”` : ""}
      </p>

      {results.length === 0 ? (
        <div className="py-20 text-center">
          <p className="font-serif text-xl text-deep-brown">
            Nothing matches “{q.trim()}”.
          </p>
          <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
            Try a colour, a motif, or a reference number. Or tell us what you have
            in mind — we source to a brief.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-x-8 gap-y-3">
            <Link
              href="/catalog"
              className="link-underline text-[0.8rem] uppercase tracking-[0.18em] text-oxblood"
            >
              Browse the catalog
            </Link>
            {WHATSAPP_CONFIGURED && (
              <a
                href={buildWhatsAppURL()}
                target="_blank"
                rel="noopener noreferrer"
                className="link-underline text-[0.8rem] uppercase tracking-[0.16em] text-deep-brown/70"
              >
                Ask us ↗
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-14 md:grid-cols-3 lg:gap-x-8">
          {results.map((p) => (
            <SareeCard key={p.slug} product={p} sizes="(min-width:768px) 30vw, 45vw" />
          ))}
        </div>
      )}
    </>
  );
}
