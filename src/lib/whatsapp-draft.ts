/**
 * What the admin panel says about a draft that WhatsApp ingestion made: why it
 * is flagged for review, and why it holds the photos it does. Pure helpers
 * over rows the pages have already read; no database access here.
 */
import { describePriceFlag, type PriceFlag } from "@/lib/whatsapp-price";

const PRICE_FLAGS: PriceFlag[] = ["price_rounded", "price_out_of_range", "two_prices", "price_range"];

const REASONS: Record<string, string> = {
  price_missing: "No price was given",
  name_generic: "The text did not say what kind of saree it is",
  fabric_missing: "No fabric was mentioned",
  vague_text: "The text said little about the saree",
  colour_conflict: "The colour in the text does not match the photos (the text was kept)",
  late_description: "The description came a while after the photos",
  grouped_by_ai: "The photos were matched to the description by how they look",
  cover_is_collage: "The only photo is a collage, so it is the cover",
  unmatched_photos: "Some photos did not clearly match a colour and were hidden",
};

/** A stored needs_review reason code as a sentence. Unknown codes are shown as they are. */
export function reviewReasonText(code: string): string {
  if ((PRICE_FLAGS as string[]).includes(code)) {
    const sentence = describePriceFlag(code as PriceFlag);
    return `${sentence[0].toUpperCase()}${sentence.slice(1)}`;
  }
  return REASONS[code] ?? code.replace(/_/g, " ");
}

/** One row of whatsapp_listing_audit, as the product page reads it. */
export type AuditRow = {
  mode: string;
  kind: string | null;
  assignment_reason: string | null;
  confidence: string | null;
  decided_by: string | null;
  seconds_before_description: number | null;
  close_reason: string | null;
  summary: string | null;
};

const SIGNALS: Record<string, string> = {
  same_forward: "Sent together with the description",
  before_description: "Sent just before the description",
  late_description: "Sent earlier; the description came late",
  after_description: "Sent after the description",
  ai_match: "Matched to the description from the photos",
  confirmed: "Confirmed by the sender",
  reply_to_media: "The description was a reply to one of these",
  caption_album: "Sent in the album that carried the caption",
  straggler: "Arrived late, sent with the rest",
};
const CONFIDENCE: Record<string, string> = {
  high: "High", explicit: "Certain", confirmed: "Confirmed", ai: "AI", late: "Medium", provisional: "High",
};
const CLOSED: Record<string, string> = {
  photos_first: "Photos first, then the description.",
  same_forward: "Photos and description arrived as one forward.",
  quiet: "Description first; closed after a quiet period with no more photos.",
  next_description: "Description first; closed when the next description arrived.",
  explicit: "The description was a caption on, or a reply to, its own photos.",
};

export type GroupingExplanation = {
  headline: string | null;
  signals: Array<{ signal: string; count: number; confidence: string; timing: string | null }>;
};

/** "Why grouped": the signals that put each photo/video in this listing, and how sure they were. */
export function explainGrouping(rows: AuditRow[]): GroupingExplanation | null {
  const media = rows.filter((row) => row.mode !== "finalize" && row.mode !== "answer" && row.kind);
  if (!media.length) return null;
  const groups = new Map<string, AuditRow[]>();
  for (const row of media) {
    const key = `${row.confidence === "explicit" ? row.assignment_reason ?? "explicit" : row.assignment_reason ?? "unknown"}|${row.confidence ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const signals = [...groups.values()].map((group) => {
    const offsets = group.map((row) => row.seconds_before_description).filter((value): value is number => value !== null);
    const min = Math.round(Math.min(...offsets)), max = Math.round(Math.max(...offsets));
    const span = (a: number, b: number, word: string) => (a === b ? `${a}s ${word}` : `${a}-${b}s ${word}`);
    const timing = !offsets.length ? null
      : min >= 0 ? span(min, max, "before the description")
        : max <= 0 ? span(-max, -min, "after the description")
          : `from ${max}s before to ${-min}s after the description`;
    const reason = group[0].assignment_reason ?? "";
    return {
      signal: SIGNALS[reason] ?? (reason ? reason.replace(/_/g, " ") : "Added"),
      count: group.length,
      confidence: CONFIDENCE[group[0].confidence ?? ""] ?? "Unknown",
      timing,
    };
  }).sort((a, b) => b.count - a.count);
  const closed = rows.find((row) => row.close_reason)?.close_reason ?? null;
  return { headline: (closed && CLOSED[closed]) ?? rows.find((row) => row.summary)?.summary ?? null, signals };
}

export const MEDIA_LABELS: Record<string, string> = { all_colours: "All colours" };
