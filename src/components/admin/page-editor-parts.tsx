"use client";

import { useId, useRef, useState } from "react";
import Image from "next/image";
import type { ContentField } from "@/lib/page-content";

export type SaveState = "idle" | "busy" | "done" | "error";

/** One editable thing on the page: some words, a picture, or a show/hide switch. */
export function ContentFieldCard({ field, value, hint, busy, onChange, onReset, onError }: {
  field: ContentField;
  value: string | boolean | undefined;
  hint: string;
  busy: boolean;
  onChange: (value: string | boolean) => void;
  onReset: () => void;
  onError: (message: string) => void;
}) {
  const id = useId();
  const current = value ?? field.value;
  const changed = value !== undefined;
  const title = field.kind === "image"
    ? `Picture: ${field.label}`
    : field.label.startsWith("Image description:") ? field.label.replace("Image description:", "Description of the picture:") : field.label;

  return <div className="space-y-3 rounded-sm border bg-background p-4">
    <div className="flex flex-wrap items-baseline gap-2">
      <label className="text-base font-medium" htmlFor={id}>{trim(title)}</label>
      {changed && <span className="rounded-sm bg-secondary px-2 py-0.5 text-xs">Changed</span>}
    </div>

    {field.kind === "section"
      ? <VisibilitySwitch id={id} on={Boolean(current)} onChange={onChange} />
      : field.kind === "image"
        ? <ImagePicker id={id} src={String(current)} busy={busy} onChange={onChange} onError={onError} />
        : <>
          <textarea id={id} rows={String(field.value).length > 90 ? 4 : 2}
            className="w-full rounded-sm border bg-background p-3 text-base"
            value={String(current)} onChange={(e) => onChange(e.target.value)} />
          <p className="text-sm text-muted-foreground">{String(current).trim().length} characters</p>
        </>}

    <p className="text-sm text-muted-foreground">{hint}</p>
    {changed && <button type="button" className="min-h-11 text-sm underline" onClick={onReset}>
      Put the original back
    </button>}
  </div>;
}

function trim(text: string) {
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/** An unmistakable on/off switch that says, in words, what it is doing. */
function VisibilitySwitch({ id, on, onChange }: { id: string; on: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex flex-wrap items-center gap-3 rounded-sm border bg-card p-3">
    <button id={id} type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`relative h-8 w-14 shrink-0 rounded-full border transition-colors ${on ? "bg-primary" : "bg-muted"}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-card transition-all ${on ? "left-8" : "left-1"}`} />
      <span className="sr-only">{on ? "Visible on your website" : "Hidden from visitors"}</span>
    </button>
    <span className="text-base font-medium">
      {on ? "This part is showing on your website" : "This part is hidden from visitors"}
    </span>
    <button type="button" className="min-h-11 text-sm underline" onClick={() => onChange(!on)}>
      {on ? "Hide it" : "Show it"}
    </button>
  </div>;
}

/** Drag a photo in, or click to choose one. The thumbnail updates straight away. */
function ImagePicker({ id, src, busy, onChange, onError }: {
  id: string; src: string; busy: boolean;
  onChange: (value: string) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function upload(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return onError("That file is not a picture. Please choose a JPG or PNG photo.");
    setUploading(true);
    try {
      const signature = await fetch("/api/upload", { method: "POST" });
      if (!signature.ok) throw new Error("Could not get the website ready to receive the photo. Please try again.");
      const sig = await signature.json();
      const form = new FormData();
      form.append("file", file); form.append("api_key", sig.apiKey); form.append("timestamp", String(sig.timestamp));
      form.append("signature", sig.signature); form.append("folder", sig.folder);
      const response = await fetch(sig.uploadUrl, { method: "POST", body: form });
      if (!response.ok) throw new Error("The photo could not be uploaded. Please check your internet connection and try again.");
      const image = await response.json();
      onChange(image.secure_url);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The photo could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  return <div className="space-y-2">
    <button id={id} type="button" disabled={busy || uploading}
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files?.[0]); }}
      className={`flex w-full flex-wrap items-center gap-4 rounded-sm border-2 border-dashed p-3 text-left transition-colors disabled:opacity-60 ${over ? "border-primary bg-secondary" : ""}`}>
      <Image src={src} alt="" width={96} height={96} unoptimized className="h-24 w-24 shrink-0 rounded-sm border object-cover" />
      <span className="min-w-0 flex-1 text-base">
        <span className="block font-medium">{uploading ? "Uploading your photo…" : "Click to choose a photo"}</span>
        <span className="block text-sm text-muted-foreground">…or drag a photo from your computer and drop it here.</span>
      </span>
    </button>
    <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1}
      onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
  </div>;
}

/** Saving and publishing, told apart in plain words. */
export function SaveBar({ state, message, unsaved, available, pageName, onSaveDraft, onPublish, onUndo }: {
  state: SaveState; message: string; unsaved: boolean; available: boolean; pageName: string;
  onSaveDraft: () => void; onPublish: () => void; onUndo: () => void;
}) {
  const busy = state === "busy";
  return <div className="space-y-3 rounded-sm border bg-card p-4">
    <p className="text-base font-medium">
      {unsaved ? `You have changes to “${pageName}” that are not on the website yet.` : `“${pageName}” matches what is on the website.`}
    </p>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={!available || busy || !unsaved} onClick={onPublish}
        className="min-h-12 rounded-sm bg-primary px-5 text-base font-medium text-primary-foreground disabled:opacity-50">
        {busy ? "Working…" : "Make it live on the website"}
      </button>
      <button type="button" disabled={!available || busy || !unsaved} onClick={onSaveDraft}
        className="min-h-12 rounded-sm border px-5 text-base disabled:opacity-50">
        Save for later, don’t publish yet
      </button>
      <button type="button" disabled={busy || !unsaved} onClick={onUndo}
        className="min-h-12 rounded-sm border px-5 text-base disabled:opacity-50">
        Undo my changes
      </button>
    </div>
    <ul className="space-y-1 text-sm text-muted-foreground">
      <li><strong>Make it live</strong> — everyone visiting your website sees these changes straight away.</li>
      <li><strong>Save for later</strong> — keeps your work so you can come back to it. Visitors still see the old wording.</li>
      <li><strong>Undo my changes</strong> — throws away what you have changed since your last save.</li>
    </ul>
    {message && <p role="status" className={`rounded-sm border p-3 text-base ${state === "error" ? "border-destructive" : ""}`}>{message}</p>}
  </div>;
}

/** The safety net: put any recent published version back. */
export function HistoryPanel({ versions, busy, available, onRestore }: {
  versions: { id: string; created_at: string }[];
  busy: boolean; available: boolean;
  onRestore: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState("");
  return <details className="rounded-sm border bg-card">
    <summary className="cursor-pointer p-4 text-lg font-medium">Go back to an earlier version</summary>
    <div className="space-y-3 border-t p-4">
      <p className="text-base text-muted-foreground">
        Every time you make something live, the previous version of this page is kept here. If a change was a mistake,
        pick the version from before it and put it back. Nothing is lost — the version you are replacing is saved here too.
      </p>
      {versions.length === 0
        ? <p className="text-base">No earlier versions yet. One will be saved here the first time you make a change live.</p>
        : <ul className="space-y-2">
          {versions.map((version) => <li key={version.id} className="flex flex-wrap items-center gap-3 border-b pb-2">
            <span className="flex-1 text-base">Version from {formatWhen(version.created_at)}</span>
            {confirming === version.id
              ? <>
                <span className="text-base">Put this version back on the website?</span>
                <button type="button" disabled={busy} onClick={() => { setConfirming(""); onRestore(version.id); }}
                  className="min-h-11 rounded-sm bg-primary px-4 text-base text-primary-foreground disabled:opacity-50">Yes, put it back</button>
                <button type="button" onClick={() => setConfirming("")} className="min-h-11 rounded-sm border px-4 text-base">No, keep things as they are</button>
              </>
              : <button type="button" disabled={busy || !available} onClick={() => setConfirming(version.id)}
                className="min-h-11 rounded-sm border px-4 text-base disabled:opacity-50">Put this version back</button>}
          </li>)}
        </ul>}
    </div>
  </details>;
}

function formatWhen(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
