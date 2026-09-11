"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  EDITABLE_PAGES, REGION_LABELS, fieldHint, regionLabel, regionOf,
  type ContentField, type PageContentMap, type PageOverrides,
} from "@/lib/page-content";
import { publishPageContent, restorePageVersion, savePageDraft } from "@/app/admin/page-content-actions";
import { ContentFieldCard, HistoryPanel, SaveBar, type SaveState } from "@/components/admin/page-editor-parts";

const REGION_ORDER = Object.keys(REGION_LABELS);
const FILTERS = [["all", "Everything"], ["text", "Just words"], ["image", "Just pictures"], ["section", "Show or hide parts"]] as const;

export function PageContentEditor({ initial, drafts, versions, available }: {
  initial: PageContentMap;
  drafts: PageContentMap;
  versions: Record<string, { id: string; created_at: string }[]>;
  available: boolean;
}) {
  const [page, setPage] = useState("/");
  const [draft, setDraft] = useState<PageContentMap>(() => ({ ...initial, ...drafts }));
  const [published, setPublished] = useState(initial);
  const [regions, setRegions] = useState<Record<string, ContentField[]>>({});
  const [filter, setFilter] = useState("");
  const [only, setOnly] = useState<(typeof FILTERS)[number][0]>("all");
  // A draft saved on an earlier visit is already "not on the website yet".
  const [dirty, setDirty] = useState<string[]>(() =>
    Object.keys(drafts).filter((scope) => JSON.stringify(drafts[scope]) !== JSON.stringify(initial[scope] ?? {})));
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const frame = useRef<HTMLIFrameElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function preview(content: PageContentMap) {
    frame.current?.contentWindow?.postMessage({ type: "content-preview", content }, location.origin);
  }
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "content-ready") preview(draftRef.current);
      if (event.data?.type === "content-fields" && Array.isArray(event.data.fields)) {
        const { region, scope, fields } = event.data;
        setRegions((old) => ({ ...old, [`${scope}:${region}`]: fields }));
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => { preview(draft); }, [draft]);

  // Fields arrive per rendered region; group them into the cards a person recognises.
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = Object.values(regions).flat().filter((field) =>
      (field.scope === page || field.scope === "global")
      && (only === "all" || field.kind === only)
      && (!needle || `${field.label} ${String(field.value)}`.toLowerCase().includes(needle)));
    const byRegion = new Map<string, ContentField[]>();
    for (const field of matching) {
      const id = `${field.scope}:${regionOf(field.key)}`;
      byRegion.set(id, [...(byRegion.get(id) ?? []), field]);
    }
    const rank = (region: string) => {
      const index = REGION_ORDER.indexOf(region);
      return index === -1 ? REGION_ORDER.length : index;
    };
    return [...byRegion.entries()].sort(([a], [b]) => {
      const [scopeA, regionA] = a.split(":");
      const [scopeB, regionB] = b.split(":");
      if (scopeA !== scopeB) return scopeA === "global" ? 1 : -1;
      return rank(regionA) - rank(regionB);
    });
  }, [regions, page, only, filter]);

  const pageName = EDITABLE_PAGES.find(([path]) => path === page)?.[1] ?? page;
  const unsaved = dirty.length > 0;

  function change(field: ContentField, value: string | boolean) {
    setDraft((old) => ({ ...old, [field.scope]: { ...old[field.scope], [field.key]: { kind: field.kind, value } as PageOverrides[string] } }));
    setDirty((old) => [...new Set([...old, field.scope])]);
    setState("idle");
    setMessage("");
  }
  function reset(field: ContentField) {
    setDraft((old) => { const values = { ...old[field.scope] }; delete values[field.key]; return { ...old, [field.scope]: values }; });
    setDirty((old) => [...new Set([...old, field.scope])]);
    setState("idle");
  }
  async function write(action: typeof savePageDraft, live: boolean) {
    setState("busy"); setMessage("");
    try {
      for (const scope of dirty) {
        const result = await action(scope, draft[scope] ?? {});
        if (!result.ok) throw new Error(result.error);
        if (live) setPublished((old) => ({ ...old, [scope]: draft[scope] ?? {} }));
        setDirty((old) => old.filter((value) => value !== scope));
      }
      setState("done");
      setMessage(live
        ? "Done — your changes are on the website now. Open the real page in a new tab to see them."
        : "Saved for later. Only you can see these changes; visitors still see the previous version.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not save. Please try again.");
    }
  }
  async function restore(versionId: string) {
    setState("busy"); setMessage("");
    try {
      const result = await restorePageVersion(page, versionId);
      if (!result.ok) throw new Error(result.error);
      const content = (result as { content?: PageOverrides }).content ?? {};
      setDraft((old) => ({ ...old, [page]: content }));
      setPublished((old) => ({ ...old, [page]: content }));
      setDirty((old) => old.filter((scope) => scope !== page));
      setState("done");
      setMessage("That earlier version is back on the website.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not go back to that version.");
    }
  }
  function undo() {
    setDraft((old) => ({ ...old, ...Object.fromEntries(dirty.map((scope) => [scope, published[scope] ?? {}])) }));
    setDirty([]);
    setState("idle");
    setMessage("Your unsaved changes were thrown away. This page is back to what is on the website.");
  }

  return <section className="mt-12 space-y-5 pb-24 xl:pb-0" aria-labelledby="page-editor-title">
    <div className="space-y-2">
      <h2 id="page-editor-title" className="font-serif text-2xl">Change the words and pictures on a page</h2>
      <p className="max-w-3xl text-base text-muted-foreground">
        Pick a page, then change anything you like. The preview beside the form shows the page exactly as visitors
        will see it, updating as you type. Nothing reaches the website until you choose <strong>Make it live</strong>,
        and you can always put an earlier version back.
      </p>
    </div>
    {!available && <p role="alert" className="rounded-sm border border-destructive p-4 text-base">
      Saving is switched off until the website database is set up (migrations 017 and 018). You can still look around
      and try changes here safely — nothing will be kept, and the website is not affected.
    </p>}

    <div className="flex flex-wrap items-end gap-4 rounded-sm border bg-card p-4">
      <label className="grid min-w-0 flex-1 gap-2 text-base font-medium" htmlFor="page-picker">
        Which page do you want to change?
        <select id="page-picker" className="min-h-11 w-full max-w-md rounded-sm border bg-background p-2 text-base font-normal"
          value={page} onChange={(e) => { setPage(e.target.value); setRegions({}); setState("idle"); setMessage(""); }}>
          {EDITABLE_PAGES.map(([path, label]) => <option key={path} value={path}>{label}</option>)}
        </select>
      </label>
      <a href={page} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-base underline">
        See the real page in a new tab ↗
      </a>
    </div>

    <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
      <div className={`min-w-0 space-y-4 ${view === "preview" ? "hidden xl:block" : ""}`}>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([value, label]) =>
            <button key={value} type="button" onClick={() => setOnly(value)} aria-pressed={only === value}
              className={`min-h-11 rounded-sm border px-4 text-base ${only === value ? "bg-primary text-primary-foreground" : "bg-background"}`}>
              {label}
            </button>)}
        </div>
        <input aria-label="Search this page for the words you want to change" placeholder="Search for the words you want to change…"
          className="min-h-11 w-full rounded-sm border bg-background px-3 text-base"
          value={filter} onChange={(e) => setFilter(e.target.value)} />

        {page === "/" && (only === "all" || only === "section") &&
          <p className="rounded-sm border bg-secondary/40 p-4 text-base">
            To show, hide or reorder the big blocks on the homepage, use <strong>How your homepage is arranged</strong> higher up this screen.
          </p>}
        {groups.length === 0 && <p className="rounded-sm border border-dashed p-6 text-base text-muted-foreground">
          Nothing to show yet. The preview is still loading, or nothing here matches your search. Parts that only appear
          sometimes — like the enquiry list panel — become editable once they show up in the preview.
        </p>}

        {groups.map(([id, fields]) => {
          const [scope, region] = id.split(":");
          const { label, hint } = regionLabel(region);
          return <details key={id} open={open[id] ?? groups.length <= 2}
            onToggle={(e) => setOpen((old) => ({ ...old, [id]: e.currentTarget.open }))}
            className="rounded-sm border bg-card">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-4 text-lg font-medium">
              <span>{label}</span>
              {scope === "global" && <span className="rounded-sm bg-secondary px-2 py-1 text-xs font-normal">Appears on every page</span>}
              <span className="ml-auto text-sm font-normal text-muted-foreground">
                {fields.length} {fields.length === 1 ? "thing" : "things"} you can change
              </span>
            </summary>
            <div className="space-y-4 border-t p-4">
              <p className="text-base text-muted-foreground">{hint}</p>
              {fields.map((field) => <ContentFieldCard key={`${field.scope}:${field.key}`} field={field}
                value={draft[field.scope]?.[field.key]?.value}
                hint={fieldHint(field)} busy={state === "busy"}
                onChange={(value) => change(field, value)} onReset={() => reset(field)}
                onError={(text) => { setState("error"); setMessage(text); }} />)}
            </div>
          </details>;
        })}
      </div>

      <div className={`min-w-0 ${view === "edit" ? "hidden xl:block" : ""} xl:sticky xl:top-4`}>
        <p className="mb-2 text-base font-medium">Preview — how “{pageName}” looks with your changes</p>
        <iframe ref={frame} title="Live preview of the page you are editing" src={`${page}?contentEditor=1`}
          className="h-[60vh] w-full rounded-sm border bg-background xl:h-[78vh]" />
        <p className="mt-2 text-sm text-muted-foreground">This updates as you type, and includes changes you have not made live yet.</p>
      </div>
    </div>

    <SaveBar state={state} message={message} unsaved={unsaved} available={available} pageName={pageName}
      onSaveDraft={() => write(savePageDraft, false)} onPublish={() => write(publishPageContent, true)} onUndo={undo} />
    <HistoryPanel versions={versions[page] ?? []} busy={state === "busy"} available={available} onRestore={restore} />

    <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t bg-card p-2 shadow-lg xl:hidden" role="tablist"
      aria-label="Switch between making changes and the preview">
      <button type="button" role="tab" aria-selected={view === "edit"} onClick={() => setView("edit")}
        className={`min-h-12 flex-1 rounded-sm border text-base ${view === "edit" ? "bg-primary text-primary-foreground" : ""}`}>Make changes</button>
      <button type="button" role="tab" aria-selected={view === "preview"} onClick={() => setView("preview")}
        className={`min-h-12 flex-1 rounded-sm border text-base ${view === "preview" ? "bg-primary text-primary-foreground" : ""}`}>See preview</button>
    </div>
  </section>;
}
