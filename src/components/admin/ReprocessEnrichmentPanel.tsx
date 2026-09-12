"use client";

/**
 * "Re-run AI naming & tagging" for products that already exist. Preview first,
 * apply only what the admin ticks — and never anything to do with images: this
 * panel can only change name, fabric, highlights, category and collection tags
 * (see src/app/admin/enrichment-actions.ts).
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  applyProductEnrichment,
  listEnrichmentCandidates,
  previewProductEnrichment,
  type EnrichmentCandidate,
} from "@/app/admin/enrichment-actions";
import type { EnrichmentProposal } from "@/lib/enrichment/reprocess";
import { MAX_ENRICHMENT_BATCH } from "@/lib/validation";

type Phase = "idle" | "candidates" | "preview";

export function ReprocessEnrichmentPanel() {
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<Phase>("idle");
  const [candidates, setCandidates] = useState<EnrichmentCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [proposals, setProposals] = useState<EnrichmentProposal[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [renameAll, setRenameAll] = useState(false);
  const [replaceHighlights, setReplaceHighlights] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function fail(error: string) {
    setIsError(true);
    setMessage(error);
  }

  function onOpen() {
    setMessage(null);
    setIsError(false);
    startTransition(async () => {
      const result = await listEnrichmentCandidates();
      if (!result.ok) return fail(result.error);
      setCandidates(result.candidates);
      setSelected(new Set(result.candidates.slice(0, MAX_ENRICHMENT_BATCH).map((c) => c.id)));
      setPhase("candidates");
      if (result.candidates.length === 0) {
        setMessage("Every product already follows the naming convention and has a category, fabric and highlights.");
      }
    });
  }

  function toggle(set: Set<string>, id: string, setter: (next: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  function onPreview() {
    setMessage(null);
    setIsError(false);
    const ids = Array.from(selected).slice(0, MAX_ENRICHMENT_BATCH);
    if (ids.length === 0) return fail("Pick at least one product.");
    startTransition(async () => {
      const result = await previewProductEnrichment({
        product_ids: ids,
        rename_all: renameAll,
        replace_highlights: replaceHighlights,
      });
      if (!result.ok) return fail(result.error);
      setProposals(result.proposals);
      setApproved(new Set(result.proposals.filter((p) => !p.unchanged).map((p) => p.product_id)));
      setPhase("preview");
      if (!result.ai_available) {
        setMessage("AI isn't configured, so this is a name-tidy only — no new category, fabric or collection tags.");
      } else if (result.proposals.every((p) => p.unchanged)) {
        setMessage("Nothing to change — these products already meet the standard.");
      }
    });
  }

  function onApply() {
    setMessage(null);
    setIsError(false);
    const toApply = proposals.filter((p) => approved.has(p.product_id) && !p.unchanged);
    if (toApply.length === 0) return fail("Tick at least one product to update.");
    startTransition(async () => {
      const result = await applyProductEnrichment({
        proposals: toApply.map((p) => ({
          product_id: p.product_id,
          name: p.name,
          fabric_type: p.fabric_type,
          highlights: p.highlights,
          category_id: p.category_id,
          add_collection_ids: p.add_collection_ids,
        })),
      });
      if (!result.ok) return fail(result.error);
      setIsError(false);
      setMessage(
        `Updated ${result.updated} product${result.updated === 1 ? "" : "s"}` +
          (result.skipped > 0 ? `, ${result.skipped} skipped (nothing left to change).` : ".") +
          " Photos, prices and links were left untouched.",
      );
      setPhase("idle");
      setProposals([]);
      setCandidates([]);
    });
  }

  if (phase === "idle" && !message) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={onOpen} disabled={pending}>
        {pending ? "Checking…" : "Re-run AI naming & tagging"}
      </Button>
    );
  }

  return (
    <div className="w-full rounded-sm border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-lg text-primary">Re-run AI naming &amp; tagging</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Brings older products up to the current naming convention and fills in any missing category, fabric,
            highlights or collection tags. Never changes photos, prices, status or the product&apos;s web address.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setPhase("idle");
            setMessage(null);
            setProposals([]);
            setCandidates([]);
          }}
          disabled={pending}
        >
          Close
        </Button>
      </div>

      {message && (
        <p className={`mb-3 text-xs ${isError ? "text-destructive" : "text-muted-foreground"}`}>{message}</p>
      )}

      {phase === "candidates" && candidates.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={renameAll} onChange={(e) => setRenameAll(e.target.checked)} />
              Also re-style names that already follow the convention
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={replaceHighlights}
                onChange={(e) => setReplaceHighlights(e.target.checked)}
              />
              Replace existing highlights (otherwise only empty ones are filled)
            </label>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-sm border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="w-8 p-2"></th>
                  <th className="p-2">Product</th>
                  <th className="p-2">Name style</th>
                  <th className="p-2">Missing</th>
                  <th className="p-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(selected, c.id, setSelected)}
                      />
                    </td>
                    <td className="p-2">{c.name}</td>
                    <td className="p-2">{c.follows_convention ? "OK" : "Off-convention"}</td>
                    <td className="p-2 text-muted-foreground">{c.missing.join(", ") || "—"}</td>
                    <td className="p-2 text-muted-foreground">
                      {/* A file-synced row's saved name overlays the live storefront
                          catalogue, so renaming one changes the public page's title. */}
                      {c.source === "file_sync" ? "Live storefront" : "Admin"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <Button type="button" size="sm" onClick={onPreview} disabled={pending}>
              {pending ? "Running…" : `Preview changes (${Math.min(selected.size, MAX_ENRICHMENT_BATCH)})`}
            </Button>
            <span className="text-xs text-muted-foreground">
              {candidates.length} product{candidates.length === 1 ? "" : "s"} could be improved. Up to{" "}
              {MAX_ENRICHMENT_BATCH} per run.
            </span>
          </div>
        </>
      )}

      {phase === "preview" && (
        <>
          <div className="max-h-72 overflow-y-auto rounded-sm border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="w-8 p-2"></th>
                  <th className="p-2">Current name</th>
                  <th className="p-2">Proposed changes</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.product_id} className="border-t border-border align-top">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        disabled={p.unchanged}
                        checked={approved.has(p.product_id)}
                        onChange={() => toggle(approved, p.product_id, setApproved)}
                      />
                    </td>
                    <td className="p-2">{p.current_name}</td>
                    <td className="p-2">
                      {p.unchanged ? (
                        <span className="text-muted-foreground">No change needed</span>
                      ) : (
                        <ul className="space-y-1">
                          {p.changes.map((change, i) => (
                            <li key={i}>{change}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <Button type="button" size="sm" onClick={onApply} disabled={pending}>
              {pending ? "Applying…" : `Apply to ${approved.size} product${approved.size === 1 ? "" : "s"}`}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPhase("candidates")} disabled={pending}>
              Back
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
