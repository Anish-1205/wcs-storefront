/**
 * Decides what happens to media the grouping could not place on its own
 * (migration 030): a burst two descriptions compete for ("contested"), or an
 * older burst sitting before a description's own ("earlier_burst").
 *
 * Pure: no database, no network. Given the AI's per-image hint (or none), it
 * returns either a decision for every uncertain photo/video, or a question
 * for the sender. Nothing is ever assigned on a guess: a hint below the
 * confidence bar becomes a proposal the sender confirms, and without any hint
 * an older burst is proposed as separate, never as merged.
 */
import { deriveProductName, GENERIC_NAME, parseCollectionMessage } from "@/lib/whatsapp-caption";

export type ReviewMedia = {
  message_id: string;
  kind: "image" | "video";
  /** assignment_reason from the inbox: "contested", "earlier_burst", or how a certain item got here. */
  reason: string | null;
  confidence: string | null;
  /** WhatsApp's send time, epoch seconds. */
  ts: number;
};

export type ReviewHint = { belongs: "this" | "other" | "neither"; confidence: number };

export type ReviewInput = {
  descriptionId: string;
  text: string;
  /** The competing description, when one burst is contested. */
  other: { message_id: string; text: string } | null;
  /** Everything currently with this description, certain and uncertain. */
  media: ReviewMedia[];
  /** message_id -> what the AI said about that image. Null when the AI did not answer. */
  hints: Map<string, ReviewHint> | null;
  /** A hint is acted on at or above this (INGEST_BOUNDARY_CONFIDENCE). */
  threshold: number;
  answerTimeoutSeconds: number;
};

export type ReviewOutcome = {
  /** message_id -> a description's message_id, or "aside". */
  decisions?: Record<string, string>;
  by?: "ai" | "rule";
  ask?: { body: string; proposal: Record<string, string> | null };
};

const ASIDE = "aside";
const bySent = (a: ReviewMedia, b: ReviewMedia) => a.ts - b.ts || (a.message_id < b.message_id ? -1 : a.message_id > b.message_id ? 1 : 0);

/** "7 photos", "2 videos", "9 photos/videos". */
export function countMedia(items: Array<{ kind: "image" | "video" }>): string {
  const photos = items.filter((item) => item.kind === "image").length;
  const videos = items.length - photos;
  if (!videos) return `${photos} photo${photos === 1 ? "" : "s"}`;
  if (!photos) return `${videos} video${videos === 1 ? "" : "s"}`;
  return `${items.length} photos/videos`;
}

/** What to call a description when talking to the sender: its product name, or its own first words. */
export function listingLabel(text: string): string {
  const name = deriveProductName(parseCollectionMessage(text).description);
  if (name !== GENERIC_NAME && !/^Saree \d+$/.test(name)) return name;
  const words = text.replace(/\s+/g, " ").trim();
  return `"${words.length > 40 ? `${words.slice(0, 39)}…` : words}"`;
}

function minutes(seconds: number): string {
  const value = Math.max(1, Math.round(seconds / 60));
  return `${value} minute${value === 1 ? "" : "s"}`;
}

/**
 * Fills in items the AI was not shown from the ones it was: an unseen item
 * takes its neighbours' answer when both sides agree (or it sits at an edge),
 * because a listing's media is contiguous in send order. Where the two sides
 * disagree the boundary runs through it and it stays undecided.
 */
function spread(items: ReviewMedia[], known: Map<string, string>): Map<string, string> {
  const out = new Map(known);
  items.forEach((item, index) => {
    if (out.has(item.message_id)) return;
    let before: string | undefined, after: string | undefined;
    for (let i = index - 1; i >= 0 && before === undefined; i--) before = known.get(items[i].message_id);
    for (let i = index + 1; i < items.length && after === undefined; i++) after = known.get(items[i].message_id);
    if (before !== undefined && (after === undefined || after === before)) out.set(item.message_id, before);
    else if (before === undefined && after !== undefined) out.set(item.message_id, after);
  });
  return out;
}

export function decideReview(input: ReviewInput): ReviewOutcome {
  const media = [...input.media].sort(bySent);
  const uncertain = media.filter((item) => item.confidence === "uncertain");
  if (!uncertain.length) return { decisions: {}, by: "rule" };
  const contested = uncertain.filter((item) => item.reason === "contested");
  const earlier = uncertain.filter((item) => item.reason !== "contested");
  const certain = media.filter((item) => item.confidence !== "uncertain");

  const target = (item: ReviewMedia, belongs: ReviewHint["belongs"]) =>
    belongs === "this" ? input.descriptionId
      : belongs === "other" && item.reason === "contested" && input.other ? input.other.message_id
        : ASIDE;

  // 1. Confident hints, spread across what the AI did not see. A hint below
  //    the bar pins that item as undecided: its neighbours must not vote for it.
  const confident = new Map<string, string>();
  const doubtful = new Set<string>();
  const guess = new Map<string, string>();
  for (const item of uncertain) {
    const hint = input.hints?.get(item.message_id);
    if (!hint) continue;
    guess.set(item.message_id, target(item, hint.belongs));
    if (hint.confidence >= input.threshold) confident.set(item.message_id, target(item, hint.belongs));
    else doubtful.add(item.message_id);
  }
  const decided = new Map<string, string>();
  for (const group of [contested, earlier]) {
    for (const [id, value] of spread(group, confident)) if (!doubtful.has(id)) decided.set(id, value);
  }
  if (uncertain.every((item) => decided.has(item.message_id))) return { decisions: Object.fromEntries(decided), by: "ai" };

  // 2. Not sure: ask, with a proposal where there is something to propose.
  const proposal = new Map<string, string>();
  // An older burst is proposed as separate. Merging is only ever the sender's call.
  for (const item of earlier) proposal.set(item.message_id, ASIDE);
  let contestedProposed = contested.length === 0;
  if (contested.length && input.other) {
    const guessed = spread(contested, new Map([...guess].filter(([id]) => contested.some((item) => item.message_id === id))));
    // Only a proposal: where the two sides disagree, an unseen item goes with the one before it.
    if (guessed.size) {
      contested.forEach((item, index) => {
        if (guessed.has(item.message_id)) return;
        const near = [...contested.slice(0, index).reverse(), ...contested.slice(index + 1)].find((x) => guessed.has(x.message_id));
        if (near) guessed.set(item.message_id, guessed.get(near.message_id)!);
      });
    }
    if (contested.every((item) => guessed.has(item.message_id))) {
      for (const item of contested) proposal.set(item.message_id, guessed.get(item.message_id)!);
      contestedProposed = true;
    } else if (!input.hints) {
      // No AI at all. One thing in the stream itself hints at a boundary: a
      // run of videos between two runs of photos. Offered as a proposal only.
      const firstVideo = contested.findIndex((item) => item.kind === "video");
      const photosAfter = firstVideo > 0 && contested.slice(firstVideo).some((item) => item.kind === "image");
      if (photosAfter) {
        contested.forEach((item, index) => proposal.set(item.message_id, index < firstVideo ? input.other!.message_id : input.descriptionId));
        contestedProposed = true;
      }
    }
  }

  const mine = listingLabel(input.text);
  const wait = minutes(input.answerTimeoutSeconds);
  if (!contestedProposed) {
    // Nothing to propose for the contested media. Older bursts are not part of
    // this question: they are kept aside, which assigns them to nothing.
    const theirs = listingLabel(input.other?.text ?? "");
    return {
      ...(earlier.length ? { decisions: Object.fromEntries(earlier.map((item) => [item.message_id, ASIDE])), by: "rule" as const } : {}),
      ask: {
        proposal: null,
        body: [
          `I'm not sure which listing these ${countMedia(contested)} belong to, so I haven't created anything yet.`,
          `1 = ${theirs}`,
          `2 = ${mine}`,
          "3 = keep them aside, I'll sort them in the admin panel",
          `Reply with 1, 2 or 3. If I don't hear back in ${wait} I'll keep them aside.`,
        ].join("\n"),
      },
    };
  }

  const lines: string[] = [];
  if (contested.length) {
    const theirs = listingLabel(input.other!.text);
    const toOther = contested.filter((item) => proposal.get(item.message_id) === input.other!.message_id);
    const toMine = contested.filter((item) => proposal.get(item.message_id) === input.descriptionId);
    const toNone = contested.filter((item) => proposal.get(item.message_id) === ASIDE);
    const firstMine = contested.findIndex((item) => proposal.get(item.message_id) !== input.other!.message_id);
    const clean = !toNone.length && toOther.length > 0 && toMine.length > 0
      && contested.every((item, index) => (index < firstMine) === (proposal.get(item.message_id) === input.other!.message_id));
    if (clean) lines.push(`I think the first ${countMedia(toOther)} are for ${theirs} and the other ${toMine.length} for ${mine}.`);
    else if (!toOther.length && !toNone.length) lines.push(`I think all ${countMedia(contested)} are for ${mine}, and none for ${theirs}.`);
    else if (!toMine.length && !toNone.length) lines.push(`I think all ${countMedia(contested)} are for ${theirs}, and none for ${mine}.`);
    else lines.push(`I think ${toOther.length} of these ${countMedia(contested)} are for ${theirs}, ${toMine.length} for ${mine}${toNone.length ? ` and ${toNone.length} for neither` : ""}.`);
  }
  if (earlier.length) {
    const own = [...certain, ...contested.filter((item) => proposal.get(item.message_id) === input.descriptionId)];
    lines.push(contested.length
      ? `The ${countMedia(earlier)} sent a little earlier look separate, so I'd keep them aside.`
      : `You sent ${countMedia(earlier)}, then ${own.length} more a little later, then the description for ${mine}. I think only the last ${own.length} are for ${mine}.`);
  }
  lines.push(contested.length
    ? "Reply YES to confirm or NO to decide."
    : `Reply YES to confirm, or NO if all ${uncertain.length + certain.length} belong to ${mine}.`);
  lines.push(contested.length
    ? `If I don't hear back in ${wait} I'll keep them aside for you to sort in the admin panel.`
    : `If I don't hear back in ${wait} I'll keep the first ${earlier.length} aside for you to sort in the admin panel.`);
  return { ask: { proposal: Object.fromEntries(proposal), body: lines.join("\n") } };
}
