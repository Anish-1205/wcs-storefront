import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { signUpload } from "@/lib/cloudinary";
import {
  isAllowedWhatsAppAdmin,
  MAX_WEBHOOK_BYTES,
  verifyWhatsAppSignature,
} from "@/lib/webhook-security";

export const runtime = "nodejs";

const GRAPH_API_VERSION = "v20.0";

type WhatsAppProfile = {
  name?: string;
};

type WhatsAppContact = {
  profile?: WhatsAppProfile;
  wa_id?: string;
};

type WhatsAppImage = {
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
  image?: WhatsAppImage;
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
  product_id: string;
  variant_id: string;
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

function normalizeCaption(message: WhatsAppMessage): string {
  return (message.image?.caption ?? message.text?.body ?? "").trim();
}

function generateProductSKU(description: string): string {
  const cleaned = description
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, "-");

  return cleaned || `SAREE-${Date.now()}`;
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

async function downloadImageFromMeta(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const accessToken = getWhatsAppToken();

  const metadataResponse = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}` +
      "?fields=url,mime_type,sha256,file_size",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!metadataResponse.ok) {
    const errorText = await metadataResponse.text();
    throw new Error(`Meta media lookup failed (${metadataResponse.status}): ${errorText}`);
  }

  const media = (await metadataResponse.json()) as MetaMediaResponse;
  if (!media.url) {
    throw new Error("Meta did not return a downloadable media URL");
  }

  const binaryResponse = await fetch(media.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!binaryResponse.ok) {
    const errorText = await binaryResponse.text();
    throw new Error(`Meta image download failed (${binaryResponse.status}): ${errorText}`);
  }

  const arrayBuffer = await binaryResponse.arrayBuffer();
  const mimeType = binaryResponse.headers.get("content-type") ?? media.mime_type ?? "image/jpeg";

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType,
  };
}

async function uploadToCloudinary(params: {
  buffer: Buffer;
  mimeType?: string;
  folder: string;
}): Promise<{ secureUrl: string; publicId: string | null }> {
  const cloudName = getCloudName();
  const apiKey = requireEnv("CLOUDINARY_API_KEY");
  requireEnv("CLOUDINARY_API_SECRET");

  const payloadBuffer = Buffer.isBuffer(params.buffer) ? params.buffer : Buffer.from(params.buffer);
  const blob = new Blob([new Uint8Array(payloadBuffer)], {
    type: params.mimeType || "image/jpeg",
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = await signUpload({ timestamp, folder: params.folder });

  const formData = new FormData();
  formData.append("file", blob, "whatsapp-upload.jpg");
  formData.append("api_key", apiKey);
  formData.append("timestamp", String(timestamp));
  formData.append("signature", signed.signature);
  formData.append("folder", params.folder);

  const uploadResponse = await fetch(signed.uploadUrl, {
    method: "POST",
    body: formData,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Cloudinary upload failed (${uploadResponse.status}): ${errorText}`);
  }

  const uploaded = (await uploadResponse.json()) as CloudinaryUploadResponse;
  if (!uploaded.secure_url) {
    throw new Error("Cloudinary response did not include secure_url");
  }

  if (!cloudName) {
    throw new Error("Missing Cloudinary cloud name environment variable");
  }

  return {
    secureUrl: uploaded.secure_url,
    publicId: uploaded.public_id ?? null,
  };
}

async function sendWhatsAppReply(to: string, text: string): Promise<void> {
  const accessToken = getWhatsAppToken();
  const phoneNumberId = getWhatsAppPhoneNumberId();

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body: text,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WhatsApp reply failed (${response.status}): ${errorText}`);
  }
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
    throw new Error(`DB ingest insert failed: ${error.message}`);
  }
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
  let productId: string | null = null;
  let variantId: string | null = null;
  let savedImageUrl = "";

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

  const { message, contactName, rawEvent } = extractFirstMessage(payload);

  if (payload.object !== "whatsapp_business_account" || !message) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  senderPhone = message.from?.trim() ?? null;
  const mediaId = message.image?.id?.trim();
  const caption = normalizeCaption(message);

  if (!senderPhone || !mediaId) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (!isAllowedWhatsAppAdmin(senderPhone)) {
    console.warn("whatsapp webhook: ignored message from a non-admin sender");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const messageId = message.id ?? `${senderPhone}-${mediaId}-${message.timestamp ?? Date.now()}`;
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

    const isNumberCaption = /^\d+$/.test(caption);

    let folder = "whatsapp";

    if (isNumberCaption) {
      const displayOrder = Number.parseInt(caption, 10);

      const { data: session, error: sessionError } = await supabase
        .from("admin_upload_sessions")
        .select("product_id, variant_id")
        .eq("admin_phone", senderPhone)
        .maybeSingle<AdminUploadSessionRow>();

      if (sessionError) {
        throw new Error(`Active session lookup failed: ${sessionError.message}`);
      }

      if (!session) {
        await sendWhatsAppReply(
          senderPhone,
          "No active product session found. Send an image with a text description first.",
        ).catch((error) => {
          console.error("whatsapp webhook: reply failed for missing session", (error as Error).message);
        });
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      productId = session.product_id;
      variantId = session.variant_id;

      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id, product_code, slug")
        .eq("id", productId)
        .maybeSingle<ProductRow>();

      if (productError) {
        throw new Error(`Product lookup failed: ${productError.message}`);
      }

      folder = product?.product_code || product?.slug || productId;

      const { buffer, mimeType } = await downloadImageFromMeta(mediaId);
      const uploaded = await uploadToCloudinary({ buffer, mimeType, folder });
      savedImageUrl = uploaded.secureUrl;

      const { error: imageError } = await supabase.from("variant_images").insert({
        variant_id: variantId,
        image_url: uploaded.secureUrl,
        is_primary: false,
        display_order: displayOrder,
      });

      if (imageError) {
        throw new Error(`variant_images insert failed: ${imageError.message}`);
      }

      const { error: touchSessionError } = await supabase
        .from("admin_upload_sessions")
        .upsert({
          admin_phone: senderPhone,
          product_id: productId,
          variant_id: variantId,
          updated_at: new Date().toISOString(),
        });

      if (touchSessionError) {
        throw new Error(`admin_upload_sessions upsert failed: ${touchSessionError.message}`);
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

      await sendWhatsAppReply(
        senderPhone,
        `Saved photo ${displayOrder} for ${folder}. Send the next photo as a number, or send a new description to start a new listing.`,
      ).catch((error) => {
        console.error("whatsapp webhook: reply failed after scenario a", (error as Error).message);
      });

      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (!caption) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const sku = generateProductSKU(caption);
    folder = sku;

    const { buffer, mimeType } = await downloadImageFromMeta(mediaId);
    const uploaded = await uploadToCloudinary({ buffer, mimeType, folder });
    savedImageUrl = uploaded.secureUrl;

    const { data: createdProduct, error: productError } = await supabase
      .from("products")
      .insert({
        name: caption,
        slug: sku.toLowerCase(),
        product_code: sku,
        status: "draft",
        description: caption,
        stock_type: "supplier",
      })
      .select("id, name, slug, product_code")
      .single<CreatedProductRow>();

    if (productError || !createdProduct) {
      throw new Error(`Product insert failed: ${productError?.message ?? "unknown error"}`);
    }

    productId = createdProduct.id;

    const { data: createdVariant, error: variantError } = await supabase
      .from("product_variants")
      .insert({
        product_id: createdProduct.id,
        color: "Default",
        status: "available",
        display_order: 1,
      })
      .select("id, product_id")
      .single<CreatedVariantRow>();

    if (variantError || !createdVariant) {
      throw new Error(`Variant insert failed: ${variantError?.message ?? "unknown error"}`);
    }

    variantId = createdVariant.id;

    const { error: imageError } = await supabase.from("variant_images").insert({
      variant_id: createdVariant.id,
      image_url: uploaded.secureUrl,
      is_primary: true,
      display_order: 1,
    });

    if (imageError) {
      throw new Error(`Primary image insert failed: ${imageError.message}`);
    }

    const { error: sessionError } = await supabase.from("admin_upload_sessions").upsert({
      admin_phone: senderPhone,
      product_id: createdProduct.id,
      variant_id: createdVariant.id,
      updated_at: new Date().toISOString(),
    });

    if (sessionError) {
      throw new Error(`Session upsert failed: ${sessionError.message}`);
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

    await sendWhatsAppReply(
      senderPhone,
      `Created SKU ${sku}. Send the next photos as simple numbers like 2, 3, 4.`,
    ).catch((error) => {
      console.error("whatsapp webhook: reply failed after scenario b", (error as Error).message);
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("whatsapp webhook: processing failed", error instanceof Error ? error.message : error);

    if (senderPhone && savedImageUrl && productId && variantId) {
      await sendWhatsAppReply(senderPhone, "We received the image, but saving it failed. Please try again.").catch(() => {
        void 0;
      });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  }
}
