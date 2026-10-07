/**
 * Everything the replay replaces: Supabase (-> real local Postgres), Meta and
 * Cloudinary (-> an in-memory fetch), the AI provider (-> off, or an oracle that
 * answers from the fixtures' ground truth) and Sentry.
 *
 * Test files wire these in with vi.mock(..., async () => (await import("./lib/mocks")).xMock).
 */
import { createHash } from "node:crypto";
import type { Client } from "pg";
import type { AiProvider, ColorVariantSuggestion, ListingAnalysis, ProductMetadataSuggestions } from "@/lib/ai/types";
import { nullAiProvider } from "@/lib/ai/null-provider";
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
  /** Description text -> the listing it is the description of. */
  listingByText: new Map<string, string>(),
  /** How many times the single listing call was made, and what it was given. */
  analysisCalls: [] as { text: string; images: number }[],
  /** Replies the admin would have received on WhatsApp, in send order. */
  replies: [] as string[],
  errors: [] as { scope?: string; message: string }[],
  /** Media ids whose Meta download should fail (failure injection). */
  failMedia: new Set<string>(),
};

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

function truthOfUrl(url: string): Truth | undefined {
  const match = /whatsapp\/inbox\/([0-9a-f]{64})/.exec(url);
  if (!match) return undefined;
  for (const [media, truth] of state.truthByMedia) {
    if (createHash("sha256").update(`wamid.${media.replace(/^mid\./, "")}`).digest("hex") === match[1]) return truth;
  }
  return undefined;
}

/** Answers from ground truth: what a correct, well-behaved model would say. */
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
    state.analysisCalls.push({ text: input.adminText, images: input.images.length });
    const mine = state.listingByText.get(input.adminText);
    const theirs = input.otherText ? state.listingByText.get(input.otherText) : undefined;
    return {
      images: input.images.map((image) => {
        const truth = truthOfUrl(image.url);
        return {
          id: image.id, collage: truth?.role === "collage", shot_type: truth?.role === "collage" ? "other" : "full", quality: [],
          belongs: truth?.listing === mine ? "this" : theirs && truth?.listing === theirs ? "other" : "neither",
          belongs_confidence: 0.95,
        };
      }),
    };
  },
};

export const aiMock = {
  getAiProvider: (): AiProvider => (state.ai === "oracle" ? oracle : nullAiProvider),
};

/** Meta Graph + Cloudinary, in memory. Anything else is a bug in the test. */
export function installFetch() {
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://graph.facebook.com/") && url.endsWith("/messages")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { text?: { body?: string } };
      state.replies.push(body.text?.body ?? "");
      return json({ messages: [{ id: "wamid.reply" }] });
    }
    const lookup = /^https:\/\/graph\.facebook\.com\/v[\d.]+\/(mid\.[^?]+)\?/.exec(url);
    if (lookup) {
      if (state.failMedia.has(lookup[1])) return json({ error: "gone" }, 404);
      return json({ url: `https://lookaside.invalid/${lookup[1]}`, mime_type: "image/jpeg" });
    }
    if (url.startsWith("https://lookaside.invalid/")) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (url.startsWith("https://api.cloudinary.com/") && init?.method !== "POST") return new Response("{}", { status: 404 });
    if (url.startsWith("https://api.cloudinary.com/") && init?.method === "POST") {
      const form = init.body as FormData;
      const publicId = String(form.get("public_id"));
      const kind = url.includes("/video/") ? "video" : "image";
      return json({ secure_url: `https://res.cloudinary.com/${CLOUD}/${kind}/upload/v1/${publicId}.${kind === "video" ? "mp4" : "jpg"}`, public_id: publicId });
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
