"use client";

/**
 * "Normalise codes & web addresses" — deliberately a separate tool from
 * "Re-run AI naming & tagging". That one only rewrites copy; this one can move
 * a product's address, so it is opt-in, previewed, and renumbering the code is
 * ticked by default while changing the address is not.
 *
 * Only products authored in admin are offered (see
 * src/lib/enrichment/identifiers.ts) — a mirrored storefront row's slug is the
 * key its live photos and copy are matched on and must not move.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  applyProductIdentifiers,
  listIdentifierCandidates,
  previewProductIdentifiers,
  type IdentifierCandidate,
} from "@/app/admin/enrichment-actions";
import type { IdentifierProposal } from "@/lib/enrichment/identifiers";
import { MAX_ENRICHMENT_BATCH } from "@/lib/validation";

type Phase = "idle" | "candidates" | "preview";

export function IdentifierNormalizePanel() {
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<Phase>("idle");
  const [candidates, setCandidates] = useState<IdentifierCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [proposals, setProposals] = useState<IdentifierProposal[]>([]);
  const [normalizeCodes, setNormalizeCodes] = useState(true);
  const [normalizeSlugs, setNormalizeSlugs] = useState(false);
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
    setProposals([]);
    setCandidates([]);
  }

  function onOpen() {
    setMessage(null);
    setIsError(false);
    startTransition(async () => {
      const result = await listIdentifierCandidates();
      if (!result.ok) return fail(result.error);
      setCandidates(result.candidates);
      setSelected(new Set(result.candidates.slice(0, MAX_ENRICHMENT_BATCH).map((c) => c.id)));
      setPhase("candidates");
      if (result.candidates.length === 0) {
        setMessage("Every product already has a code in the house format and an address that matches its name.");
      }
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectedIds() {
    return Array.from(selected).slice(0, MAX_ENRICHMENT_BATCH);
  }

  function onPreview() {
    setMessage(null);
    setIsError(false);
    if (!normalizeCodes && !normalizeSlugs) return fail("Pick at least one of code or web address.");
    const ids = selectedIds();
    if (ids.length === 0) return fail("Pick at least one product.");
    startTransition(async () => {
      const result = await previewProductIdentifiers({
        product_ids: ids,
        normalize_codes: normalizeCodes,
        normalize_slugs: normalizeSlugs,
      });
      if (!result.ok) return fail(result.error);
      setProposals(result.proposals);
      setPhase("preview");
      if (result.proposals.every((p) => p.unchanged)) {
        setMessage("Nothing to change for those products.");
      }
    });
  }

  function onApply() {
    setMessage(null);
    setIsError(false);
    const ids = proposals.filter((p) => !p.unchanged).map((p) => p.product_id);
    if (ids.length === 0) return fail("Nothing to apply.");
    startTransition(async () => {
      // Sends ids, not values: the server re-plans so the browser can't choose
      // what a product's code or address becomes.
      const result = await applyProductIdentifiers({
        product_ids: ids,
        normalize_codes: normalizeCodes,
        normalize_slugs: normalizeSlugs,
      });
      if (!result.ok) return fail(result.error);
      setIsError(false);
      setMessage(
        `Updated ${result.updated} product${result.updated === 1 ? "" : "s"}` +
          (result.moved.length > 0 ? `, ${result.moved.length} web address(es) moved.` : ".") +
          " Photos, prices, names and tags were left untouched.",
      );
      setPhase("idle");
      setProposals([]);
      setCandidates([]);
    });
  }

  if (phase === "idle" && !message) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={onOpen} disabled={pending}>
        {pending ? "Checking…" : "Normalise codes & web addresses"}
      </Button>
    );
  }

  return (
    <div className="w-full rounded-sm border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-lg text-primary">Normalise codes &amp; web addresses</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Gives every product a code in the house format (WCS-001, WCS-002…) and, if you ask for it, an address
            derived from its name. Only products created in this panel are listed — the ones synced from the live
            storefront keep their address, because that is how their photos are matched to the public page.
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
          <div className="mb-3 flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={normalizeCodes} onChange={(e) => setNormalizeCodes(e.target.checked)} />
              Give products a house-format code
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={normalizeSlugs} onChange={(e) => setNormalizeSlugs(e.target.checked)} />
              Also shorten the web address to match the name
            </label>
          </div>
          {normalizeSlugs && (
            <p className="mb-3 rounded-sm border border-[#B8860B]/40 bg-[#B8860B]/10 p-2 text-xs text-primary">
              Changing a web address changes where that product lives. Any link you have already shared to the old
              address will stop working.
            </p>
          )}

          <div className="max-h-72 overflow-y-auto rounded-sm border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="w-8 p-2"></th>
                  <th className="p-2">Product</th>
                  <th className="p-2">Code</th>
                  <th className="p-2">Web address</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="p-2">
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                    </td>
                    <td className="p-2">{c.name}</td>
                    <td className={`p-2 ${c.code_ok ? "text-muted-foreground" : ""}`}>
                      {c.product_code ?? "— none —"}
                    </td>
                    <td className={`p-2 ${c.slug_ok ? "text-muted-foreground" : ""}`}>/{c.slug}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <Button type="button" size="sm" onClick={onPreview} disabled={pending}>
              {pending ? "Checking…" : `Preview changes (${selectedIds().length})`}
            </Button>
            <span className="text-xs text-muted-foreground">
              {candidates.length} product{candidates.length === 1 ? "" : "s"} could be tidied. Up to{" "}
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
                  <th className="p-2">Product</th>
                  <th className="p-2">Changes</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.product_id} className="border-t border-border align-top">
                    <td className="p-2">{p.name}</td>
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
            <Button
              type="button"
              size="sm"
              onClick={onApply}
              disabled={pending || proposals.every((p) => p.unchanged)}
            >
              {pending ? "Applying…" : `Apply to ${proposals.filter((p) => !p.unchanged).length} product(s)`}
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
