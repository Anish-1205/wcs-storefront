/**
 * The one AI call a WhatsApp listing gets, and what is kept of it.
 *
 * The call is made at most once per listing: its answer is stored with the
 * listing (whatsapp_batches.analysis) and reused by every later step and
 * retry. It can fail in any way (not configured, timeout, bad JSON) and the
 * listing still gets made: callers treat null as "no AI" field by field.
 */
import { createHash } from "node:crypto";
import type { AiProvider, ListingAnalysis } from "@/lib/ai/types";
import { ingestConfig, thumbnailUrl, type IngestConfig } from "@/lib/whatsapp-config";

export type AnalysisItem = { message_id: string; url: string; kind: "image" | "video" };

/** What is stored: the answer, and which media each short id in it stands for. */
export type StoredAnalysis = {
  /** Hash of the admin text the answer was written for. */
  text: string;
  /** short id -> message_id, for every thumbnail the AI was shown. */
  ids: Record<string, string>;
  result: ListingAnalysis;
  /** The one retry (name or description failed validation) has been spent. */
  retried?: boolean;
};

export const textKey = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/**
 * Which thumbnails the AI sees when there are more than it can take. The ends
 * and both sides of every photo/video switch go first (that is where a
 * boundary between two listings shows), then an even spread of the rest.
 * Input and output are in send order.
 */
export function pickAiImages<T extends { kind: "image" | "video" }>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const chosen = new Set<number>([0, items.length - 1]);
  for (let i = 1; i < items.length && chosen.size < limit; i++) {
    if (items[i].kind !== items[i - 1].kind) { chosen.add(i - 1); if (chosen.size < limit) chosen.add(i); }
  }
  const rest = items.map((_, index) => index).filter((index) => !chosen.has(index));
  const room = limit - chosen.size;
  for (let k = 0; k < room; k++) chosen.add(rest[Math.floor(((k + 0.5) * rest.length) / room)]);
  return [...chosen].sort((a, b) => a - b).slice(0, limit).map((index) => items[index]);
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type AnalysisRequest = {
  provider: AiProvider;
  text: string;
  otherText?: string | null;
  deterministicName: string;
  /** Candidates in send order; capped here. */
  items: AnalysisItem[];
  categories: Array<{ slug: string; name: string; description?: string | null }>;
  collections: Array<{ id: string; name: string; description: string | null }>;
  feedback?: string;
  config?: IngestConfig;
};

/** One call, hard-limited to the configured timeout. Null on any failure; never throws. */
export async function requestAnalysis(request: AnalysisRequest): Promise<StoredAnalysis | null> {
  const config = request.config ?? ingestConfig();
  const { provider } = request;
  if (!provider.isConfigured() || !provider.analyzeListing || !request.items.length) return null;
  const shown = pickAiImages(request.items, config.aiImages);
  const ids: Record<string, string> = {};
  const images = shown.map((item, index) => {
    const id = `img${index + 1}`;
    ids[id] = item.message_id;
    return { id, url: thumbnailUrl(item.url, config.thumbnailWidth) };
  });
  try {
    const result = await withTimeout(provider.analyzeListing({
      adminText: request.text,
      otherText: request.otherText ?? null,
      deterministicName: request.deterministicName,
      images,
      categories: request.categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description ?? null })),
      collections: request.collections,
      feedback: request.feedback,
      timeoutMs: config.aiTimeoutMs,
    }), config.aiTimeoutMs);
    if (!result || !Array.isArray(result.images)) return null;
    // Only ever images the AI was actually shown.
    return { text: textKey(request.text), ids, result: { ...result, images: result.images.filter((image) => image.id in ids) } };
  } catch (error) {
    console.warn("whatsapp analysis: AI call failed", error instanceof Error ? error.message : error);
    return null;
  }
}
