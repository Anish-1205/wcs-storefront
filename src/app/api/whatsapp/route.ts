import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { signUpload } from "@/lib/cloudinary";
import {
  isAllowedWhatsAppAdmin,
  MAX_WEBHOOK_BYTES,
  verifyWhatsAppSignature,
} from "@/lib/webhook-security";
import { deriveProductName, generateProductSKU, parseCollectionMessage } from "@/lib/whatsapp-caption";
import { slugify } from "@/lib/utils";
import { reportError } from "@/lib/report-error";
import { getAiProvider } from "@/lib/ai";
import {
  enrichWhatsAppProduct,
  resolveWhatsAppColorVariants,
  type CategoryOption,
  type CollectionOption,
  type ColorVariantSplit,
  type ProductEnrichment,
} from "@/lib/whatsapp-enrichment";

export const runtime = "nodejs";
// Explicit so the limit is a decision, not a plan default. The inbox lease
// (migration 028, 2 minutes) is sized to outlive this.
export const maxDuration = 60;

// No new message is started after this point in an invocation, leaving the
// rest of maxDuration for the one in hand (a video download + upload, or the
// AI calls behind a finalize) to finish. Whatever is left is drained by the
// next delivery or message from that sender.
const DRAIN_BUDGET_MS = 35_000;
const DRAIN_POLL_MS = 400;
const MAX_DRAIN_STEPS = 60;
const MAX_DRAIN_POLLS = Math.floor(DRAIN_BUDGET_MS / DRAIN_POLL_MS);
const MAX_REPLY_ATTEMPTS = 5;

const GRAPH_API_VERSION = "v20.0";

type MediaKind = "image" | "video";

type WhatsAppProfile = {
  name?: string;
};

type WhatsAppContact = {
  profile?: WhatsAppProfile;
  wa_id?: string;
};

type WhatsAppMedia = {
  id?: string;
  mime_type?: string;
  caption?: string;
  sha256?: string;
};

type WhatsAppText = {
  body?: string;
};

type WhatsAppMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  image?: WhatsAppMedia;
  video?: WhatsAppMedia;
  text?: WhatsAppText;
};

type WhatsAppChangeValue = {
  metadata?: {
    phone_number_id?: string;
    display_phone_number?: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: unknown[];
};

type WhatsAppChange = {
  value?: WhatsAppChangeValue;
};

type WhatsAppEntry = {
  changes?: WhatsAppChange[];
};

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: WhatsAppEntry[];
};

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
};

type PendingMediaItem = {
  media_id: string;
  message_id: string;
  url: string;
  kind: MediaKind;
  received_at: string;
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

function getWhatsAppVerifyToken(): string {
  return requireEnv("WHATSAPP_VERIFY_TOKEN");
}

/** The media kind of an incoming message, or null when it carries no media. */
function messageMediaKind(message: WhatsAppMessage): MediaKind | null {
  if (message.image?.id) return "image";
  if (message.video?.id) return "video";
  return null;
}

function messageMediaId(message: WhatsAppMessage): string | undefined {
  return (message.image?.id ?? message.video?.id)?.trim();
}

/** "…7890" — enough to correlate a log line with a sender, not enough to be PII. */
function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length <= 4 ? "…" : `…${digits.slice(-4)}`;
}

function normalizeCaption(message: WhatsAppMessage): string {
  return (message.image?.caption ?? message.video?.caption ?? message.text?.body ?? "").trim();
}

function parseMessageTimestamp(timestamp?: string): string {
  if (!timestamp) return new Date().toISOString();
  const numeric = Number(timestamp);
  if (Number.isNaN(numeric)) return new Date().toISOString();
  return new Date(numeric * 1000).toISOString();
}

type InboxMessage = {
  message_id: string;
  sender_phone: string;
  contact_name: string | null;
  message_timestamp: string;
  caption: string;
  media_id: string | null;
  kind: MediaKind | null;
  mode: "media" | "finalize" | "numbered";
  public_id: string;
  raw_message: WhatsAppMessage;
};
type ClaimedMessage = {
  idle?: boolean;
  in_flight?: boolean;
  token: string;
  attempts: number;
  asset: PendingMediaItem | null;
  pending_media: PendingMediaItem[];
  payload: InboxMessage;
};

function extractMessages(payload: WhatsAppWebhookPayload): InboxMessage[] {
  const messages: InboxMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        const sender = message.from?.trim();
        if (!sender || !isAllowedWhatsAppAdmin(sender)) continue;
        const kind = messageMediaKind(message);
        const caption = normalizeCaption(message);
        if (!kind && !caption) continue;
        if (!message.id) throw new Error("Handled WhatsApp message is missing its ID");
        messages.push({
          message_id: message.id, sender_phone: sender,
          contact_name: change.value?.contacts?.find((c) => c.wa_id === sender)?.profile?.name ?? null,
          message_timestamp: parseMessageTimestamp(message.timestamp), caption,
          media_id: messageMediaId(message) ?? null, kind,
          mode: kind && /^\d+$/.test(caption) ? "numbered" : caption ? "finalize" : "media",
          public_id: `whatsapp/inbox/${createHash("sha256").update(message.id).digest("hex")}`,
          raw_message: message,
        });
      }
    }
  }
  return messages;
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

async function uploadToCloudinary(params: {
  buffer: Buffer;
  mimeType?: string;
  kind: MediaKind;
  publicId: string;
}): Promise<{ secureUrl: string; publicId: string }> {
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
  };
}

async function findUploadedAsset(publicId: string, kind: MediaKind) {
  const credentials = Buffer.from(`${requireEnv("CLOUDINARY_API_KEY")}:${requireEnv("CLOUDINARY_API_SECRET")}`).toString("base64");
  const response = await fetch(`https://api.cloudinary.com/v1_1/${getCloudName()}/resources/${kind}/upload/${encodeURIComponent(publicId)}`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new PipelineStageError("media_upload", `Cloudinary recovery lookup failed (${response.status})`);
  const asset = await response.json() as CloudinaryUploadResponse;
  if (!asset.secure_url) throw new PipelineStageError("media_upload", "Cloudinary recovery lookup returned no URL");
  return { secureUrl: asset.secure_url, publicId: asset.public_id ?? publicId };
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

async function buildProductPlan(
  supabase: ReturnType<typeof createAdminClient>, text: string, pending: PendingMediaItem[],
) {
  if (!pending.length) return { variants: [], reply: "No photos or videos received yet. Forward the photos/videos first, then send a description and price." };
  const { description, price, fabric } = parseCollectionMessage(text);
  const imageItems = pending.filter((item) => item.kind === "image");

  const aiProvider = getAiProvider();
  let enrichment: ProductEnrichment = {
    categoryId: null,
    categoryName: null,
    highlights: [],
    fabricType: fabric,
    collectionIds: [],
    collectionNames: [],
    name: null,
  };
  let colorSplit: ColorVariantSplit | null = null;

  if (aiProvider.isConfigured()) {
    const [{ data: categoriesData, error: categoriesError }, { data: collectionsData, error: collectionsError }] =
      await Promise.all([
        supabase.from("categories").select("id, slug, name, description"),
        supabase.from("collections").select("id, name, description"),
      ]);

    if (categoriesError) {
      console.warn("whatsapp webhook: categories lookup failed, skipping auto-category", categoriesError.message);
    }
    if (collectionsError) {
      console.warn("whatsapp webhook: collections lookup failed, skipping auto-tagging", collectionsError.message);
    }

    const categories = (categoriesData ?? []) as CategoryOption[];
    const collections = (collectionsData ?? []) as CollectionOption[];
    const imageUrls = imageItems.map((item) => item.url);

    [enrichment, colorSplit] = await Promise.all([
      enrichWhatsAppProduct({ aiProvider, description, fabricFromCaption: fabric, imageUrls, categories, collections }),
      resolveWhatsAppColorVariants({
        aiProvider,
        description,
        images: imageItems.map((item) => ({ media_id: item.media_id, url: item.url })),
      }),
    ]);
  }

  // The AI-drafted name already went through the catalogue style rules; the
  // deterministic derivation is the fallback so a listing never fails (or
  // silently degrades in style) just because the AI call didn't land.
  const name = enrichment.name ?? deriveProductName(description);
  const slugBase = slugify(name);
  const codeBase = generateProductSKU(name);

  const distinctColors = colorSplit ? Array.from(new Set(colorSplit.colorByMediaId.values())) : [];
  const colors = distinctColors.length >= 2 ? [
    ...(colorSplit?.bestColor && distinctColors.includes(colorSplit.bestColor) ? [colorSplit.bestColor] : []),
    ...distinctColors.filter((c) => c !== colorSplit?.bestColor),
  ] : ["Default"];
  const variants = colors.map((color, groupIndex) => {
    const media = pending.filter((item) => colors.length === 1 ||
      (item.kind === "video" ? groupIndex === 0 : (colorSplit?.colorByMediaId.get(item.media_id) ?? colors[0]) === color));
    const firstImage = media.findIndex((item) => item.kind === "image");
    return { color, media: media.map((item, index) => ({ ...item,
      is_primary: index === (firstImage < 0 ? 0 : firstImage), display_order: index + 1,
    })) };
  }).filter((v) => v.media.length);
  return { name, slug: slugBase, code: codeBase, description, price,
    fabric_type: enrichment.fabricType, category_id: enrichment.categoryId,
    highlights: enrichment.highlights, collection_ids: enrichment.collectionIds, variants,
    reply: `Created "${name}" with ${pending.length} photo(s)/video(s). Review it in the admin panel. Send more photos/videos then a new description to start another listing.`,
  };
}

async function rpc<T>(supabase: ReturnType<typeof createAdminClient>, name: string, args: Record<string, unknown>): Promise<T> {
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
      let uploaded = claimed.attempts > 1 ? await findUploadedAsset(m.public_id, m.kind) : null;
      if (!uploaded) {
        const { buffer, mimeType } = await downloadMediaFromMeta(m.media_id, m.kind);
        uploaded = await uploadToCloudinary({ buffer, mimeType, kind: m.kind, publicId: m.public_id });
      }
      asset = { media_id: m.media_id, message_id: m.message_id, url: uploaded.secureUrl,
        kind: m.kind, received_at: m.message_timestamp };
      await rpc(supabase, "checkpoint_whatsapp_asset", { p_message_id: messageId, p_token: claimed.token,
        p_asset: { ...asset, public_id: uploaded.publicId ?? m.public_id } });
    }
    const plan = m.mode === "finalize"
      ? await buildProductPlan(supabase, m.caption, [...claimed.pending_media, ...(asset ? [asset] : [])])
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
async function deliverReplies(supabase: ReturnType<typeof createAdminClient>, sender: string) {
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
async function drainSender(supabase: ReturnType<typeof createAdminClient>, sender: string, deadline: number) {
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
async function isSettled(supabase: ReturnType<typeof createAdminClient>, messageIds: string[]) {
  const { data, error } = await supabase.from("whatsapp_inbox")
    .select("message_id, state, reply, reply_sent, reply_attempts").in("message_id", messageIds);
  if (error) throw new PipelineStageError("db_write", `inbox status: ${error.message}`);
  return (data ?? []).every((row) => (row.state === "done" || row.state === "dead")
    && (!row.reply || row.reply_sent || row.reply_attempts >= MAX_REPLY_ATTEMPTS));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === getWhatsAppVerifyToken()) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return NextResponse.json({ error: "Webhook verification failed" }, { status: 403 });
}

export async function POST(req: Request) {
  let payload: WhatsAppWebhookPayload;

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Could not read payload" }, { status: 400 });
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  if (!verifyWhatsAppSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    console.warn("whatsapp webhook: rejected invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch (error) {
    // Past the signature check, so this is Meta sending something unexpected
    // rather than a spoof — worth surfacing, not just dropping.
    reportError(error, { scope: "whatsapp-invalid-json" });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.object !== "whatsapp_business_account") return NextResponse.json({ ok: true });
  try {
    const messages = extractMessages(payload);
    if (!messages.length) return NextResponse.json({ ok: true });
    const supabase = createAdminClient();
    await rpc(supabase, "enqueue_whatsapp_messages", { p_messages: messages });
    // The messages are durable from here on. Everything below is best-effort
    // progress: a 503 only asks Meta to redeliver as a backup driver.
    const deadline = Date.now() + DRAIN_BUDGET_MS;
    const messageIds = messages.map((message) => message.message_id);
    const senders = [...new Set(messages.map((message) => message.sender_phone))];
    let settled = false;
    for (let polls = 0; ; polls++) {
      let inFlight = false;
      for (const sender of senders) {
        inFlight = (await drainSender(supabase, sender, deadline)) || inFlight;
        await deliverReplies(supabase, sender);
      }
      settled = await isSettled(supabase, messageIds);
      // Only wait when another invocation is mid-message for this sender (a
      // finalize text arriving while its photos are still uploading); a queue
      // parked on a retry backoff is left to the next delivery.
      if (settled || !inFlight || polls >= MAX_DRAIN_POLLS || Date.now() + DRAIN_POLL_MS >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
    }
    return NextResponse.json(settled ? { ok: true } : { error: "Messages retained for retry" }, { status: settled ? 200 : 503 });
  } catch (error) {
    reportError(error, { scope: "whatsapp-receipt" });
    return NextResponse.json({ error: "Could not accept messages" }, { status: 503 });
  }
}
