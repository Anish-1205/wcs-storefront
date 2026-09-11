"use client";

import { useState } from "react";
import { DEFAULT_HOMEPAGE, HOME_SECTIONS, type HomepageContent } from "@/lib/homepage-content";
import { saveHomepageContent } from "@/app/admin/page-content-actions";

export function HomepageEditor({ initial, products, available }: { initial: HomepageContent; products: { slug: string; title: string }[]; available: boolean }) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function move<T>(items: T[], index: number, delta: number): T[] {
    const copy = [...items]; [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]]; return copy;
  }
  async function save() {
    setBusy(true);
    try { const result = await saveHomepageContent(draft); setMessage(result.ok ? "Homepage published. Reload the page preview below to see the new layout." : result.error); }
    catch { setMessage("Could not save. Please try again."); }
    finally { setBusy(false); }
  }
  const shelf = [...draft.shelfOrder, ...products.map((p) => p.slug).filter((slug) => !draft.shelfOrder.includes(slug))];
  return <details className="rounded-sm border bg-card p-5">
    <summary className="cursor-pointer font-serif text-xl">Homepage layout and product placement</summary>
    <div className="mt-5 space-y-6">
      <p className="text-base text-muted-foreground">Choose the welcome saree, up to four featured pieces, section order, and shelf order. The shelf automatically includes every saree not shown in a visible welcome or featured section.</p>
      <label className="grid gap-2">Welcome saree<select className="min-h-11 border bg-background p-2" value={draft.heroSlug} onChange={(e) => setDraft({ ...draft, heroSlug: e.target.value, featuredSlugs: draft.featuredSlugs.filter((slug) => slug !== e.target.value) })}>{products.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}</select></label>
      <div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((index) => <label key={index} className="grid gap-2">Featured position {index + 1}<select value={draft.featuredSlugs[index] ?? ""} className="min-h-11 border bg-background p-2" onChange={(e) => { const selected = [...draft.featuredSlugs]; selected[index] = e.target.value; setDraft({ ...draft, featuredSlugs: selected.filter(Boolean) }); }}><option value="">No saree</option>{products.filter((p) => p.slug !== draft.heroSlug).map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}</select></label>)}</div>
      <h3 className="font-semibold">Sections, in display order</h3>
      {draft.sections.map((section, index) => <div key={section.key} className="flex flex-wrap items-center gap-3 border-b pb-3">
        <label className="flex min-h-11 flex-1 items-center gap-3"><input type="checkbox" checked={section.visible} onChange={(e) => setDraft({ ...draft, sections: draft.sections.map((s) => s.key === section.key ? { ...s, visible: e.target.checked } : s) })} />{HOME_SECTIONS.find(([key]) => key === section.key)?.[1]}</label>
        <button type="button" aria-label={`Move ${section.key} up`} disabled={index === 0} className="min-h-11 border px-3 disabled:opacity-40" onClick={() => setDraft({ ...draft, sections: move(draft.sections, index, -1) })}>Up</button>
        <button type="button" aria-label={`Move ${section.key} down`} disabled={index === draft.sections.length - 1} className="min-h-11 border px-3 disabled:opacity-40" onClick={() => setDraft({ ...draft, sections: move(draft.sections, index, 1) })}>Down</button>
      </div>)}
      <details><summary className="cursor-pointer py-3 font-semibold">Shelf order</summary><div className="max-h-96 overflow-y-auto">{shelf.map((slug, index) => <div key={slug} className="flex items-center gap-3 border-b py-2"><span className="flex-1">{products.find((p) => p.slug === slug)?.title}</span><button type="button" aria-label={`Move ${slug} up`} disabled={index === 0} className="min-h-11 border px-3 disabled:opacity-40" onClick={() => setDraft({ ...draft, shelfOrder: move(shelf, index, -1) })}>Up</button><button type="button" aria-label={`Move ${slug} down`} disabled={index === shelf.length - 1} className="min-h-11 border px-3 disabled:opacity-40" onClick={() => setDraft({ ...draft, shelfOrder: move(shelf, index, 1) })}>Down</button></div>)}</div></details>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || !available} onClick={save} className="min-h-11 bg-primary px-5 text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : "Publish homepage layout"}</button><button type="button" onClick={() => setDraft(DEFAULT_HOMEPAGE)} className="min-h-11 border px-4">Load original layout</button></div>
      <p role="status">{message}</p>
    </div>
  </details>;
}
