"use client";

/**
 * "Split photos into colour variants" for products that already exist — the
 * mixed-colour WhatsApp batch that landed as one "Default" variant.
 *
 * Same fail-closed shape as the import pipeline's colour-variant step: the AI
 * only ever produces a plan, the admin sees exactly which photo goes where, and
 * a separate explicit action writes it (see applyColorSplit). Nothing is
 * uploaded or deleted — the photos are only reassigned between variants.
 */

import Image from "next/image";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cld } from "@/lib/cloudinary";
import {
  applyColorSplit,
  listColorSplitCandidates,
  previewColorSplit,
  type ColorSplitCandidate,
} from "@/app/admin/enrichment-actions";
import type { ColorSplitPlan } from "@/lib/enrichment/color-split";
import { MAX_COLOR_SPLIT_BATCH } from "@/lib/validation";

type Phase = "idle" | "candidates" | "preview";

export function ColorSplitPanel() {
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<Phase>("idle");
  const [candidates, setCandidates] = useState<ColorSplitCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [plans, setPlans] = useState<ColorSplitPlan[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function fail(error: string) {
    setIsError(true);
    setMessage(error);
  }

  function reset() {
    setPhase("idle");
    setMessage(null);
    setIsError(false);
    setPlans([]);
    setCandidates([]);
  }

  function onOpen() {
    setMessage(null);
    setIsError(false);
    startTransition(async () => {
      const result = await listColorSplitCandidates();
      if (!result.ok) return fail(result.error);
      setCandidates(result.candidates);
      setSelected(new Set(result.candidates.slice(0, MAX_COLOR_SPLIT_BATCH).map((c) => c.id)));
      setPhase("candidates");
      if (result.candidates.length === 0) {
        setMessage("No single-variant products with enough photos to split.");
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
    const ids = Array.from(selected).slice(0, MAX_COLOR_SPLIT_BATCH);
    if (ids.length === 0) return fail("Pick at least one product.");
    startTransition(async () => {
      const result = await previewColorSplit({ product_ids: ids });
      if (!result.ok) return fail(result.error);
      if (!result.ai_available) {
        return fail("AI isn't configured, so photos can't be sorted into colourways automatically.");
      }
      setPlans(result.plans);
      setApproved(new Set(result.plans.map((p) => p.product_id)));
      setPhase("preview");
      if (result.plans.length === 0) {
        setMessage("These all look like a single colourway — nothing to split.");
      } else if (result.skipped.length > 0) {
        setMessage(`Left alone (one colourway, or not enough to go on): ${result.skipped.join(", ")}.`);
      }
    });
  }

  function onApply() {
    setMessage(null);
    setIsError(false);
    const toApply = plans.filter((p) => approved.has(p.product_id));
    if (toApply.length === 0) return fail("Tick at least one product to split.");
    startTransition(async () => {
      const result = await applyColorSplit({
        plans: toApply.map((p) => ({
          product_id: p.product_id,
          base_variant_id: p.base_variant_id,
          groups: p.groups.map((g) => ({
            color: g.color,
            color_hex: g.color_hex,
            image_ids: g.image_ids,
          })),
        })),
      });
      if (!result.ok) return fail(result.error);
      setIsError(false);
      setMessage(
        `Split ${result.split} product${result.split === 1 ? "" : "s"} into colour variants` +
          (result.skipped > 0 ? `, ${result.skipped} skipped (photos changed since the preview).` : ".") +
          " Open a product to rename a colourway or drag a photo to another one.",
      );
      setPhase("idle");
      setPlans([]);
      setCandidates([]);
    });
  }

  if (phase === "idle" && !message) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={onOpen} disabled={pending}>
        {pending ? "Checking…" : "Split photos into colour variants"}
      </Button>
    );
  }

  return (
    <div className="w-full rounded-sm border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-lg text-primary">Split photos into colour variants</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            For products where several colourways of the same design arrived as one variant. Suggests which photo
            belongs to which colour, then splits them when you confirm. No photo is uploaded or deleted — anything it
            can&apos;t place stays with the first colourway.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={pending}>
          Close
        </Button>
      </div>

      {message && (
        <p className={`mb-3 text-xs ${isError ? "text-destructive" : "text-muted-foreground"}`}>{message}</p>
      )}

      {phase === "candidates" && candidates.length > 0 && (
        <>
          <div className="max-h-72 overflow-y-auto rounded-sm border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="w-8 p-2"></th>
                  <th className="p-2">Product</th>
                  <th className="p-2">Current variant</th>
                  <th className="p-2">Photos</th>
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
                    <td className="p-2 text-muted-foreground">{c.variant_color}</td>
                    <td className="p-2 text-muted-foreground">{c.photo_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <Button type="button" size="sm" onClick={onPreview} disabled={pending}>
              {pending ? "Looking at the photos…" : `Suggest a split (${Math.min(selected.size, MAX_COLOR_SPLIT_BATCH)})`}
            </Button>
            <span className="text-xs text-muted-foreground">
              {candidates.length} product{candidates.length === 1 ? "" : "s"} could be split. Up to{" "}
              {MAX_COLOR_SPLIT_BATCH} per run.
            </span>
          </div>
        </>
      )}

      {phase === "preview" && (
        <>
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {plans.map((plan) => (
              <div key={plan.product_id} className="rounded-sm border border-border p-3">
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={approved.has(plan.product_id)}
                    onChange={() => toggle(approved, plan.product_id, setApproved)}
                  />
                  <span>
                    <span className="font-medium">{plan.product_name}</span>
                    {plan.summary.map((line, i) => (
                      <span key={i} className="block text-muted-foreground">
                        {line}
                      </span>
                    ))}
                  </span>
                </label>
                <div className="mt-3 flex flex-wrap gap-4">
                  {plan.groups.map((group, i) => (
                    <div key={`${group.color}-${i}`}>
                      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-primary">
                        {group.color_hex && (
                          <span
                            aria-hidden="true"
                            className="inline-block h-3 w-3 rounded-sm border border-border"
                            style={{ backgroundColor: group.color_hex }}
                          />
                        )}
                        {group.color}
                        {i === 0 && <span className="text-muted-foreground"> · shown first</span>}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {group.image_ids.map((id) => {
                          const url = plan.image_urls_by_id[id];
                          return (
                            <div
                              key={id}
                              className="relative h-14 w-11 overflow-hidden rounded-sm border border-border bg-secondary"
                            >
                              {url && (
                                <Image
                                  src={cld(url, "thumbnail")}
                                  alt={group.color}
                                  fill
                                  sizes="44px"
                                  className="object-cover"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <Button type="button" size="sm" onClick={onApply} disabled={pending || plans.length === 0}>
              {pending ? "Splitting…" : `Split ${approved.size} product${approved.size === 1 ? "" : "s"}`}
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
