/**
 * Everything the replay replaces: Supabase (-> real local Postgres), Meta and
 * Cloudinary (-> an in-memory fetch), the AI provider (-> off, or an oracle that
 * answers from the fixtures' ground truth) and Sentry.
 *
 * Test files wire these in with vi.mock(..., async () => (await import("./lib/mocks")).xMock).
 */
import { createHash } from "node:crypto";
import type { Client } from "pg";
import sharp from "sharp";
import type { AiProvider, ColorVariantSuggestion, ListingAnalysis, ProductMetadataSuggestions } from "@/lib/ai/types";
import { nullAiProvider } from "@/lib/ai/null-provider";
import { GENERIC_NAME, parseCollectionMessage } from "@/lib/whatsapp-caption";
import { describeFromAdminText, isTitleOnly } from "@/lib/whatsapp-text";
import { supabaseShim } from "./db";

export const CLOUD = "demo-cloud";
export type Truth = { listing: string; colour?: string; role: string; of?: string };
export type FixtureEvent = {
  id: string; type: "image" | "video" | "text"; sent: number; arrive: number;
  text?: string; sha256?: string; truth: Truth;
};

export const messageId = (eventId: string) => `wamid.${eventId}`;
export const mediaId = (eventId: string) => `mid.${eventId}`;
export const publicIdHash = (eventId: string) => createHash("sha256").update(messageId(eventId)).digest("hex");

/** Mutable per-replay state, shared between the test file and the mock factories. */
export const state = {
  pg: null as Client | null,
  ai: "off" as "off" | "oracle",
  /** Meta media id -> truth. */
  truthByMedia: new Map<string, Truth>(),
  /** Meta media id / Cloudinary public-id hash -> the fixture event. */
  eventByMedia: new Map<string, FixtureEvent>(),
  eventByHash: new Map<string, FixtureEvent>(),
  /** Description text -> the listing it is the description of. */
  listingByText: new Map<string, string>(),
  /** How many times the single listing call was made, and what it was given. */
  analysisCalls: [] as { text: string; images: number; feedback?: string }[],
  /** Replies the admin would have received on WhatsApp, in send order. */
  replies: [] as string[],
  errors: [] as { scope?: string; message: string }[],
  /** Media ids whose Meta download should fail (failure injection). */
  failMedia: new Set<string>(),
  /** WhatsApp refuses every reply we try to send. */
  failReplies: false,
  /** Thumbnails cannot be fetched: no pixel facts for anything. */
  failThumbnails: false,
  /** Replaces the oracle's answer (misbehaving-model tests). */
  analysisOverride: null as null | ((input: Parameters<NonNullable<AiProvider["analyzeListing"]>>[0], honest: ListingAnalysis) => ListingAnalysis | null | Promise<ListingAnalysis | null>),
};

export function attachStream(events: FixtureEvent[]) {
  state.truthByMedia.clear();
  state.eventByMedia.clear();
  state.eventByHash.clear();
  state.listingByText.clear();
  for (const event of events) {
    if (event.type === "text") { if (event.text) state.listingByText.set(event.text, event.truth.listing); continue; }
    state.truthByMedia.set(mediaId(event.id), event.truth);
    state.eventByMedia.set(mediaId(event.id), event);
    state.eventByHash.set(publicIdHash(event.id), event);
  }
}

export const serverMock = {
  createAdminClient: () => {
    if (!state.pg) throw new Error("ingest-eval: no database attached");
    return supabaseShim(state.pg);
  },
};

export const reportMock = {
  reportError: (error: unknown, context?: { scope?: string }) => {
    state.errors.push({ scope: context?.scope, message: error instanceof Error ? error.message : String(error) });
  },
};

// Mirrors the real provider's limits so a cap the provider has is a cap the replay has.
const METADATA_IMAGE_CAP = 4;
const COLOUR_IMAGE_CAP = 20;

function eventOfUrl(url: string): FixtureEvent | undefined {
  const match = /whatsapp\/inbox\/([0-9a-f]{64})/.exec(url);
  return match ? state.eventByHash.get(match[1]) : undefined;
}
const truthOfUrl = (url: string): Truth | undefined => eventOfUrl(url)?.truth;
const titleCase = (value: string) => value.split(" ").map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(" ");

/**
 * What a correct, well-behaved model would say, from ground truth: which images belong, which is the
 * collage, the colours, and copy that keeps to the admin's words. It only ever sees what it is shown.
 */
function honestAnalysis(input: Parameters<NonNullable<AiProvider["analyzeListing"]>>[0]): ListingAnalysis {
  const mine = state.listingByText.get(input.adminText);
  const theirs = input.otherText ? state.listingByText.get(input.otherText) : undefined;
  const shown = input.images.map((image) => ({ id: image.id, truth: truthOfUrl(image.url) }));
  const own = shown.filter((image) => image.truth?.listing === mine);
  const singles = own.filter((image) => image.truth?.role !== "collage" && image.truth?.role !== "video");
  const hasCollage = own.some((image) => image.truth?.role === "collage");
  const groups = new Map<string, string[]>();
  for (const image of singles) {
    const colour = image.truth?.colour;
    if (!colour || colour === "default" || colour === "multi") continue;
    groups.set(colour, [...(groups.get(colour) ?? []), image.id]);
  }

  const description = parseCollectionMessage(input.adminText).description;
  const sentence = describeFromAdminText(description);
  const generic = input.deterministicName === GENERIC_NAME;
  const single = groups.size === 1 && !hasCollage ? [...groups.keys()][0] : null;
  const named = new RegExp(`\\b${single?.split(" ").pop()}\\b`, "i").test(input.deterministicName);
  // A well-behaved model keeps to 3-7 words: it leads with the colour only when there is room.
  const coloured = single && !named ? `${titleCase(single)} ${input.deterministicName}` : input.deterministicName;
  const name = generic ? "Saree with Woven Border" : coloured.split(" ").length <= 7 ? coloured : input.deterministicName;
  const copy = !sentence ? null : isTitleOnly(description)
    ? `${sentence} The photographs show the full length of the saree, its border and the pallu.\n\nIt drapes easily for long celebrations and for quieter gatherings at home. More photographs and details of this piece can be shared on request.`
    : `${sentence} The photographs show the full length of the saree, its border and the pallu, so the pattern and the way it falls can be seen clearly.\n\nIt is a piece chosen for the catalogue with care, and it drapes easily for long celebrations and for quieter gatherings at home. More photographs and details of this piece can be shared on request, and each one is checked by hand before it is sent out.`;

  return {
    name: { value: name, confidence: 0.9 },
    ...(copy ? { description: { value: copy, confidence: 0.9 } } : {}),
    tagline: { value: "A saree for celebrations and quiet days", confidence: 0.9 },
    highlights: { value: ["Border shown in close-up", "Pallu shown in full", "Photographed at full length"], confidence: 0.9 },
    ...(groups.size ? { colour_groups: { value: [...groups].map(([colour, image_ids]) => ({ colour, image_ids })), confidence: 0.9 } } : {}),
    ...(singles[0] ? { cover_image_id: { value: singles[0].id, confidence: 0.9 } } : {}),
    images: shown.map(({ id, truth }) => ({
      id, collage: truth?.role === "collage", shot_type: truth?.role === "collage" ? "other" : "full", quality: [],
      belongs: truth?.listing === mine ? "this" : theirs && truth?.listing === theirs ? "other" : "neither",
      belongs_confidence: 0.95,
    })),
  };
}

const oracle: AiProvider = {
  name: "oracle",
  isConfigured: () => true,
  async suggestProductMetadata(input): Promise<ProductMetadataSuggestions | null> {
    const seen = input.imageUrls.slice(0, METADATA_IMAGE_CAP).map(truthOfUrl).filter((t): t is Truth => !!t);
    const colour = seen.find((t) => t.colour && t.colour !== "multi" && t.colour !== "default")?.colour;
    const name = `${colour ? `${colour[0].toUpperCase()}${colour.slice(1)} ` : ""}Saree with Woven Border`;
    return {
      name: { value: name, confidence: 0.9 },
      display_name: { value: name, confidence: 0.9 },
      colour: colour ? { value: colour, confidence: 0.9 } : undefined,
      highlights: { value: ["Woven border detail", "Lightweight easy drape", "Comes with blouse piece"], confidence: 0.9 },
    };
  },
  async classifyCollection() { return []; },
  async suggestColorVariants(input): Promise<ColorVariantSuggestion[] | null> {
    const groups = new Map<string, string[]>();
    let collage: string | null = null;
    for (const image of input.images.slice(0, COLOUR_IMAGE_CAP)) {
      const truth = state.truthByMedia.get(image.client_upload_id);
      if (!truth) continue;
      if (truth.role === "collage") { collage = image.client_upload_id; continue; }
      const colour = truth.colour && truth.colour !== "multi" ? truth.colour : "default";
      groups.set(colour, [...(groups.get(colour) ?? []), image.client_upload_id]);
    }
    const list = [...groups.entries()].map(([color, ids], index): ColorVariantSuggestion => ({
      color, color_hex: null, asset_client_upload_ids: ids, confidence: 0.9, is_best_display: index === 0,
    }));
    if (collage && list[0]) list[0].asset_client_upload_ids.unshift(collage);
    return list.length ? list : null;
  },
  async analyzeListing(input): Promise<ListingAnalysis | null> {
    state.analysisCalls.push({ text: input.adminText, images: input.images.length, ...(input.feedback ? { feedback: input.feedback } : {}) });
    const honest = honestAnalysis(input);
    return state.analysisOverride ? state.analysisOverride(input, honest) : honest;
  },
};

export const aiMock = {
  getAiProvider: (): AiProvider => (state.ai === "oracle" ? oracle : nullAiProvider),
};

// ── Synthetic photos ────────────────────────────────────────────────────────
// A 32x32 image per event: one body colour (four stripes for a collage) under a blocky brightness
// pattern that is unique to the photo. A recompressed near-duplicate shares its original's pattern.
const PALETTE: Record<string, [number, number, number]> = {
  pink: [240, 100, 170], red: [215, 30, 35], purple: [140, 50, 190], indigo: [70, 40, 170], teal: [20, 150, 150],
  mustard: [215, 170, 30], ivory: [235, 225, 195], blue: [40, 90, 215], peach: [245, 175, 140], green: [40, 160, 70],
  maroon: [120, 20, 40], navy: [25, 35, 110], "rani pink": [225, 40, 130], "bottle green": [20, 95, 60],
  wine: [110, 25, 60], lemon: [235, 225, 80], grey: [140, 140, 140], default: [150, 150, 150], multi: [150, 150, 150],
};
const STRIPES: [number, number, number][] = [[215, 30, 35], [40, 160, 70], [40, 90, 215], [215, 190, 30]];
const thumbnails = new Map<string, Buffer>();

function seeded(text: string) {
  let a = createHash("sha256").update(text).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function thumbnailOf(event: FixtureEvent): Promise<Buffer> {
  const pattern = event.truth.role === "near_dup" || event.truth.role === "dup" ? event.truth.of ?? event.id : event.id;
  const key = `${pattern}|${event.truth.role}|${event.truth.colour}`;
  const cached = thumbnails.get(key);
  if (cached) return cached;
  const size = 32, block = 4;
  const random = seeded(pattern);
  const shade = Array.from({ length: (size / block) ** 2 }, () => 0.55 + random() * 0.45);
  const noise = event.truth.role === "near_dup" ? seeded(`${event.id}:noise`) : null;
  const pixels = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const base = event.truth.role === "collage" ? STRIPES[Math.floor((x / size) * STRIPES.length)] : PALETTE[event.truth.colour ?? "default"] ?? PALETTE.default;
    const factor = shade[Math.floor(y / block) * (size / block) + Math.floor(x / block)] + (noise ? (noise() - 0.5) * 0.02 : 0);
    for (let c = 0; c < 3; c++) pixels[(y * size + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(base[c] * factor)));
  }
  const png = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  thumbnails.set(key, png);
  return png;
}

/** Meta Graph + Cloudinary, in memory. Anything else is a bug in the test. */
export function installFetch() {
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://graph.facebook.com/") && url.endsWith("/messages")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { text?: { body?: string } };
      if (state.failReplies) return json({ error: "outside the customer service window" }, 400);
      state.replies.push(body.text?.body ?? "");
      return json({ messages: [{ id: "wamid.reply" }] });
    }
    const lookup = /^https:\/\/graph\.facebook\.com\/v[\d.]+\/(mid\.[^?]+)\?/.exec(url);
    if (lookup) {
      if (state.failMedia.has(lookup[1])) return json({ error: "gone" }, 404);
      return json({ url: `https://lookaside.invalid/${lookup[1]}`, mime_type: "image/jpeg" });
    }
    if (url.startsWith("https://lookaside.invalid/")) {
      // The bytes Meta delivers: identical for an exact duplicate (the fixture's sha256 says which are).
      const event = state.eventByMedia.get(url.slice("https://lookaside.invalid/".length));
      return new Response(new Uint8Array(Buffer.from(event?.sha256 ?? url)), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (url.startsWith("https://api.cloudinary.com/") && init?.method !== "POST") return new Response("{}", { status: 404 });
    if (url.startsWith("https://api.cloudinary.com/") && init?.method === "POST") {
      const form = init.body as FormData;
      const publicId = String(form.get("public_id"));
      const kind = url.includes("/video/") ? "video" : "image";
      // A recompressed copy is the smaller file.
      const small = state.eventByHash.get(publicId.replace("whatsapp/inbox/", ""))?.truth.role === "near_dup";
      return json({
        secure_url: `https://res.cloudinary.com/${CLOUD}/${kind}/upload/v1/${publicId}.${kind === "video" ? "mp4" : "jpg"}`, public_id: publicId,
        width: small ? 900 : 1200, height: small ? 1200 : 1600, bytes: small ? 90_000 : 240_000,
      });
    }
    if (url.startsWith(`https://res.cloudinary.com/${CLOUD}/`)) {
      const event = eventOfUrl(url);
      if (!event || state.failThumbnails) return new Response("not found", { status: 404 });
      return new Response(new Uint8Array(await thumbnailOf(event)), { status: 200, headers: { "content-type": "image/png" } });
    }
    throw new Error(`ingest-eval: unexpected network call ${init?.method ?? "GET"} ${url}`);
  };
  return fetchStub as typeof fetch;
}

export function setEnv(adminNumbers: string) {
  Object.assign(process.env, {
    WHATSAPP_APP_SECRET: "secret", WHATSAPP_VERIFY_TOKEN: "verify", WHATSAPP_ACCESS_TOKEN: "token",
    WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_ADMIN_NUMBERS: adminNumbers, CRON_SECRET: "cron",
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: CLOUD, CLOUDINARY_API_KEY: "key", CLOUDINARY_API_SECRET: "secret",
  });
  delete process.env.ANTHROPIC_API_KEY;
}
