"use client";

import { useState } from "react";
import Image from "next/image";
import { DEFAULT_HOMEPAGE, HOME_SECTIONS, type HomepageContent } from "@/lib/homepage-content";
import { publishPageContent, restorePageVersion, savePageDraft } from "@/app/admin/page-content-actions";
import { HistoryPanel, SaveBar, type SaveState } from "@/components/admin/page-editor-parts";

export type HomepageProduct = { slug: string; title: string; image: string };

/** What each homepage block is, in the words its owner would use. */
const SECTION_HELP: Record<string, { label: string; hint: string }> = {
  hero: { label: "Welcome banner", hint: "The very first thing visitors see: one big saree photo and your welcome words." },
  colours: { label: "Browse by colour", hint: "Colour swatches that take visitors to sarees in that shade." },
  selection: { label: "Sarees you are showing off", hint: "Up to four pieces you want visitors to notice first." },
  colourStory: { label: "Colour story", hint: "A wide picture and a line about the colours in the room." },
  detail: { label: "Close-up of the craft", hint: "Detail photography — weave, zari and border close-ups." },
  shelf: { label: "The rest of your sarees", hint: "Every other saree, in the order you choose below." },
  sourcing: { label: "“Looking for something particular?”", hint: "Invites visitors to ask you to source a specific piece." },
  ordering: { label: "How ordering works", hint: "The short explanation of what happens after an enquiry." },
  contact: { label: "WhatsApp and pricing note", hint: "The closing block that points visitors to WhatsApp." },
};
const TITLE_FIELDS: [keyof HomepageContent, string, string][] = [
  ["heroEyebrow", "Small line above the welcome words", "A few words only — it sits in small type above the big text."],
  ["heroTitle", "Big welcome words", "Keep this under about 8 words. It is the largest text on your website."],
  ["heroBody", "Welcome paragraph", "Two or three sentences. Say who you are and what visitors will find."],
  ["colourTitle", "Heading above the colour swatches", "One short line."],
  ["selectionTitle", "Heading above the sarees you are showing off", "One short line, e.g. “In the room now”."],
  ["detailTitle", "Heading above the close-up photos", "One short line."],
  ["shelfTitle", "Heading above the rest of your sarees", "One short line."],
  ["sourcingTitle", "Heading on the “something particular” block", "One short line, usually a question."],
  ["orderingTitle", "Heading on the “how ordering works” block", "One short line."],
  ["contactTitle", "Heading on the closing WhatsApp block", "One short line."],
];

export function HomepageEditor({ initial, draft: savedDraft, products, versions, available }: {
  initial: HomepageContent;
  draft: HomepageContent | null;
  products: HomepageProduct[];
  versions: { id: string; created_at: string }[];
  available: boolean;
}) {
  const [draft, setDraft] = useState(savedDraft ?? initial);
  const [published, setPublished] = useState(initial);
  // A draft saved on an earlier visit is already "not on the website yet".
  const [dirty, setDirty] = useState(Boolean(savedDraft) && JSON.stringify(savedDraft) !== JSON.stringify(initial));
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");

  function edit(changes: Partial<HomepageContent>) {
    setDraft((old) => ({ ...old, ...changes }));
    setDirty(true);
    setState("idle");
    setMessage("");
  }
  function move<T>(items: T[], index: number, delta: number): T[] {
    const copy = [...items];
    [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]];
    return copy;
  }
  async function write(action: typeof savePageDraft, live: boolean) {
    setState("busy"); setMessage("");
    try {
      const result = await action("home", draft);
      if (!result.ok) throw new Error(result.error);
      if (live) setPublished(draft);
      setDirty(false);
      setState("done");
      setMessage(live
        ? "Done — your homepage is arranged this way for visitors now."
        : "Saved for later. Only you can see this arrangement; visitors still see the previous one.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not save. Please try again.");
    }
  }
  async function restore(versionId: string) {
    setState("busy"); setMessage("");
    try {
      const result = await restorePageVersion("home", versionId);
      if (!result.ok) throw new Error(result.error);
      const content = (result as { content?: HomepageContent }).content;
      if (content) { setDraft(content); setPublished(content); }
      setDirty(false);
      setState("done");
      setMessage("That earlier homepage arrangement is back on the website.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not go back to that version.");
    }
  }

  const shelf = [...draft.shelfOrder, ...products.map((p) => p.slug).filter((slug) => !draft.shelfOrder.includes(slug))];
  const find = (slug: string) => products.find((p) => p.slug === slug);
  const hero = find(draft.heroSlug);

  return <section className="space-y-4" aria-labelledby="homepage-editor-title">
    <div className="space-y-2">
      <h2 id="homepage-editor-title" className="font-serif text-2xl">How your homepage is arranged</h2>
      <p className="max-w-3xl text-base text-muted-foreground">
        Choose the saree that welcomes visitors, the few pieces you want them to notice, and the order of everything
        on the page. Sarees you do not place here still appear further down, so nothing ever disappears from your website.
      </p>
    </div>

    <Card title="Welcome banner" hint="The big photo and words at the very top of your homepage.">
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr] sm:items-start">
        {hero && <Image src={hero.image} alt="" width={128} height={128} className="h-32 w-32 rounded-sm border object-cover" />}
        <label className="grid gap-2 text-base font-medium">
          Saree shown in the welcome banner
          <select className="min-h-11 w-full rounded-sm border bg-background p-2 text-base font-normal" value={draft.heroSlug}
            onChange={(e) => edit({ heroSlug: e.target.value, featuredSlugs: draft.featuredSlugs.filter((slug) => slug !== e.target.value) })}>
            {products.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}
          </select>
          <span className="text-sm font-normal text-muted-foreground">This saree cannot also be one of the four below — pick a different one for each.</span>
        </label>
      </div>
    </Card>

    <Card title="Sarees you are showing off" hint="Up to four pieces shown just under the welcome banner. Leave a slot empty to show fewer.">
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((index) => {
          const chosen = find(draft.featuredSlugs[index] ?? "");
          return <label key={index} className="grid gap-2 rounded-sm border p-3 text-base font-medium">
            <span>Position {index + 1}</span>
            <div className="flex items-center gap-3">
              {chosen
                ? <Image src={chosen.image} alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded-sm border object-cover" />
                : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-sm border border-dashed text-xs font-normal text-muted-foreground">Empty</span>}
              <select className="min-h-11 w-full min-w-0 rounded-sm border bg-background p-2 text-base font-normal"
                value={draft.featuredSlugs[index] ?? ""}
                onChange={(e) => { const selected = [...draft.featuredSlugs]; selected[index] = e.target.value; edit({ featuredSlugs: selected.filter(Boolean) }); }}>
                <option value="">Leave this one empty</option>
                {products.filter((p) => p.slug !== draft.heroSlug).map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}
              </select>
            </div>
          </label>;
        })}
      </div>
    </Card>

    <Card title="The order of the page" hint="This is the order visitors scroll through. Move a block up or down, or switch one off to hide it.">
      <ol className="space-y-2">
        {draft.sections.map((section, index) => {
          const help = SECTION_HELP[section.key] ?? { label: HOME_SECTIONS.find(([key]) => key === section.key)?.[1] ?? section.key, hint: "" };
          return <li key={section.key} className="rounded-sm border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm">{index + 1}</span>
              <span className="min-w-0 flex-1 text-base font-medium">{help.label}</span>
              <button type="button" disabled={index === 0} className="min-h-11 rounded-sm border px-3 text-base disabled:opacity-40"
                onClick={() => edit({ sections: move(draft.sections, index, -1) })}>Move up<span className="sr-only"> — {help.label}</span></button>
              <button type="button" disabled={index === draft.sections.length - 1} className="min-h-11 rounded-sm border px-3 text-base disabled:opacity-40"
                onClick={() => edit({ sections: move(draft.sections, index, 1) })}>Move down<span className="sr-only"> — {help.label}</span></button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{help.hint}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" role="switch" aria-checked={section.visible}
                onClick={() => edit({ sections: draft.sections.map((s) => s.key === section.key ? { ...s, visible: !s.visible } : s) })}
                className={`relative h-8 w-14 shrink-0 rounded-full border transition-colors ${section.visible ? "bg-primary" : "bg-muted"}`}>
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-card transition-all ${section.visible ? "left-8" : "left-1"}`} />
                <span className="sr-only">{section.visible ? "Showing on your website" : "Hidden from visitors"}</span>
              </button>
              <span className="text-base">{section.visible ? "Showing on your website" : "Hidden from visitors"}</span>
            </div>
          </li>;
        })}
      </ol>
    </Card>

    <Card title="Words on the homepage" hint="The headings and welcome text. Changes appear in the preview further down once you make them live.">
      <div className="grid gap-4">
        {TITLE_FIELDS.map(([key, label, hint]) => <label key={key} className="grid gap-2 text-base font-medium">
          {label}
          <textarea rows={key === "heroBody" ? 4 : 2} className="w-full rounded-sm border bg-background p-3 text-base font-normal"
            value={String(draft[key])} onChange={(e) => edit({ [key]: e.target.value } as Partial<HomepageContent>)} />
          <span className="text-sm font-normal text-muted-foreground">{hint} — {String(draft[key]).trim().length} characters so far.</span>
        </label>)}
      </div>
    </Card>

    <details className="rounded-sm border bg-card">
      <summary className="cursor-pointer p-4 text-lg font-medium">The order of the rest of your sarees</summary>
      <div className="space-y-3 border-t p-4">
        <p className="text-base text-muted-foreground">Every saree that is not in the welcome banner or the four above appears here, in this order.</p>
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {shelf.map((slug, index) => <div key={slug} className="flex flex-wrap items-center gap-3 border-b pb-2">
            {find(slug) && <Image src={find(slug)!.image} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-sm border object-cover" />}
            <span className="min-w-0 flex-1 text-base">{find(slug)?.title ?? slug}</span>
            <button type="button" disabled={index === 0} className="min-h-11 rounded-sm border px-3 text-base disabled:opacity-40"
              onClick={() => edit({ shelfOrder: move(shelf, index, -1) })}>Move up<span className="sr-only"> — {find(slug)?.title ?? slug}</span></button>
            <button type="button" disabled={index === shelf.length - 1} className="min-h-11 rounded-sm border px-3 text-base disabled:opacity-40"
              onClick={() => edit({ shelfOrder: move(shelf, index, 1) })}>Move down<span className="sr-only"> — {find(slug)?.title ?? slug}</span></button>
          </div>)}
        </div>
      </div>
    </details>

    <SaveBar state={state} message={message} unsaved={dirty} available={available} pageName="your homepage"
      onSaveDraft={() => write(savePageDraft, false)} onPublish={() => write(publishPageContent, true)}
      onUndo={() => { setDraft(published); setDirty(false); setState("idle"); setMessage("Your unsaved changes were thrown away. The homepage is back to what is on the website."); }} />
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={() => { setDraft(DEFAULT_HOMEPAGE); setDirty(true); setState("idle"); setMessage("This is the original arrangement. Nothing has changed on your website yet — choose “Make it live” if you want to keep it."); }}
        className="min-h-11 rounded-sm border px-4 text-base">Start again from the original arrangement</button>
    </div>
    <HistoryPanel versions={versions} busy={state === "busy"} available={available} onRestore={restore} />
  </section>;
}

function Card({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return <details open className="rounded-sm border bg-card">
    <summary className="cursor-pointer p-4 text-lg font-medium">{title}</summary>
    <div className="space-y-4 border-t p-4">
      <p className="text-base text-muted-foreground">{hint}</p>
      {children}
    </div>
  </details>;
}
