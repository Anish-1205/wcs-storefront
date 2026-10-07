import { afterEach, describe, expect, it } from "vitest";
import { pickAiImages } from "@/lib/whatsapp-analysis";
import { ingestConfig, thumbnailUrl } from "@/lib/whatsapp-config";
import { countMedia, decideReview, listingLabel, type ReviewHint, type ReviewMedia } from "@/lib/whatsapp-review";

const A = "wamid.A", B = "wamid.B";
const TEXT_A = "Benarsi patola paithani bandhej sarees 7490/";
const TEXT_B = "Tissue sarees with petit point embroidery 6490/";

const item = (n: number, reason: string, confidence = "uncertain", kind: "image" | "video" = "image"): ReviewMedia =>
  ({ message_id: `m${String(n).padStart(2, "0")}`, kind, reason, confidence, ts: 1000 + n });
const hint = (belongs: ReviewHint["belongs"], confidence = 0.95): ReviewHint => ({ belongs, confidence });
const base = { descriptionId: B, text: TEXT_B, threshold: 0.85, answerTimeoutSeconds: 600 };

/** F1's contested burst: 7 photos, 2 videos, 12 photos. */
const f1 = () => [
  ...Array.from({ length: 7 }, (_, i) => item(i + 1, "contested")),
  item(8, "contested", "uncertain", "video"), item(9, "contested", "uncertain", "video"),
  ...Array.from({ length: 12 }, (_, i) => item(i + 10, "contested")),
];

describe("review of media the grouping could not place", () => {
  it("decides a contested burst when every hint is confident", () => {
    const media = f1();
    const hints = new Map(media.map((m, i) => [m.message_id, hint(i < 7 ? "other" : "this")]));
    const outcome = decideReview({ ...base, other: { message_id: A, text: TEXT_A }, media, hints });
    expect(outcome.ask).toBeUndefined();
    expect(outcome.by).toBe("ai");
    expect(Object.values(outcome.decisions!).filter((v) => v === A)).toHaveLength(7);
    expect(Object.values(outcome.decisions!).filter((v) => v === B)).toHaveLength(14);
  });

  it("fills photos the AI was not shown from agreeing neighbours, and stops where the two sides disagree", () => {
    const media = f1();
    // Seen: both ends and both sides of the boundary.
    const seen = new Map([["m01", hint("other")], ["m07", hint("other")], ["m08", hint("this")], ["m21", hint("this")]]);
    const decided = decideReview({ ...base, other: { message_id: A, text: TEXT_A }, media, hints: seen });
    expect(decided.decisions?.m04).toBe(A);
    expect(decided.decisions?.m15).toBe(B);

    // The boundary itself unseen: m07 sits between an "other" and a "this". Not decided; proposed.
    const gap = new Map([["m01", hint("other")], ["m06", hint("other")], ["m08", hint("this")], ["m21", hint("this")]]);
    const asked = decideReview({ ...base, other: { message_id: A, text: TEXT_A }, media, hints: gap });
    expect(asked.decisions).toBeUndefined();
    expect(asked.ask?.proposal?.m07).toBe(A);
    expect(asked.ask?.body).toContain("Reply YES to confirm or NO to decide.");
  });

  it("asks instead of deciding when a hint is below the confidence bar", () => {
    const media = f1();
    const hints = new Map(media.map((m, i) => [m.message_id, hint(i < 7 ? "other" : "this", 0.7)]));
    const outcome = decideReview({ ...base, other: { message_id: A, text: TEXT_A }, media, hints });
    expect(outcome.decisions).toBeUndefined();
    expect(outcome.ask?.body.split("\n")[0]).toBe(
      "I think the first 7 photos are for Banarasi Patola Paithani Bandhej Saree and the other 14 for Tissue Saree with Petit Point Embroidery.");
    expect(Object.values(outcome.ask!.proposal!).filter((v) => v === A)).toHaveLength(7);
  });

  it("with no AI, proposes the split at a run of videos between photos", () => {
    const outcome = decideReview({ ...base, other: { message_id: A, text: TEXT_A }, media: f1(), hints: null });
    expect(outcome.ask?.proposal?.m07).toBe(A);
    expect(outcome.ask?.proposal?.m08).toBe(B);
    expect(outcome.ask?.body).toContain("the first 7 photos");
  });

  it("with no AI and nothing to go on, asks 1/2/3 and proposes nothing", () => {
    const media = Array.from({ length: 5 }, (_, i) => item(i + 1, "contested"));
    const outcome = decideReview({ ...base, other: { message_id: A, text: TEXT_A }, media, hints: null });
    expect(outcome.ask?.proposal).toBeNull();
    expect(outcome.ask?.body).toContain("1 = Banarasi Patola Paithani Bandhej Saree");
    expect(outcome.ask?.body).toContain("2 = Tissue Saree with Petit Point Embroidery");
    expect(outcome.ask?.body).toContain("Reply with 1, 2 or 3.");
  });

  it("never proposes merging an older burst: with no AI it is proposed as separate", () => {
    const media = [
      ...Array.from({ length: 6 }, (_, i) => item(i + 1, "earlier_burst")),
      ...Array.from({ length: 8 }, (_, i) => item(i + 30, "late_description", "late")),
    ];
    const outcome = decideReview({ ...base, other: null, media, hints: null });
    expect(outcome.decisions).toBeUndefined();
    expect(Object.values(outcome.ask!.proposal!)).toEqual(Array(6).fill("aside"));
    expect(outcome.ask?.body).toContain("You sent 6 photos, then 8 more a little later");
    expect(outcome.ask?.body).toContain("NO if all 14 belong to");
  });

  it("an older burst is merged or set aside by a confident AI answer", () => {
    const media = [
      ...Array.from({ length: 6 }, (_, i) => item(i + 1, "earlier_burst")),
      ...Array.from({ length: 8 }, (_, i) => item(i + 30, "before_description", "high")),
    ];
    const separate = new Map(media.map((m) => [m.message_id, hint(m.reason === "earlier_burst" ? "neither" : "this")]));
    expect(Object.values(decideReview({ ...base, other: null, media, hints: separate }).decisions!)).toEqual(Array(6).fill("aside"));
    const same = new Map(media.map((m) => [m.message_id, hint("this")]));
    expect(Object.values(decideReview({ ...base, other: null, media, hints: same }).decisions!)).toEqual(Array(6).fill(B));
    // "other" means nothing without a competing description: aside, never a guess.
    const other = new Map(media.map((m) => [m.message_id, hint("other")]));
    expect(Object.values(decideReview({ ...base, other: null, media, hints: other }).decisions!)).toEqual(Array(6).fill("aside"));
  });

  it("labels a listing by its product name, or by its own words when the text names nothing", () => {
    expect(listingLabel(TEXT_A)).toBe("Banarasi Patola Paithani Bandhej Saree");
    expect(listingLabel("Hii sir plz find new saree stock")).toBe('"Hii sir plz find new saree stock"');
    expect(countMedia([{ kind: "image" }, { kind: "image" }])).toBe("2 photos");
    expect(countMedia([{ kind: "image" }, { kind: "video" }])).toBe("2 photos/videos");
    expect(countMedia([{ kind: "video" }])).toBe("1 video");
  });
});

describe("which thumbnails the AI is shown", () => {
  it("shows everything when it fits", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ kind: "image" as const, i }));
    expect(pickAiImages(items, 12)).toEqual(items);
  });

  it("keeps the ends and both sides of every photo/video switch, in send order", () => {
    const items = f1().map((m, i) => ({ kind: m.kind, i }));
    const picked = pickAiImages(items, 12).map((x) => x.i);
    expect(picked).toHaveLength(12);
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
    for (const index of [0, 6, 7, 8, 9, 20]) expect(picked).toContain(index);
  });

  it("is deterministic", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ kind: "image" as const, i }));
    expect(pickAiImages(items, 12)).toEqual(pickAiImages(items, 12));
    expect(new Set(pickAiImages(items, 12).map((x) => x.i)).size).toBe(12);
  });
});

describe("ingestion configuration", () => {
  const keys = ["INGEST_MAX_IMAGES", "INGEST_AI_TIMEOUT_MS", "INGEST_BOUNDARY_CONFIDENCE", "INGEST_AI_IMAGES"];
  afterEach(() => { for (const key of keys) delete process.env[key]; });

  it("has the documented defaults", () => {
    expect(ingestConfig()).toMatchObject({ maxImages: 20, maxVideos: 2, aiImages: 12, thumbnailWidth: 512, aiTimeoutMs: 8000, boundaryConfidence: 0.85, maxColours: 6 });
  });

  it("reads the environment and ignores nonsense", () => {
    process.env.INGEST_MAX_IMAGES = "15";
    process.env.INGEST_BOUNDARY_CONFIDENCE = "banana";
    process.env.INGEST_AI_IMAGES = "-3";
    expect(ingestConfig()).toMatchObject({ maxImages: 15, boundaryConfidence: 0.85, aiImages: 12 });
  });

  it("never lets an AI call run past 8 seconds", () => {
    process.env.INGEST_AI_TIMEOUT_MS = "60000";
    expect(ingestConfig().aiTimeoutMs).toBe(8000);
    process.env.INGEST_AI_TIMEOUT_MS = "3000";
    expect(ingestConfig().aiTimeoutMs).toBe(3000);
  });

  it("derives a 512px thumbnail by URL, a first frame for a video", () => {
    expect(thumbnailUrl("https://res.cloudinary.com/demo/image/upload/v1/whatsapp/inbox/abc.jpg"))
      .toBe("https://res.cloudinary.com/demo/image/upload/c_limit,w_512/v1/whatsapp/inbox/abc.jpg");
    expect(thumbnailUrl("https://res.cloudinary.com/demo/video/upload/v1/whatsapp/inbox/abc.mp4"))
      .toBe("https://res.cloudinary.com/demo/video/upload/so_0,c_limit,w_512/v1/whatsapp/inbox/abc.jpg");
    expect(thumbnailUrl("https://example.com/x.jpg")).toBe("https://example.com/x.jpg");
  });
});
