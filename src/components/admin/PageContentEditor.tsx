"use client";

import { useEffect, useRef, useState } from "react";
import { EDITABLE_PAGES, type ContentField, type PageContentMap, type PageOverrides } from "@/lib/page-content";
import { savePageContent } from "@/app/admin/page-content-actions";

export function PageContentEditor({ initial, available }: { initial: PageContentMap; available: boolean }) {
  const [page, setPage] = useState("/");
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [regions, setRegions] = useState<Record<string, ContentField[]>>({});
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState("text");
  const [dirty, setDirty] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
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
  const fields = Object.values(regions).flat().filter((field) => (field.scope === page || field.scope === "global") && field.kind === kind && `${field.label} ${field.key}`.toLowerCase().includes(filter.toLowerCase()));
  function change(field: ContentField, value: string | boolean) {
    setDraft((old) => ({ ...old, [field.scope]: { ...old[field.scope], [field.key]: { kind: field.kind, value } as PageOverrides[string] } }));
    setDirty((old) => [...new Set([...old, field.scope])]);
    setMessage("Unsaved changes — the preview shows your edits.");
  }
  function reset(field: ContentField) {
    setDraft((old) => { const values = { ...old[field.scope] }; delete values[field.key]; return { ...old, [field.scope]: values }; });
    setDirty((old) => [...new Set([...old, field.scope])]);
  }
  async function save() {
    setBusy(true); setMessage("");
    try {
      for (const scope of dirty) {
        const result = await savePageContent(scope, draft[scope] ?? {});
        if (!result.ok) throw new Error(result.error);
        setSaved((old) => ({ ...old, [scope]: draft[scope] ?? {} }));
        setDirty((old) => old.filter((value) => value !== scope));
      }
      setMessage("Saved. Your changes are now published.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save"); }
    finally { setBusy(false); }
  }
  async function upload(field: ContentField, file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const signature = await fetch("/api/upload", { method: "POST" });
      if (!signature.ok) throw new Error("Could not prepare upload");
      const sig = await signature.json();
      const form = new FormData();
      form.append("file", file); form.append("api_key", sig.apiKey); form.append("timestamp", String(sig.timestamp));
      form.append("signature", sig.signature); form.append("folder", sig.folder);
      const response = await fetch(sig.uploadUrl, { method: "POST", body: form });
      if (!response.ok) throw new Error("Image upload failed");
      const image = await response.json();
      change(field, image.secure_url);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed"); }
    finally { setBusy(false); }
  }
  return <section className="mt-10 space-y-5" aria-labelledby="page-editor-title">
    <h2 id="page-editor-title" className="font-serif text-2xl">Edit a public page</h2>
    <p className="max-w-3xl text-base text-muted-foreground">Choose a page, edit its text or images, and check the preview. Header and footer edits apply across the site. Product photographs and details can also be managed in Products. Save publishes your changes.</p>
    {!available && <p role="alert" className="rounded-sm border border-destructive p-4">Page saving is not ready: apply database migration 017. You can explore and preview edits below.</p>}
    <div className="flex flex-wrap items-end gap-4">
      <label className="grid gap-2">Page<select className="min-h-11 max-w-full border bg-background p-2" value={page} onChange={(e) => { setPage(e.target.value); setRegions({}); }}>
        {EDITABLE_PAGES.map(([path, label]) => <option key={path} value={path}>{label}</option>)}
      </select></label>
      <button type="button" disabled={!available || busy || !dirty.length} onClick={save} className="min-h-11 bg-primary px-5 py-2 font-medium text-primary-foreground disabled:opacity-50">{busy ? "Working…" : "Save and publish"}</button>
      <button type="button" disabled={busy} onClick={() => { setDraft(saved); setDirty([]); setMessage("Unsaved edits discarded."); }} className="min-h-11 border px-4">Discard unsaved edits</button>
      <a href={page} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline">Open live page ↗</a>
    </div>
    <p role="status" className="text-base">{message}</p>
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap gap-3">
          <label className="sr-only" htmlFor="content-kind">Content type</label>
          <select id="content-kind" className="min-h-11 border bg-background p-2" value={kind} onChange={(e) => setKind(e.target.value)}><option value="text">Text</option><option value="image">Images</option><option value="section">Sections</option></select>
          <input aria-label="Find content" placeholder="Find text or an image…" className="min-h-11 min-w-0 flex-1 border bg-background px-3" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-2">
          {page === "/" && kind === "section" && <p>Use “Homepage layout and product placement” above to show, hide or reorder homepage sections. This keeps the shelf complete when featured sections are hidden.</p>}
          {fields.length === 0 && <p className="text-muted-foreground">No matching fields. Wait for the preview to load, or choose another content type. Conditional content appears when shown in the preview.</p>}
          {fields.map((field) => <div key={`${field.scope}:${field.key}`} className="space-y-2 rounded-sm border bg-card p-4">
            <label className="block text-sm font-medium" htmlFor={field.key}>{field.label.slice(0, 140)} {field.scope === "global" && <span className="text-muted-foreground">(sitewide)</span>}</label>
            {field.kind === "section" ? <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={Boolean(draft[field.scope]?.[field.key]?.value ?? field.value)} onChange={(e) => change(field, e.target.checked)} />Show this section</label>
              : <textarea id={field.key} rows={field.kind === "image" ? 2 : 3} className="w-full border bg-background p-3 text-base" value={String(draft[field.scope]?.[field.key]?.value ?? field.value)} onChange={(e) => change(field, e.target.value)} />}
            {field.kind === "image" && <label className="block">Upload replacement<input type="file" accept="image/*" disabled={busy} className="mt-2 block max-w-full text-sm" onChange={(e) => upload(field, e.target.files?.[0])} /></label>}
            <button type="button" className="min-h-11 text-sm underline" onClick={() => reset(field)}>Restore original</button>
          </div>)}
        </div>
      </div>
      <iframe ref={frame} title="Page editing preview" src={`${page}?contentEditor=1`} className="h-[75vh] w-full rounded-sm border bg-background" />
    </div>
  </section>;
}
