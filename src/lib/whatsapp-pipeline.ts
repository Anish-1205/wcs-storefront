import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { isRenderableCloudinaryUrl, signUpload } from "@/lib/cloudinary";
import { deriveProductName, parseCollectionMessage } from "@/lib/whatsapp-caption";
import { reportError } from "@/lib/report-error";
import { getAiProvider } from "@/lib/ai";
import { ingestConfig, type IngestConfig } from "@/lib/whatsapp-config";
import { requestAnalysis, textKey, type StoredAnalysis } from "@/lib/whatsapp-analysis";
import { decideReview, type ReviewHint, type ReviewMedia } from "@/lib/whatsapp-review";
import { assemblePlan, type ListingPlan, type PlanContext } from "@/lib/whatsapp-plan";
import { computeVisuals } from "@/lib/whatsapp-visual";
import type { CurationItem } from "@/lib/whatsapp-curation";
import type { CategoryOption, CollectionOption } from "@/lib/whatsapp-enrichment";

// No new message is started after this point in an invocation, leaving the
// rest of maxDuration for the one in hand (a video download + upload, or the
// AI calls behind a finalize) to finish. Whatever is left is drained by the
// next delivery, the lingering invocation or the sweep.
export const DRAIN_BUDGET_MS = 35_000;
export const DRAIN_POLL_MS = 400;
const MAX_DRAIN_STEPS = 60;
export const MAX_DRAIN_POLLS = Math.floor(DRAIN_BUDGET_MS / DRAIN_POLL_MS);
// Kept back at the end of an invocation for the message in hand.
const WORK_RESERVE_MS = 25_000;
const MAX_LINGER_ROUNDS = 8;

const GRAPH_API_VERSION = "v20.0";

export type MediaKind = "image" | "video";

type MetaMediaResponse = {
  url?: string;
  mime_type?: string;
  sha256?: string;
  file_size?: number;
};

type CloudinaryUploadResponse = {
  secure_url?: string;
  public_id?: string;
  asset_id?: string;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
};

type PendingMediaItem = {
  media_id: string;
  message_id: string;
  url: string;
  kind: MediaKind;
  received_at: string;
  /** Of the bytes Meta delivered: what "the same photo twice" means. Absent on media saved before this was recorded. */
  sha256?: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
};

/** Stage information is retained in the recoverable inbox error. */
class PipelineStageError extends Error {
  constructor(
    public readonly stage: "media_download" | "media_upload" | "db_write",
    message: string,
  ) {
    super(message);
    this.name = "PipelineStageError";
  }
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getCloudName(): string {
  return process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? process.env.CLOUDINARY_CLOUD_NAME ?? "";
}

function getWhatsAppToken(): string {
  return requireEnv("WHATSAPP_ACCESS_TOKEN");
}

function getWhatsAppPhoneNumberId(): string {
  return requireEnv("WHATSAPP_PHONE_NUMBER_ID");
}

export function getWhatsAppVerifyToken(): string {
  return requireEnv("WHATSAPP_VERIFY_TOKEN");
}


/** "…7890" — enough to correlate a log line with a sender, not enough to be PII. */
function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length <= 4 ? "…" : `…${digits.slice(-4)}`;
}

export type InboxMessage = {
  message_id: string;
  sender_phone: string;
  contact_name: string | null;
  message_timestamp: string;
  caption: string;
  media_id: string | null;
  kind: MediaKind | null;
  mode: "media" | "finalize" | "numbered";
  public_id: string;
  raw_message: unknown;
};
type ClaimedMessage = {
  idle?: boolean;
  in_flight?: boolean;
  token: string;
  attempts: number;
  asset: PendingMediaItem | null;
  pending_media: PendingMediaItem[];
  /** Why the listing holds this media (migration 029), e.g. "6 sent after your description". */
  grouping?: string | null;
  /** Grouping facts per photo/video (migration 030). Absent before that migration. */
  media_info?: MediaInfo[] | null;
  /** Present when the listing holds media the grouping could not place: review it instead of building it. */
  review?: { other: { message_id: string; text: string } | null } | null;
  /** Seconds the description came after its photos, when it was late (migration 030). */
  late_by?: number | null;
  late_review_seconds?: number | null;
  answer_timeout_seconds?: number | null;
  /** The AI answer already obtained for this listing, if any. */
  analysis?: StoredAnalysis | null;
  /** The plan a previous attempt built, and the inputs it was built from. */
  stored_plan?: ListingPlan | null;
  plan_key?: string | null;
  payload: InboxMessage;
};
type MediaInfo = {
  message_id: string; reason: string | null; confidence: string | null; burst: number | null;
  ts: number; decided: string | null; sha256: string | null;
};
type Taxonomy = { categories: CategoryOption[]; collections: CollectionOption[] };

/** The closed lists the AI may choose a category and collections from. A failed lookup is an empty list, never an error. */
async function loadTaxonomy(supabase: ReturnType<typeof createAdminClient>): Promise<Taxonomy> {
  const [{ data: categoriesData, error: categoriesError }, { data: collectionsData, error: collectionsError }] =
    await Promise.all([
      supabase.from("categories").select("id, slug, name, description"),
      supabase.from("collections").select("id, name, description"),
    ]);
  if (categoriesError) console.warn("whatsapp webhook: categories lookup failed, skipping auto-category", categoriesError.message);
  if (collectionsError) console.warn("whatsapp webhook: collections lookup failed, skipping auto-tagging", collectionsError.message);
  return { categories: (categoriesData ?? []) as CategoryOption[], collections: (collectionsData ?? []) as CollectionOption[] };
}

/**
 * A listing holds media the grouping could not place on its own (two
 * descriptions want the same burst, or an older burst sits before this
 * description's own). One AI call, when there is an AI, looks at the photos;
 * the outcome is a decision per photo or a question for the sender. With no
 * usable answer the sender is asked: nothing is merged on a guess.
 */
async function reviewListing(supabase: ReturnType<typeof createAdminClient>, claimed: ClaimedMessage, pending: PendingMediaItem[]) {
  const m = claimed.payload;
  const config = ingestConfig();
  const info = new Map((claimed.media_info ?? []).map((row) => [row.message_id, row]));
  const media: ReviewMedia[] = pending.filter((item) => info.has(item.message_id)).map((item) => {
    const row = info.get(item.message_id)!;
    return { message_id: item.message_id, kind: item.kind, reason: row.reason, confidence: row.decided ? "decided" : row.confidence, ts: row.ts };
  }).sort((a, b) => a.ts - b.ts || (a.message_id < b.message_id ? -1 : 1));
  const byId = new Map(pending.map((item) => [item.message_id, item]));

  let analysis: StoredAnalysis | null = null;
  const aiProvider = getAiProvider();
  if (aiProvider.isConfigured() && aiProvider.analyzeListing) {
    const { categories, collections } = await loadTaxonomy(supabase);
    analysis = await requestAnalysis({
      provider: aiProvider, text: m.caption, otherText: claimed.review?.other?.text ?? null,
      deterministicName: deriveProductName(parseCollectionMessage(m.caption).description),
      items: media.map((item) => ({ message_id: item.message_id, kind: item.kind, url: byId.get(item.message_id)!.url })),
      categories, collections, config,
    });
  }
  const hints = analysis ? new Map<string, ReviewHint>(analysis.result.images.map((image) =>
    [analysis!.ids[image.id], { belongs: image.belongs, confidence: image.belongs_confidence }])) : null;
  const outcome = decideReview({
    descriptionId: m.message_id, text: m.caption, other: claimed.review?.other ?? null, media, hints,
    threshold: config.boundaryConfidence, answerTimeoutSeconds: claimed.answer_timeout_seconds ?? 600,
  });
  return { ...outcome, ...(analysis ? { analysis } : {}) };
}

async function downloadMediaFromMeta(
  mediaId: string,
  kind: MediaKind,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const accessToken = getWhatsAppToken();

  let metadataResponse: Response;
  try {
    metadataResponse = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}` +
        "?fields=url,mime_type,sha256,file_size",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch (error) {
    throw new PipelineStageError(
      "media_download",
      `Meta media lookup errored: ${error instanceof Error ? error.message : error}`,
    );
  }

  if (!metadataResponse.ok) {
    const errorText = await metadataResponse.text();
    throw new PipelineStageError(
      "media_download",
      `Meta media lookup failed (${metadataResponse.status}): ${errorText}`,
    );
  }

  const media = (await metadataResponse.json()) as MetaMediaResponse;
  if (!media.url) {
    throw new PipelineStageError("media_download", "Meta did not return a downloadable media URL");
  }

  let binaryResponse: Response;
  try {
    binaryResponse = await fetch(media.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    throw new PipelineStageError(
      "media_download",
      `Meta media download errored: ${error instanceof Error ? error.message : error}`,
    );
  }

  if (!binaryResponse.ok) {
    const errorText = await binaryResponse.text();
    throw new PipelineStageError(
      "media_download",
      `Meta media download failed (${binaryResponse.status}): ${errorText}`,
    );
  }

  const arrayBuffer = await binaryResponse.arrayBuffer();
  const fallbackMime = kind === "video" ? "video/mp4" : "image/jpeg";
  const mimeType = binaryResponse.headers.get("content-type") ?? media.mime_type ?? fallbackMime;

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType,
  };
}

type UploadedAsset = { secureUrl: string; publicId: string; width?: number; height?: number; bytes?: number };

async function uploadToCloudinary(params: {
  buffer: Buffer;
  mimeType?: string;
  kind: MediaKind;
  publicId: string;
}): Promise<UploadedAsset> {
  const cloudName = getCloudName();
  const apiKey = requireEnv("CLOUDINARY_API_KEY");
  requireEnv("CLOUDINARY_API_SECRET");

  if (!cloudName) {
    throw new PipelineStageError("media_upload", "Missing Cloudinary cloud name environment variable");
  }

  const payloadBuffer = Buffer.isBuffer(params.buffer) ? params.buffer : Buffer.from(params.buffer);
  const fallbackMime = params.kind === "video" ? "video/mp4" : "image/jpeg";
  const blob = new Blob([new Uint8Array(payloadBuffer)], {
    type: params.mimeType || fallbackMime,
  });
  const timestamp = Math.floor(Date.now() / 1000);

  let signed: Awaited<ReturnType<typeof signUpload>>;
  try {
    signed = await signUpload({ timestamp, public_id: params.publicId, overwrite: "false" }, params.kind);
  } catch (error) {
    throw new PipelineStageError(
      "media_upload",
      `Cloudinary signing failed: ${error instanceof Error ? error.message : error}`,
    );
  }

  const formData = new FormData();
  formData.append("file", blob, params.kind === "video" ? "whatsapp-upload.mp4" : "whatsapp-upload.jpg");
  formData.append("api_key", apiKey);
  formData.append("timestamp", String(timestamp));
  formData.append("signature", signed.signature);
  formData.append("public_id", params.publicId);
  formData.append("overwrite", "false");

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(signed.uploadUrl, { method: "POST", body: formData });
  } catch (error) {
    throw new PipelineStageError(
      "media_upload",
      `Cloudinary upload errored: ${error instanceof Error ? error.message : error}`,
    );
  }

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new PipelineStageError("media_upload", `Cloudinary upload failed (${uploadResponse.status}): ${errorText}`);
  }

  const uploaded = (await uploadResponse.json()) as CloudinaryUploadResponse;
  if (!uploaded.secure_url) {
    throw new PipelineStageError("media_upload", "Cloudinary response did not include secure_url");
  }

  return {
    secureUrl: uploaded.secure_url,
    publicId: uploaded.public_id ?? params.publicId,
    width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes,
  };
}

async function findUploadedAsset(publicId: string, kind: MediaKind): Promise<UploadedAsset | null> {
  const credentials = Buffer.from(`${requireEnv("CLOUDINARY_API_KEY")}:${requireEnv("CLOUDINARY_API_SECRET")}`).toString("base64");
  const response = await fetch(`https://api.cloudinary.com/v1_1/${getCloudName()}/resources/${kind}/upload/${encodeURIComponent(publicId)}`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new PipelineStageError("media_upload", `Cloudinary recovery lookup failed (${response.status})`);
  const asset = await response.json() as CloudinaryUploadResponse;
  if (!asset.secure_url) throw new PipelineStageError("media_upload", "Cloudinary recovery lookup returned no URL");
  return { secureUrl: asset.secure_url, publicId: asset.public_id ?? publicId, width: asset.width, height: asset.height, bytes: asset.bytes };
}

async function sendWhatsAppReply(to: string, text: string): Promise<void> {
  const accessToken = getWhatsAppToken();
  const phoneNumberId = getWhatsAppPhoneNumberId();
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const requestBody = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: false,
      body: text,
    },
  };

  // Never log accessToken, the recipient's full number, or the message body:
  // logs are retained and exported far more widely than the database this
  // data otherwise lives in. phoneNumberId identifies our own WhatsApp
  // account (not a credential) and is logged in full so it can be diff'd
  // against Meta's dashboard; the recipient is masked to its last 4 digits,
  // which is enough to correlate a delivery with a sender during triage.
  console.log(
    `whatsapp webhook: sending reply — url=${url} to=${maskPhone(to)} ` +
      `(len=${to.length}) bodyChars=${text.length}`,
  );

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`WhatsApp reply failed (${response.status}): ${responseText}`);
  }

  // Meta echoes the recipient's wa_id in the success body — log only the status.
  console.log(`whatsapp webhook: reply sent to ${maskPhone(to)} (${response.status})`);
}

/** Changes whenever anything a plan is built from changes: the text, the media, or the limits. */
function planKey(text: string, pending: PendingMediaItem[], config: IngestConfig): string {
  return createHash("sha256").update(JSON.stringify([
    text, pending.map((item) => item.url).sort(), config.maxImages, config.maxVideos, config.maxColours, config.nearDuplicateBits,
  ])).digest("hex");
}

/**
 * Builds the plan for one closed listing: what it is called, what it says,
 * which media it shows and which it hides.
 *
 * At most one AI call (plus one retry when its name or description fails
 * validation), each limited to INGEST_AI_TIMEOUT_MS, alongside the thumbnail
 * hashing. Neither can fail the listing: with no answer the deterministic
 * name, description and curation stand, field by field. The result is stored
 * with the listing before it is applied, so a retry of this message repeats
 * it exactly instead of asking again.
 */
async function buildProductPlan(
  supabase: ReturnType<typeof createAdminClient>, claimed: ClaimedMessage, pending: PendingMediaItem[],
): Promise<ListingPlan | { variants: never[]; reply: string }> {
  // A description only runs once its listing is closed with media (migration
  // 029), so this is the case where none of that media could be saved.
  if (!pending.length) return { variants: [], reply: "No photos or videos could be saved for this description, so no listing was created. Please send the photos/videos and the description again." };
  const text = claimed.payload.caption;
  const config = ingestConfig();
  const key = planKey(text, pending, config);
  if (claimed.stored_plan && claimed.plan_key === key) return claimed.stored_plan;

  const info = new Map((claimed.media_info ?? []).map((row) => [row.message_id, row]));
  const items: CurationItem[] = pending.map((item) => ({
    ...item, sha256: item.sha256 ?? info.get(item.message_id)?.sha256 ?? null, visual: null,
  }));

  // The AI is shown photos only, and each distinct photo once.
  const seen = new Set<string>();
  const forAi = items.filter((item) => item.kind === "image" && !(item.sha256 && seen.has(item.sha256)) && (!item.sha256 || !!seen.add(item.sha256)));
  const aiProvider = getAiProvider();
  const aiReady = aiProvider.isConfigured() && !!aiProvider.analyzeListing && forAi.length > 0;
  let analysis = claimed.analysis && claimed.analysis.text === textKey(text) ? claimed.analysis : null;
  const taxonomy = analysis || aiReady ? await loadTaxonomy(supabase) : { categories: [], collections: [] };
  const deterministicName = deriveProductName(parseCollectionMessage(text).description);
  const ask = (feedback?: string) => requestAnalysis({
    provider: aiProvider, text, deterministicName, feedback, config,
    items: forAi.map((item) => ({ message_id: item.message_id, url: item.url, kind: item.kind })),
    categories: taxonomy.categories, collections: taxonomy.collections,
  });

  const [visuals, fresh] = await Promise.all([
    computeVisuals(items.map((item) => item.url), config.hashTimeoutMs).catch(() => new Map()),
    !analysis && aiReady ? ask() : Promise.resolve(null),
  ]);
  analysis = analysis ?? fresh;
  for (const item of items) item.visual = visuals.get(item.url) ?? null;

  const context = (current: StoredAnalysis | null): PlanContext => ({
    text, items, analysis: current, categories: taxonomy.categories, collections: taxonomy.collections,
    lateBy: claimed.late_by ?? null, lateLimit: claimed.late_review_seconds ?? 30,
    groupedByAi: (claimed.media_info ?? []).some((row) => row.reason === "ai_match"), config,
  });
  let { plan, problems } = assemblePlan(context(analysis));
  if (problems.length && analysis && !analysis.retried && aiReady) {
    // One retry, told what was wrong. Whatever still fails falls back to the deterministic value.
    const again = await ask(problems.join("; "));
    analysis = { ...analysis, retried: true, result: { ...analysis.result, ...(again ? { name: again.result.name, description: again.result.description } : {}) } };
    ({ plan, problems } = assemblePlan(context(analysis)));
  }
  if (problems.length) console.warn(`whatsapp webhook: AI copy rejected, deterministic values used (${problems.join("; ")})`);

  // Pixel facts are working data, not part of what is stored.
  const stored: ListingPlan = { ...plan, variants: plan.variants.map((variant) => ({ ...variant, media: variant.media.map(({ visual: _visual, ...media }) => media) })) };
  // Best effort: without the checkpoint a retry rebuilds the plan (reusing the stored analysis when there is one).
  await rpc(supabase, "checkpoint_whatsapp_plan", {
    p_message_id: claimed.payload.message_id, p_token: claimed.token, p_key: key, p_analysis: analysis, p_plan: stored,
  }).catch((error) => console.warn("whatsapp webhook: plan checkpoint failed", error instanceof Error ? error.message : error));
  return stored;
}

export async function rpc<T>(supabase: ReturnType<typeof createAdminClient>, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new PipelineStageError("db_write", `${name}: ${error.message}`);
  return data as T;
}

async function runClaimed(supabase: ReturnType<typeof createAdminClient>, claimed: ClaimedMessage) {
  const m = claimed.payload;
  const messageId = m.message_id;
  try {
    let asset = claimed.asset;
    if (m.kind && m.media_id && !asset) {
      let uploaded: UploadedAsset | null = claimed.attempts > 1 ? await findUploadedAsset(m.public_id, m.kind) : null;
      let sha256: string | null = null;
      if (!uploaded) {
        const { buffer, mimeType } = await downloadMediaFromMeta(m.media_id, m.kind);
        sha256 = createHash("sha256").update(buffer).digest("hex");
        uploaded = await uploadToCloudinary({ buffer, mimeType, kind: m.kind, publicId: m.public_id });
      }
      // Every URL that reaches variant_images must be one the site can render
      // (an image, or a video a poster frame can be derived from).
      if (!isRenderableCloudinaryUrl(uploaded.secureUrl, m.kind, getCloudName())) {
        throw new PipelineStageError("media_upload", `Cloudinary returned a URL that cannot be rendered as ${m.kind}: ${uploaded.secureUrl}`);
      }
      // The same photo forwarded twice is uploaded twice: each message has its own idempotent public_id,
      // and whether two copies are duplicates depends on the listing they end up in (the same photo in
      // two listings is legitimate). So nothing is skipped here; the duplicate is hidden at finalize.
      asset = { media_id: m.media_id, message_id: m.message_id, url: uploaded.secureUrl,
        kind: m.kind, received_at: m.message_timestamp,
        ...(sha256 ? { sha256 } : {}),
        ...(uploaded.width && uploaded.height ? { width: uploaded.width, height: uploaded.height } : {}),
        ...(uploaded.bytes ? { bytes: uploaded.bytes } : {}) };
      await rpc(supabase, "checkpoint_whatsapp_asset", { p_message_id: messageId, p_token: claimed.token,
        p_asset: { ...asset, public_id: uploaded.publicId ?? m.public_id } });
    }
    if (m.mode === "finalize" && claimed.review) {
      const outcome = await reviewListing(supabase, claimed, [...claimed.pending_media, ...(asset ? [asset] : [])]);
      await rpc(supabase, "resolve_whatsapp_review", { p_message_id: messageId, p_token: claimed.token, p_outcome: outcome });
      return;
    }
    const plan = m.mode === "finalize"
      ? await buildProductPlan(supabase, claimed, [...claimed.pending_media, ...(asset ? [asset] : [])])
      : { reply: m.mode === "numbered" ? `Saved photo ${m.caption}.` : null };
    await rpc(supabase, "complete_whatsapp_message", { p_message_id: messageId, p_token: claimed.token, p_plan: plan });
  } catch (error) {
    // If recording this failure also fails, the committed claim remains visible
    // and becomes reclaimable after its lease expires.
    await rpc(supabase, "fail_whatsapp_message", { p_message_id: messageId, p_token: claimed.token,
      p_error: error instanceof Error ? error.message : String(error) }).catch((recordError) =>
        reportError(recordError, { scope: "whatsapp-failure-record", messageId }));
    throw error;
  }
}

/**
 * Send every reply that is due for this sender. Replies are leased in SQL, so
 * concurrent invocations never double-send, and a failed send is retried a
 * bounded number of times by later drains. Never throws: a reply that cannot
 * be delivered must not take the webhook (or the rest of the queue) with it.
 */
export async function deliverReplies(supabase: ReturnType<typeof createAdminClient>, sender: string) {
  try {
    const due = await rpc<{ message_id: string; sender_phone: string; reply: string; state: string; last_error: string | null }[]>(
      supabase, "claim_whatsapp_replies", { p_sender_phone: sender });
    for (const item of due ?? []) {
      if (item.state === "dead") {
        reportError(new Error(`WhatsApp message dead-lettered: ${item.last_error ?? "unknown error"}`),
          { scope: "whatsapp-dead-letter", messageId: item.message_id });
      }
      let sent = false;
      try {
        await sendWhatsAppReply(item.sender_phone, item.reply);
        sent = true;
      } catch (error) {
        reportError(error, { scope: "whatsapp-reply", messageId: item.message_id });
      }
      await rpc(supabase, "finish_whatsapp_reply", { p_message_id: item.message_id, p_sent: sent });
    }
  } catch (error) {
    reportError(error, { scope: "whatsapp-reply" });
  }
}

/**
 * Work through everything runnable for a sender — not just the messages this
 * delivery carried. A message left behind by a busy, failed or killed
 * invocation is picked up here by whichever delivery comes next, instead of
 * waiting on Meta to redeliver that exact message. Returns whether another
 * worker is still mid-message for this sender.
 */
export async function drainSender(supabase: ReturnType<typeof createAdminClient>, sender: string, deadline: number) {
  for (let step = 0; step < MAX_DRAIN_STEPS && Date.now() < deadline; step++) {
    const claimed = await rpc<ClaimedMessage>(supabase, "claim_next_whatsapp_message", { p_sender_phone: sender });
    if (claimed.idle) return Boolean(claimed.in_flight);
    try {
      await runClaimed(supabase, claimed);
    } catch (error) {
      reportError(error, { scope: "whatsapp-processing", messageId: claimed.payload.message_id });
    }
    await deliverReplies(supabase, sender);
  }
  return false;
}

/** True once none of these messages still needs a redelivery to make progress. */
export async function isSettled(supabase: ReturnType<typeof createAdminClient>, messageIds: string[]) {
  return rpc<boolean>(supabase, "whatsapp_settled", { p_message_ids: messageIds });
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stay alive past the response to do what no new webhook will trigger: send a
 * held-back acknowledgement, close a description-first listing once its
 * photos have gone quiet, retry a message after its backoff. Only deadlines
 * that fall inside this invocation are waited for; the sender's next message
 * and the sweep cover the rest. Never throws.
 */
export async function lingerSender(supabase: ReturnType<typeof createAdminClient>, sender: string, stopAt: number, sleep = wait) {
  try {
    let overdue = 0;
    for (let round = 0; round < MAX_LINGER_ROUNDS; round++) {
      const wake = await rpc<number | null>(supabase, "whatsapp_next_wake", { p_sender_phone: sender });
      if (wake === null) return;
      const waitMs = Math.max(0, Math.ceil(wake * 1000)) + 250;
      if (Date.now() + waitMs > stopAt - WORK_RESERVE_MS) return;
      // Overdue twice running: whatever is waiting is not something a sweep can move.
      overdue = wake <= 0 ? overdue + 1 : 0;
      if (overdue > 1) return;
      await sleep(waitMs);
      await rpc(supabase, "whatsapp_sweep", { p_sender_phone: sender });
      await drainSender(supabase, sender, stopAt - WORK_RESERVE_MS);
      await deliverReplies(supabase, sender);
    }
  } catch (error) {
    reportError(error, { scope: "whatsapp-linger" });
  }
}

/**
 * Regroup and drain every sender with anything open. This is what a scheduler
 * calls (/api/whatsapp/sweep): it applies quiet periods and timeouts and
 * resumes work left by a killed invocation without waiting for that sender's
 * next message.
 */
export async function sweepSenders(supabase: ReturnType<typeof createAdminClient>, stopAt: number) {
  const senders = await rpc<string[]>(supabase, "whatsapp_sweep", { p_sender_phone: null });
  for (const sender of senders ?? []) {
    if (Date.now() >= stopAt - WORK_RESERVE_MS) break;
    await drainSender(supabase, sender, stopAt - WORK_RESERVE_MS);
    await deliverReplies(supabase, sender);
  }
  return (senders ?? []).length;
}
