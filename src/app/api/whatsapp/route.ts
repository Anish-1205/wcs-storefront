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

type AdminUploadSessionRow = {
  product_id: string | null;
  variant_id: string | null;
};

type PendingMediaItem = {
  media_id: string;
  message_id: string;
  url: string;
  kind: MediaKind;
  received_at: string;
};

type PendingMediaSessionRow = {
  pending_media: PendingMediaItem[] | null;
};

type ProductRow = {
  id: string;
  product_code: string | null;
  slug: string;
};

type CreatedProductRow = {
  id: string;
  name: string;
  slug: string;
  product_code: string | null;
};

type CreatedVariantRow = {
  id: string;
  product_id: string;
};

/**
 * Tags a thrown error with which pipeline stage failed, so the outer catch
 * can reply on WhatsApp with a plain-language message instead of a raw
 * error — every failure in this route must reach the sender somehow, never
 * just a server-side log.
 */
class PipelineStageError extends Error {
  constructor(
    public readonly stage: keyof typeof FRIENDLY_MESSAGES,
    message: string,
  ) {
    super(message);
    this.name = "PipelineStageError";
  }
}

const FRIENDLY_MESSAGES = {
  media_download:
    "We couldn't download a photo/video you sent from WhatsApp. Please resend it.",
  media_upload:
    "We couldn't save a photo/video you sent. Please resend it — if it keeps failing, try a smaller file.",
  db_write:
    "We hit a problem saving your product. Nothing was lost — please try again, or contact support if it keeps happening.",
  session_lookup:
    "Something went wrong looking up your upload session. Please try again.",
  unknown: "Something went wrong on our end. Please try again, or contact support if it keeps happening.",
} as const;

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

function normalizeCaption(message: WhatsAppMessage): string {
  return (message.image?.caption ?? message.video?.caption ?? message.text?.body ?? "").trim();
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

function parseMessageTimestamp(timestamp?: string): string {
  if (!timestamp) return new Date().toISOString();
  const numeric = Number(timestamp);
  if (Number.isNaN(numeric)) return new Date().toISOString();
  return new Date(numeric * 1000).toISOString();
}

function extractFirstMessage(payload: WhatsAppWebhookPayload): {
  message: WhatsAppMessage | null;
  contactName: string | null;
  rawEvent: WhatsAppChangeValue | null;
} {
  const changeValue = payload.entry?.[0]?.changes?.[0]?.value ?? null;
  const message = changeValue?.messages?.[0] ?? null;
  const contactName = changeValue?.contacts?.[0]?.profile?.name ?? null;

  return { message, contactName, rawEvent: changeValue };
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
  folder: string;
  kind: MediaKind;
}): Promise<{ secureUrl: string; publicId: string | null }> {
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
    signed = await signUpload({ timestamp, folder: params.folder }, params.kind);
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
  formData.append("folder", params.folder);

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
    publicId: uploaded.public_id ?? null,
  };
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

  // Never log accessToken. phoneNumberId/to are not secrets (they identify
  // WhatsApp accounts/phone numbers, not credentials) — logged in full so
  // they can be diff'd against Meta's dashboard/App Setup values.
  console.log(
    `whatsapp webhook: sending reply — url=${url} to="${to}" (len=${to.length}) ` +
      `body=${JSON.stringify(requestBody)}`,
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

  console.log(`whatsapp webhook: reply sent to ${to} (${response.status}): ${responseText}`);
}

async function replyBestEffort(to: string, text: string, context: string): Promise<void> {
  await sendWhatsAppReply(to, text).catch((error) => {
    console.error(`whatsapp webhook: reply failed (${context})`, (error as Error).message);
  });
}

async function persistIngestEvent(params: {
  supabase: ReturnType<typeof createAdminClient>;
  messageId: string;
  senderPhone: string;
  senderName: string | null;
  messageTimestamp: string;
  caption: string;
  imageUrl: string;
  rawPayload: WhatsAppWebhookPayload;
  productId: string | null;
  variantId: string | null;
  mediaId: string;
}): Promise<void> {
  const { error } = await params.supabase.from("whatsapp_ingest_events").insert({
    message_id: params.messageId,
    sender_phone: params.senderPhone,
    sender_name: params.senderName,
    message_timestamp: params.messageTimestamp,
    caption: params.caption,
    image_url: params.imageUrl,
    raw_payload: params.rawPayload,
    product_id: params.productId,
    variant_id: params.variantId,
    media_id: params.mediaId,
  });

  if (error) {
    throw new PipelineStageError("db_write", `DB ingest insert failed: ${error.message}`);
  }
}

/** Appends one uncaptioned media item to the sender's pending batch (atomic
 * DB-side append — see append_whatsapp_pending_media in 016_whatsapp_batch_ingestion.sql). */
async function appendPendingMedia(
  supabase: ReturnType<typeof createAdminClient>,
  adminPhone: string,
  item: PendingMediaItem,
): Promise<void> {
  const { error } = await supabase.rpc("append_whatsapp_pending_media", {
    p_admin_phone: adminPhone,
    p_item: item,
  });

  if (error) {
    throw new PipelineStageError("db_write", `Pending media append failed: ${error.message}`);
  }
}

/** Inserts a product with a unique slug/product_code, retrying with -2, -3...
 * suffixes on a unique-constraint collision instead of failing the request. */
async function insertProductWithUniqueSlug(
  supabase: ReturnType<typeof createAdminClient>,
  fields: {
    name: string;
    description: string;
    fabric_type: string | null;
    base_price_min: number | null;
    base_price_max: number | null;
    category_id: string | null;
    highlights: string[];
  },
  slugBase: string,
  codeBase: string,
): Promise<CreatedProductRow> {
  const MAX_ATTEMPTS = 25;
  let lastErrorMessage = "unknown error";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const { data, error } = await supabase
      .from("products")
      .insert({
        name: fields.name,
        slug: `${slugBase}${suffix}`,
        product_code: `${codeBase}${suffix}`,
        status: "draft",
        description: fields.description,
        fabric_type: fields.fabric_type,
        base_price_min: fields.base_price_min,
        base_price_max: fields.base_price_max,
        category_id: fields.category_id,
        highlights: fields.highlights,
        stock_type: "supplier",
      })
      .select("id, name, slug, product_code")
      .single<CreatedProductRow>();

    if (!error && data) return data;

    lastErrorMessage = error?.message ?? "unknown error";
    if (!isUniqueViolation(error)) break;
  }

  throw new PipelineStageError("db_write", `Product insert failed: ${lastErrorMessage}`);
}

/**
 * Creates the product's variant(s) + variant_images from the batch's queued
 * media. Without a colour split (or when AI didn't produce a confident one)
 * this is exactly the original single-"Default"-variant behaviour. With a
 * split, it creates one product_variants row per colourway — best/default
 * colour first — mirroring createProductFromGroup's import-pipeline
 * behaviour: videos (never colour-clustered) and any photo the suggestion
 * left unassigned join whichever colourway ends up first, rather than being
 * dropped from the product.
 */
async function createVariantsForBatch(
  supabase: ReturnType<typeof createAdminClient>,
  productId: string,
  pending: PendingMediaItem[],
  colorSplit: ColorVariantSplit | null,
): Promise<{ variantIds: string[]; primaryVariantId: string }> {
  const imageItems = pending.filter((item) => item.kind === "image");
  const videoItems = pending.filter((item) => item.kind === "video");
  const distinctColors = colorSplit ? Array.from(new Set(colorSplit.colorByMediaId.values())) : [];

  if (!colorSplit || distinctColors.length < 2) {
    const { data: variant, error } = await supabase
      .from("product_variants")
      .insert({ product_id: productId, color: "Default", status: "available", display_order: 1 })
      .select("id, product_id")
      .single<CreatedVariantRow>();

    if (error || !variant) {
      throw new PipelineStageError("db_write", `Variant insert failed: ${error?.message ?? "unknown error"}`);
    }

    const firstImageIndex = pending.findIndex((item) => item.kind === "image");
    const primaryIndex = firstImageIndex === -1 ? 0 : firstImageIndex;
    const imageRows = pending.map((item, index) => ({
      variant_id: variant.id,
      image_url: item.url,
      media_type: item.kind,
      is_primary: index === primaryIndex,
      display_order: index + 1,
    }));

    const { error: imagesError } = await supabase.from("variant_images").insert(imageRows);
    if (imagesError) {
      throw new PipelineStageError("db_write", `Variant images insert failed: ${imagesError.message}`);
    }

    return { variantIds: [variant.id], primaryVariantId: variant.id };
  }

  const orderedColors = [
    ...(colorSplit.bestColor && distinctColors.includes(colorSplit.bestColor) ? [colorSplit.bestColor] : []),
    ...distinctColors.filter((c) => c !== colorSplit.bestColor),
  ];
  const firstColor = orderedColors[0];
  const variantIds: string[] = [];

  for (let groupIndex = 0; groupIndex < orderedColors.length; groupIndex++) {
    const color = orderedColors[groupIndex];
    const groupImages = imageItems.filter((item) => {
      const assigned = colorSplit.colorByMediaId.get(item.media_id);
      return assigned ? assigned === color : color === firstColor;
    });
    const groupVideos = color === firstColor ? videoItems : [];
    const groupItems = [...groupImages, ...groupVideos];
    if (groupItems.length === 0) continue;

    const { data: variant, error } = await supabase
      .from("product_variants")
      .insert({ product_id: productId, color, status: "available", display_order: groupIndex })
      .select("id, product_id")
      .single<CreatedVariantRow>();

    if (error || !variant) {
      throw new PipelineStageError("db_write", `Variant insert failed: ${error?.message ?? "unknown error"}`);
    }

    const imageRows = groupItems.map((item, index) => ({
      variant_id: variant.id,
      image_url: item.url,
      media_type: item.kind,
      is_primary: index === 0,
      display_order: index + 1,
    }));

    const { error: imagesError } = await supabase.from("variant_images").insert(imageRows);
    if (imagesError) {
      throw new PipelineStageError("db_write", `Variant images insert failed: ${imagesError.message}`);
    }

    variantIds.push(variant.id);
  }

  if (variantIds.length === 0) {
    throw new PipelineStageError("db_write", "Colour-variant split produced no groups with any media");
  }

  return { variantIds, primaryVariantId: variantIds[0] };
}

/**
 * The trigger step of the new flow: a text-only (or legacy captioned-image)
 * message describing the collection + price. Collects everything queued in
 * the sender's pending batch, auto-fills category/highlights/fabric/
 * collection tags and colour variants when AI is configured (see
 * src/lib/whatsapp-enrichment.ts), creates one product with all of it
 * attached, and clears the batch.
 */
async function finalizeBatch(params: {
  supabase: ReturnType<typeof createAdminClient>;
  senderPhone: string;
  contactName: string | null;
  text: string;
  messageId: string;
  messageTimestamp: string;
  rawPayload: WhatsAppWebhookPayload;
}): Promise<void> {
  const { supabase, senderPhone, contactName, text, messageId, messageTimestamp, rawPayload } = params;

  const { data: session, error: sessionError } = await supabase
    .from("admin_upload_sessions")
    .select("pending_media")
    .eq("admin_phone", senderPhone)
    .maybeSingle<PendingMediaSessionRow>();

  if (sessionError) {
    throw new PipelineStageError("session_lookup", `Pending media lookup failed: ${sessionError.message}`);
  }

  const pending = session?.pending_media ?? [];
  if (pending.length === 0) {
    await replyBestEffort(
      senderPhone,
      "No photos or videos received yet. Please forward the photos/videos first, then send one message with the description and price.",
      "no pending media",
    );
    return;
  }

  const { description, price, fabric } = parseCollectionMessage(text);
  const name = deriveProductName(description);
  const slugBase = slugify(name);
  const codeBase = generateProductSKU(name);
  const imageItems = pending.filter((item) => item.kind === "image");

  const aiProvider = getAiProvider();
  let enrichment: ProductEnrichment = {
    categoryId: null,
    categoryName: null,
    highlights: [],
    fabricType: fabric,
    collectionIds: [],
    collectionNames: [],
  };
  let colorSplit: ColorVariantSplit | null = null;

  if (aiProvider.isConfigured()) {
    const [{ data: categoriesData, error: categoriesError }, { data: collectionsData, error: collectionsError }] =
      await Promise.all([
        supabase.from("categories").select("id, slug, name"),
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

  const createdProduct = await insertProductWithUniqueSlug(
    supabase,
    {
      name,
      description,
      fabric_type: enrichment.fabricType,
      base_price_min: price,
      base_price_max: price,
      category_id: enrichment.categoryId,
      highlights: enrichment.highlights,
    },
    slugBase,
    codeBase,
  );

  const { variantIds, primaryVariantId } = await createVariantsForBatch(
    supabase,
    createdProduct.id,
    pending,
    colorSplit,
  );

  if (enrichment.collectionIds.length > 0) {
    const collectionRows = enrichment.collectionIds.map((collection_id, index) => ({
      collection_id,
      product_id: createdProduct.id,
      display_order: index,
    }));
    const { error: collectionsInsertError } = await supabase.from("collection_products").insert(collectionRows);
    if (collectionsInsertError) {
      throw new PipelineStageError("db_write", `Collection tagging failed: ${collectionsInsertError.message}`);
    }
  }

  const { error: sessionResetError } = await supabase.from("admin_upload_sessions").upsert({
    admin_phone: senderPhone,
    product_id: createdProduct.id,
    variant_id: primaryVariantId,
    pending_media: [],
    updated_at: new Date().toISOString(),
  });
  if (sessionResetError) {
    throw new PipelineStageError("db_write", `Session reset failed: ${sessionResetError.message}`);
  }

  const firstImageIndex = pending.findIndex((item) => item.kind === "image");
  const primaryIndex = firstImageIndex === -1 ? 0 : firstImageIndex;

  await persistIngestEvent({
    supabase,
    messageId,
    senderPhone,
    senderName: contactName,
    messageTimestamp,
    caption: text,
    imageUrl: pending[primaryIndex].url,
    rawPayload,
    productId: createdProduct.id,
    variantId: primaryVariantId,
    mediaId: pending[primaryIndex].media_id,
  });

  const photoCount = imageItems.length;
  const videoCount = pending.length - imageItems.length;
  const mediaSummary = [
    photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? "" : "s"}` : null,
    videoCount > 0 ? `${videoCount} video${videoCount === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const colourNote = variantIds.length > 1 ? ` across ${variantIds.length} colourways` : "";
  const tagNote = [
    enrichment.categoryName ? `Category: ${enrichment.categoryName}.` : null,
    enrichment.collectionNames.length ? `Collections: ${enrichment.collectionNames.join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const missingParts = [price == null && "price", !enrichment.fabricType && "fabric"]
    .filter(Boolean)
    .join(" and ");
  const reminder = missingParts ? ` No ${missingParts} yet — add it in the admin panel when you get a chance.` : "";

  await replyBestEffort(
    senderPhone,
    `Created "${createdProduct.name}" (${createdProduct.product_code}) with ${mediaSummary}${colourNote}` +
      `${price != null ? ` — ₹${price}` : ""}.${tagNote ? ` ${tagNote}` : ""}${reminder} Send more photos/videos then a new description to start another listing.`,
    "after finalize",
  );
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
  let senderPhone: string | null = null;

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
    console.error("whatsapp webhook: invalid json payload", error);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const { message, contactName } = extractFirstMessage(payload);

  if (payload.object !== "whatsapp_business_account" || !message) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  senderPhone = message.from?.trim() ?? null;
  if (!senderPhone) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (!isAllowedWhatsAppAdmin(senderPhone)) {
    console.warn("whatsapp webhook: ignored message from a non-admin sender");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const mediaKind = messageMediaKind(message);
  const mediaId = messageMediaId(message);
  const textBody = message.text?.body?.trim();

  // Nothing this route handles (sticker, location, reaction, status, etc.).
  if (!mediaKind && !mediaId && !textBody) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const messageId = message.id ?? `${senderPhone}-${mediaId ?? "text"}-${message.timestamp ?? Date.now()}`;
  const messageTimestamp = parseMessageTimestamp(message.timestamp);
  const supabase = createAdminClient();

  try {
    const { data: existingEvent, error: existingEventError } = await supabase
      .from("whatsapp_ingest_events")
      .select("message_id")
      .eq("message_id", messageId)
      .maybeSingle();

    if (existingEventError) {
      console.error("whatsapp webhook: duplicate check failed", existingEventError.message);
    }

    if (existingEvent) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // ── Media message (image or video) ──────────────────────────────
    if (mediaKind && mediaId) {
      const caption = normalizeCaption(message);
      const isNumberCaption = /^\d+$/.test(caption);

      if (isNumberCaption) {
        // Legacy path: numbered captions append a photo to an already-active
        // (already-created) product's session.
        const displayOrder = Number.parseInt(caption, 10);

        const { data: session, error: sessionError } = await supabase
          .from("admin_upload_sessions")
          .select("product_id, variant_id")
          .eq("admin_phone", senderPhone)
          .maybeSingle<AdminUploadSessionRow>();

        if (sessionError) {
          throw new PipelineStageError("session_lookup", `Active session lookup failed: ${sessionError.message}`);
        }

        if (!session?.product_id || !session?.variant_id) {
          await replyBestEffort(
            senderPhone,
            "No active product session found. Send an image with a text description first.",
            "missing session",
          );
          return NextResponse.json({ ok: true }, { status: 200 });
        }

        const productId = session.product_id;
        const variantId = session.variant_id;

        const { data: product, error: productError } = await supabase
          .from("products")
          .select("id, product_code, slug")
          .eq("id", productId)
          .maybeSingle<ProductRow>();

        if (productError) {
          throw new PipelineStageError("db_write", `Product lookup failed: ${productError.message}`);
        }

        const folder = product?.product_code || product?.slug || productId;

        const { buffer, mimeType } = await downloadMediaFromMeta(mediaId, mediaKind);
        const uploaded = await uploadToCloudinary({ buffer, mimeType, folder, kind: mediaKind });

        const { error: imageError } = await supabase.from("variant_images").insert({
          variant_id: variantId,
          image_url: uploaded.secureUrl,
          media_type: mediaKind,
          is_primary: false,
          display_order: displayOrder,
        });

        if (imageError) {
          throw new PipelineStageError("db_write", `variant_images insert failed: ${imageError.message}`);
        }

        const { error: touchSessionError } = await supabase.from("admin_upload_sessions").upsert({
          admin_phone: senderPhone,
          product_id: productId,
          variant_id: variantId,
          updated_at: new Date().toISOString(),
        });

        if (touchSessionError) {
          throw new PipelineStageError("db_write", `admin_upload_sessions upsert failed: ${touchSessionError.message}`);
        }

        await persistIngestEvent({
          supabase,
          messageId,
          senderPhone,
          senderName: contactName,
          messageTimestamp,
          caption,
          imageUrl: uploaded.secureUrl,
          rawPayload: payload,
          productId,
          variantId,
          mediaId,
        });

        await replyBestEffort(
          senderPhone,
          `Saved photo ${displayOrder} for ${folder}. Send the next photo as a number, or send a new description to start a new listing.`,
          "after numbered photo",
        );

        return NextResponse.json({ ok: true }, { status: 200 });
      }

      // New flow (and legacy single-caption flow): queue this media into the
      // sender's pending batch first.
      const { buffer, mimeType } = await downloadMediaFromMeta(mediaId, mediaKind);
      const uploaded = await uploadToCloudinary({ buffer, mimeType, folder: "whatsapp/pending", kind: mediaKind });

      await appendPendingMedia(supabase, senderPhone, {
        media_id: mediaId,
        message_id: messageId,
        url: uploaded.secureUrl,
        kind: mediaKind,
        received_at: messageTimestamp,
      });

      if (!caption) {
        // Uncaptioned media: silently accumulate, no reply, no product yet.
        await persistIngestEvent({
          supabase,
          messageId,
          senderPhone,
          senderName: contactName,
          messageTimestamp,
          caption: "",
          imageUrl: uploaded.secureUrl,
          rawPayload: payload,
          productId: null,
          variantId: null,
          mediaId,
        });
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      // A caption on the media doubles as the finalizing description (keeps
      // the old single-image-with-caption flow working).
      await finalizeBatch({
        supabase,
        senderPhone,
        contactName,
        text: caption,
        messageId,
        messageTimestamp,
        rawPayload: payload,
      });

      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // ── Text-only message: the finalizing trigger ───────────────────
    if (textBody) {
      await finalizeBatch({
        supabase,
        senderPhone,
        contactName,
        text: textBody,
        messageId,
        messageTimestamp,
        rawPayload: payload,
      });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("whatsapp webhook: processing failed", error instanceof Error ? error.message : error);

    if (senderPhone) {
      const stage = error instanceof PipelineStageError ? error.stage : "unknown";
      await replyBestEffort(senderPhone, FRIENDLY_MESSAGES[stage], "on failure");
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  }
}
