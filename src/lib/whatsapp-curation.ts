/**
 * Decides what a WhatsApp listing shows, from everything that was sent for it.
 *
 * Pure: no database, no network, no AI call. It is given the media, what is
 * known about each image (the AI's flags when there are any, pixel facts from
 * the thumbnail when those could be computed) and returns the visible
 * variants plus what is hidden. Nothing is ever deleted: a duplicate, an
 * extra beyond the cap, or a photo that fits no colour goes to `hidden`,
 * which the admin can restore from.
 *
 * Rules (INGEST_* in whatsapp-config.ts):
 *  - Exact duplicates (same sha256) and near duplicates (same dHash, same
 *    colour) are shown once: the highest resolution copy. Scoped to this
 *    listing; the same photo in two listings is legitimate.
 *  - A collage is never the cover and never makes a colour variant. It is
 *    labelled "all colours" and placed second.
 *  - Colour variants need 2+ distinct colours from single-saree images, at
 *    most `maxColours`; otherwise one "Default" variant.
 *  - A photo the AI was not shown joins a colour only by a clear pixel match,
 *    else it is hidden. It is never dumped into the first colour.
 *  - At most `maxImages` visible images, spread over variants and shot types,
 *    at least one per variant; at most `maxVideos` videos.
 */
import type { QualityFlag, ShotType } from "@/lib/ai/types";
import { ingestConfig, type IngestConfig } from "@/lib/whatsapp-config";

export type Visual = {
  /** 64-bit difference hash of the thumbnail, as 16 hex digits. */
  dhash: string;
  /** Average colour of the thumbnail. */
  rgb: [number, number, number];
  /** Three or more distinct strong hues: probably several sarees in one frame. */
  multiColour: boolean;
};

export type CurationItem = {
  message_id: string;
  media_id: string;
  url: string;
  kind: "image" | "video";
  received_at: string;
  sha256: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  visual?: Visual | null;
};

export type ImageFacts = { collage: boolean; shot_type: ShotType | null; quality: QualityFlag[] };

export type HiddenReason = "duplicate" | "near_duplicate" | "over_limit" | "unmatched_colour";

export type CurationInput = {
  /** In display order (send time, then arrival). */
  items: CurationItem[];
  /** message_id -> what the AI said about that image. Empty when it said nothing. */
  facts: Map<string, ImageFacts>;
  /** The AI's colour groups, by message_id. Null when it gave none. */
  colourGroups: Array<{ colour: string; ids: string[] }> | null;
  /** The AI's cover pick. */
  coverId: string | null;
  config?: IngestConfig;
};

export type PlannedMedia = CurationItem & { is_primary: boolean; display_order: number; label?: "all_colours" };
export type HiddenMedia = {
  url: string; kind: "image" | "video"; message_id: string; reason: HiddenReason;
  duplicate_of: string | null; color: string | null; display_order: number;
};

export type CurationResult = {
  variants: Array<{ color: string; media: PlannedMedia[] }>;
  hidden: HiddenMedia[];
  /** message_id of the collage, and how it was recognised. */
  collage: { id: string; by: "ai" | "pixels" } | null;
  /** The only image is a collage, so it had to be the cover. */
  coverIsCollage: boolean;
  stats: { images: number; videos: number; duplicates: number; extras: number; unmatched: number };
};

export const DEFAULT_COLOUR = "Default";
const SHOT_RANK: Record<ShotType, number> = { drape: 0, full: 1, model: 2, pallu: 3, flatlay: 4, detail: 5, border: 6, other: 7 };
const UNKNOWN_RANK = 4;

const pixels = (item: CurationItem) => (item.width ?? 0) * (item.height ?? 0);

function hamming(a: string, b: string): number {
  let bits = 0;
  for (let i = 0; i < 16; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) { bits += x & 1; x >>= 1; }
  }
  return bits;
}

export function colourDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** "rani pink" -> "Rani Pink"; anything unusable -> null. */
export function colourLabel(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "").replace(/[^\p{L}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 30 || /^(multi|multicolou?r|mixed|assorted|various|default|unknown|all colou?rs)$/i.test(cleaned)) return null;
  return cleaned.split(" ").map((word) => `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`).join(" ");
}

/** Colours that only differ by pixels this close are too alike to match on. */
const MATCH_MAX = 70;
const MATCH_MARGIN = 0.75;

export function curateListing(input: CurationInput): CurationResult {
  const config = input.config ?? ingestConfig();
  const order = new Map(input.items.map((item, index) => [item.message_id, index]));
  const byOrder = (a: CurationItem, b: CurationItem) => order.get(a.message_id)! - order.get(b.message_id)!;
  // Best copy first: most pixels, then most bytes, then the one sent first.
  const byQuality = (a: CurationItem, b: CurationItem) => pixels(b) - pixels(a) || (b.bytes ?? 0) - (a.bytes ?? 0) || byOrder(a, b);
  const hidden: HiddenMedia[] = [];
  const hide = (item: CurationItem, reason: HiddenReason, of: CurationItem | null = null, color: string | null = null) =>
    hidden.push({ url: item.url, kind: item.kind, message_id: item.message_id, reason, duplicate_of: of?.url ?? null, color, display_order: order.get(item.message_id)! + 1 });

  // 1. Exact duplicates, per kind.
  let kept: CurationItem[] = [];
  const bySha = new Map<string, CurationItem[]>();
  for (const item of input.items) {
    if (!item.sha256) { kept.push(item); continue; }
    const key = `${item.kind}:${item.sha256}`;
    bySha.set(key, [...(bySha.get(key) ?? []), item]);
  }
  for (const group of bySha.values()) {
    const [best, ...rest] = [...group].sort(byQuality);
    kept.push(best);
    for (const item of rest) hide(item, "duplicate", best);
  }
  kept.sort(byOrder);

  // 2. Near duplicates among images whose thumbnail could be hashed: the same
  //    picture recompressed. Same structure AND same colour, so two colourways
  //    shot in the same pose are not mistaken for one photo.
  const images = kept.filter((item) => item.kind === "image");
  const dropped = new Set<string>();
  const clusters: CurationItem[][] = [];
  for (const item of images) {
    const home = item.visual && clusters.find((cluster) => cluster.some((other) => other.visual
      && hamming(other.visual.dhash, item.visual!.dhash) <= config.nearDuplicateBits
      && colourDistance(other.visual.rgb, item.visual!.rgb) <= 30));
    if (home) home.push(item); else clusters.push([item]);
  }
  for (const cluster of clusters) {
    const [best, ...rest] = [...cluster].sort(byQuality);
    for (const item of rest) { hide(item, "near_duplicate", best); dropped.add(item.message_id); }
  }
  kept = kept.filter((item) => !dropped.has(item.message_id));
  const duplicates = hidden.length;

  // 3. Videos: at most maxVideos.
  const videos = kept.filter((item) => item.kind === "video");
  const shownVideos = videos.slice(0, config.maxVideos);
  for (const item of videos.slice(config.maxVideos)) hide(item, "over_limit");

  // 4. The collage. The AI's flag when it gave any; otherwise only the opener
  //    can be guessed from its pixels (admins send the "all colours" shot first).
  let photos = kept.filter((item) => item.kind === "image");
  const flagged = photos.filter((item) => input.facts.get(item.message_id)?.collage);
  let collage: CurationResult["collage"] = flagged.length ? { id: flagged[0].message_id, by: "ai" } : null;
  if (!collage && input.facts.size === 0 && photos.length > 1 && photos[0].visual?.multiColour) collage = { id: photos[0].message_id, by: "pixels" };
  const isCollage = (item: CurationItem) => item.message_id === collage?.id || !!input.facts.get(item.message_id)?.collage;
  const singles = photos.filter((item) => !isCollage(item));
  const collages = photos.filter(isCollage);

  // 5. Colour groups, from single-saree images only.
  const groups = new Map<string, CurationItem[]>();
  const singleIds = new Map(singles.map((item) => [item.message_id, item]));
  const placed = new Set<string>();
  for (const group of input.colourGroups ?? []) {
    const label = colourLabel(group.colour);
    if (!label) continue;
    for (const id of group.ids) {
      const item = singleIds.get(id);
      if (!item || placed.has(id)) continue;
      placed.add(id);
      groups.set(label, [...(groups.get(label) ?? []), item]);
    }
  }
  const split = groups.size >= 2 && groups.size <= config.maxColours;
  let unmatched = 0;
  const colourOf = new Map<string, string>();
  if (split) {
    const centroids = [...groups].map(([label, members]) => {
      const seen = members.filter((item) => item.visual);
      const mean = (channel: 0 | 1 | 2) => seen.reduce((sum, item) => sum + item.visual!.rgb[channel], 0) / (seen.length || 1);
      return { label, rgb: seen.length ? [mean(0), mean(1), mean(2)] as [number, number, number] : null };
    }).filter((c): c is { label: string; rgb: [number, number, number] } => !!c.rgb);
    const match = (item: CurationItem): string | null => {
      if (!item.visual || centroids.length < 2) return null;
      const ranked = centroids.map((c) => ({ label: c.label, d: colourDistance(c.rgb, item.visual!.rgb) })).sort((a, b) => a.d - b.d);
      return ranked[0].d <= MATCH_MAX && ranked[0].d <= MATCH_MARGIN * ranked[1].d ? ranked[0].label : null;
    };
    for (const [label, members] of groups) for (const item of members) colourOf.set(item.message_id, label);
    // A photo the AI did not place: a clear pixel match, or hidden.
    for (const item of singles) {
      if (colourOf.has(item.message_id)) continue;
      const label = match(item);
      if (label) colourOf.set(item.message_id, label);
      else { hide(item, "unmatched_colour"); unmatched++; }
    }
    photos = photos.filter((item) => isCollage(item) || colourOf.has(item.message_id));
    // Each video goes with the colour it clearly shows, else the first.
    for (const item of shownVideos) { const label = match(item); if (label) colourOf.set(item.message_id, label); }
  }
  const visibleSingles = photos.filter((item) => !isCollage(item));

  // 6. Cover: the AI's pick when it is a usable single-saree image, else the
  //    best shot type with no quality flag, else the first.
  const rank = (item: CurationItem) => {
    const facts = input.facts.get(item.message_id);
    return (facts?.shot_type ? SHOT_RANK[facts.shot_type] : UNKNOWN_RANK) + (facts?.quality.length ? 10 : 0);
  };
  const byRank = (a: CurationItem, b: CurationItem) => rank(a) - rank(b) || byOrder(a, b);
  const cover = visibleSingles.find((item) => item.message_id === input.coverId) ?? [...visibleSingles].sort(byRank)[0] ?? null;

  const labels = split ? [...groups.keys()].filter((label) => visibleSingles.some((item) => colourOf.get(item.message_id) === label)) : [DEFAULT_COLOUR];
  const coverLabel = split && cover ? colourOf.get(cover.message_id)! : labels[0];
  const ordered = [coverLabel, ...labels.filter((label) => label !== coverLabel)].filter((label): label is string => !!label);
  const membersOf = (label: string) => (split ? visibleSingles.filter((item) => colourOf.get(item.message_id) === label) : visibleSingles);
  const primaryOf = new Map<string, CurationItem>();
  for (const label of ordered) {
    const members = membersOf(label);
    const pick = label === coverLabel && cover ? cover : [...members].sort(byRank)[0];
    if (pick) primaryOf.set(label, pick);
  }

  // 7. The cap. Covers first, then the collage, then one photo per variant in
  //    turn, each variant handing out its shot types in turn.
  const chosen = new Set<string>([...primaryOf.values()].map((item) => item.message_id));
  const shownCollage = collages[0] ?? null;
  if (shownCollage && chosen.size < Math.max(config.maxImages, primaryOf.size + 1)) chosen.add(shownCollage.message_id);
  const queues = ordered.map((label) => {
    const byType = new Map<number, CurationItem[]>();
    for (const item of membersOf(label).filter((x) => !chosen.has(x.message_id)).sort(byRank)) {
      const key = rank(item);
      byType.set(key, [...(byType.get(key) ?? []), item]);
    }
    const lanes = [...byType.entries()].sort((a, b) => a[0] - b[0]).map(([, lane]) => lane);
    const queue: CurationItem[] = [];
    while (lanes.some((lane) => lane.length)) for (const lane of lanes) { const next = lane.shift(); if (next) queue.push(next); }
    return queue;
  });
  while (chosen.size < config.maxImages && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      if (chosen.size >= config.maxImages) break;
      const next = queue.shift();
      if (next) chosen.add(next.message_id);
    }
  }
  // Further collages are ordinary extras: shown only if there is room.
  for (const item of collages.slice(1)) if (chosen.size < config.maxImages) chosen.add(item.message_id);
  let extras = 0;
  for (const item of photos) {
    if (chosen.has(item.message_id)) continue;
    hide(item, "over_limit", null, split ? colourOf.get(item.message_id) ?? null : null);
    extras++;
  }
  extras += videos.length - shownVideos.length;

  // 8. Lay out each variant: cover, collage second (first variant only), the
  //    rest as sent, videos last.
  const onlyCollages = !visibleSingles.length && collages.length > 0;
  const variants = ordered.map((label, index) => {
    const primary = primaryOf.get(label) ?? null;
    const rest = membersOf(label).filter((item) => chosen.has(item.message_id) && item.message_id !== primary?.message_id);
    const extraCollages = index === 0 ? collages.filter((item) => chosen.has(item.message_id)) : [];
    const clips = shownVideos.filter((item) => (split ? (colourOf.get(item.message_id) ?? ordered[0]) === label : true));
    const sequence = [...(primary ? [primary] : []), ...extraCollages.slice(0, 1), ...rest, ...extraCollages.slice(1), ...clips];
    // Only collages, or only videos: something still has to be the cover.
    const lead = primary ?? sequence.find((item) => item.kind === "image") ?? sequence[0];
    return {
      color: label,
      media: sequence.map((item, position): PlannedMedia => ({
        ...item, is_primary: item === lead, display_order: position + 1,
        ...(isCollage(item) ? { label: "all_colours" as const } : {}),
      })),
    };
  }).filter((variant) => variant.media.length);

  return {
    variants, hidden, collage: collages.length ? collage ?? { id: collages[0].message_id, by: "ai" } : null,
    coverIsCollage: onlyCollages,
    stats: {
      images: variants.reduce((n, v) => n + v.media.filter((m) => m.kind === "image").length, 0),
      videos: variants.reduce((n, v) => n + v.media.filter((m) => m.kind === "video").length, 0),
      duplicates, extras, unmatched,
    },
  };
}
