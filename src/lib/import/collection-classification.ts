import type { AiProvider, CollectionCandidate } from "@/lib/ai/types";

/**
 * Collection assignment is fail-closed. A group may only reach 'confirmed'
 * through a deterministic source or an explicit admin action (handled by the
 * caller, not this module). AI can only ever produce 'suggested' (needs
 * admin confirmation) or, when the evidence is weak/ambiguous/absent,
 * 'unresolved'. This module never returns a collection id that was not in
 * the caller-supplied `existingCollections` list.
 */
export type ClassificationState = "confirmed" | "suggested" | "unresolved";
export type ClassificationMethod =
  | "known_batch_manifest"
  | "trusted_manifest"
  | "existing_mapping"
  | "ai_suggested"
  | "none";

export interface ClassificationResult {
  state: ClassificationState;
  method: ClassificationMethod;
  collection_id: string | null;
  confidence: number | null;
  evidence: { note: string } | null;
  candidate_alternatives: CollectionCandidate[] | null;
}

// An AI candidate must clear both bars to become a (still admin-confirmable)
// SUGGESTED result — a high score alone is never enough (spec: "MUST NEVER
// guess... simply because one candidate has the highest AI score").
export const SUGGESTED_CONFIDENCE_THRESHOLD = 0.72;
export const SUGGESTED_MARGIN_THRESHOLD = 0.15;

export interface ExistingCollection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface ClassifyGroupInput {
  adminDescription: string | null;
  /** Folder name (top segment of a selected directory) or a detected filename identifier, if any. */
  folderOrFilenameHint: string | null;
  batchManifestCollectionId: string | null;
  /** Trusted admin-authored mapping from folder/filename hint -> collection slug, from import_batches.manifest. */
  trustedManifestMap: Record<string, string> | null;
  /** Admin-maintained exact aliases (lowercased) -> collection id. */
  aliases: Array<{ alias: string; collection_id: string }>;
  existingCollections: ExistingCollection[];
  imageUrls: string[];
  aiProvider: AiProvider;
}

function normalize(text: string) {
  return text.trim().toLowerCase();
}

/** Deterministic sources only — never touches AI. Returns null if none match. */
function classifyDeterministically(input: ClassifyGroupInput): ClassificationResult | null {
  if (input.batchManifestCollectionId) {
    const match = input.existingCollections.find((c) => c.id === input.batchManifestCollectionId);
    if (match) {
      return {
        state: "confirmed",
        method: "known_batch_manifest",
        collection_id: match.id,
        confidence: 1,
        evidence: { note: `Every group in this batch was assigned to "${match.name}" at import time.` },
        candidate_alternatives: null,
      };
    }
  }

  const hint = input.folderOrFilenameHint ? normalize(input.folderOrFilenameHint) : null;

  if (hint && input.trustedManifestMap) {
    const normalizedMap = new Map(Object.entries(input.trustedManifestMap).map(([k, v]) => [normalize(k), v]));
    const targetSlug = normalizedMap.get(hint);
    if (targetSlug) {
      const match = input.existingCollections.find((c) => c.slug === targetSlug);
      if (match) {
        return {
          state: "confirmed",
          method: "trusted_manifest",
          collection_id: match.id,
          confidence: 1,
          evidence: { note: `Matched "${input.folderOrFilenameHint}" in the batch manifest to "${match.name}".` },
          candidate_alternatives: null,
        };
      }
    }
  }

  const haystacks = [hint, input.adminDescription ? normalize(input.adminDescription) : null].filter(
    (v): v is string => !!v,
  );
  for (const alias of input.aliases) {
    const normalizedAlias = normalize(alias.alias);
    if (haystacks.some((h) => h === normalizedAlias || h.includes(normalizedAlias))) {
      const match = input.existingCollections.find((c) => c.id === alias.collection_id);
      if (match) {
        return {
          state: "confirmed",
          method: "existing_mapping",
          collection_id: match.id,
          confidence: 1,
          evidence: { note: `Matched the alias "${alias.alias}" to "${match.name}".` },
          candidate_alternatives: null,
        };
      }
    }
  }

  return null;
}

/**
 * Runs the deterministic sources first (never guesses), and only consults AI
 * when nothing deterministic matched. AI output is always filtered against
 * `existingCollections` and never allowed to reach 'confirmed'.
 */
export async function classifyGroupCollection(input: ClassifyGroupInput): Promise<ClassificationResult> {
  const deterministic = classifyDeterministically(input);
  if (deterministic) return deterministic;

  if (input.existingCollections.length === 0) {
    return { state: "unresolved", method: "none", collection_id: null, confidence: null, evidence: null, candidate_alternatives: null };
  }

  let candidates: CollectionCandidate[] = [];
  try {
    candidates = await input.aiProvider.classifyCollection({
      adminDescription: input.adminDescription,
      imageUrls: input.imageUrls,
      existingCollections: input.existingCollections.map((c) => ({ id: c.id, name: c.name, description: c.description })),
    });
  } catch (error) {
    // AI failure is never a hard error here — it just means no suggestion.
    console.warn("collection classification: AI provider failed", error instanceof Error ? error.message : error);
    candidates = [];
  }

  // Defensive re-filter: only candidates for collections we actually offered.
  const validIds = new Set(input.existingCollections.map((c) => c.id));
  candidates = candidates.filter((c) => validIds.has(c.collection_id)).sort((a, b) => b.confidence - a.confidence);

  if (candidates.length === 0) {
    return { state: "unresolved", method: "none", collection_id: null, confidence: null, evidence: null, candidate_alternatives: null };
  }

  const [top, second] = candidates;
  const margin = top.confidence - (second?.confidence ?? 0);
  const confident = top.confidence >= SUGGESTED_CONFIDENCE_THRESHOLD && margin >= SUGGESTED_MARGIN_THRESHOLD;

  if (!confident) {
    return {
      state: "unresolved",
      method: "ai_suggested",
      collection_id: null,
      confidence: null,
      evidence: null,
      candidate_alternatives: candidates,
    };
  }

  return {
    state: "suggested",
    method: "ai_suggested",
    collection_id: top.collection_id,
    confidence: top.confidence,
    evidence: { note: top.evidence },
    candidate_alternatives: candidates,
  };
}
