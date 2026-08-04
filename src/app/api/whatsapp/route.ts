import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { signUpload } from "@/lib/cloudinary";
import type { VariantImage } from "@/lib/supabase/types";

export const runtime = "nodejs";

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "my_saree_bot_secret_token_123";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

/**
 * Generates a clean product SKU from a description.
 * Example: "Royal Blue Kanchipuram" → "ROYAL-BLUE-KANCHIPURAM"
 */
function generateProductSKU(description: string): string {
  return description
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .join("-");
}

/**
 * Downloads an image from Meta's API using the media ID.
 * Returns the image buffer and the MIME type.
 */
async function downloadImageFromMeta(
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!WHATSAPP_ACCESS_TOKEN) {
    throw new Error("WHATSAPP_ACCESS_TOKEN not configured");
  }

  try {
    // Step 1: Get the media URL from Meta's API
    const mediaResponse = await fetch(
      `https://graph.instagram.com/v18.0/${mediaId}?fields=media_product_type`,
      {
        headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
      },
    );

    if (!mediaResponse.ok) {
      throw new Error(`Failed to fetch media metadata: ${mediaResponse.statusText}`);
    }

    const mediaData = await mediaResponse.json() as { media_product_type?: string };
    console.log("Media metadata:", mediaData);

    // Step 2: Get the actual image URL
    const urlResponse = await fetch(
      `https://graph.instagram.com/v18.0/${mediaId}?fields=url`,
      {
        headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
      },
    );

    if (!urlResponse.ok) {
      throw new Error(`Failed to fetch media URL: ${urlResponse.statusText}`);
    }

    const urlData = await urlResponse.json() as { url?: string };
    if (!urlData.url) {
      throw new Error("No URL returned from Meta API");
    }

    // Step 3: Download the actual image
    const imageResponse = await fetch(urlData.url, {
      headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
    });

    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.statusText}`);
    }

    const buffer = await imageResponse.arrayBuffer();
    const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

    return {
      buffer: Buffer.from(buffer),
      mimeType,
    };
  } catch (error) {
    console.error("Error downloading image from Meta:", error);
    throw error;
  }
}

/**
 * Uploads an image buffer to Cloudinary using direct API.
 * Returns the secure_url from Cloudinary.
 */
async function uploadToCloudinary(
  buffer: Buffer,
  folder: string,
): Promise<string> {
  if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET || !NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) {
    throw new Error("Cloudinary credentials not configured");
  }

  try {
    const formData = new FormData();
    const blob = new Blob([buffer], { type: "image/jpeg" });
    formData.append("file", blob);
    formData.append("api_key", CLOUDINARY_API_KEY);
    formData.append("folder", folder);

    // Use unsigned upload (simpler for bot integration)
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`,
      {
        method: "POST",
        body: formData,
      },
    );

    if (!response.ok) {
      throw new Error(`Cloudinary upload failed: ${response.statusText}`);
    }

    const data = await response.json() as { secure_url?: string };
    if (!data.secure_url) {
      throw new Error("No secure_url returned from Cloudinary");
    }

    return data.secure_url;
  } catch (error) {
    console.error("Error uploading to Cloudinary:", error);
    throw error;
  }
}

/**
 * Sends a WhatsApp reply back to the admin's phone number.
 */
async function sendWhatsAppReply(to: string, text: string): Promise<void> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.warn("WhatsApp credentials not configured; skipping reply");
    return;
  }

  try {
    const response = await fetch(
      `https://graph.instagram.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Failed to send WhatsApp reply: ${response.statusText}`, errorData);
      throw new Error(`WhatsApp send failed: ${response.statusText}`);
    }

    console.log(`✓ WhatsApp reply sent to ${to}`);
  } catch (error) {
    console.error("Error sending WhatsApp reply:", error);
    // Don't throw—log and continue to avoid breaking the webhook response
  }
}

/**
 * GET /api/whatsapp
 * Webhook verification endpoint for Meta's WhatsApp API.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
    console.log("✓ WhatsApp webhook verified");
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn("WhatsApp webhook verification failed");
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

/**
 * POST /api/whatsapp
 * Receives incoming WhatsApp messages from Meta's API.
 *
 * State machine:
 * - If image + number caption → Add image to existing session (Scenario A)
 * - If image + text caption → Create new product/variant (Scenario B)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      object?: string;
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{
              from?: string;
              type?: string;
              image?: { id?: string };
              text?: { body?: string };
            }>;
          };
        }>;
      }>;
    };

    // Validate this is a message event
    if (body.object !== "whatsapp_business_account") {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const senderPhone = message.from;
    const hasImage = message.type === "image" && message.image?.id;
    const caption = message.text?.body || "";

    if (!senderPhone || !hasImage) {
      console.log("Received non-image message or no sender phone");
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    console.log(`📱 Received image from ${senderPhone}, caption: "${caption}"`);

    const supabase = createAdminClient();

    // ─────────────────────────────────────────────────────
    // Check if caption is a number (Scenario A) or text (Scenario B)
    // ─────────────────────────────────────────────────────
    const isNumberCaption = /^\d+$/.test(caption.trim());

    if (isNumberCaption) {
      // ─────────────────────────────────────────────────────
      // SCENARIO A: Number caption (e.g., "2", "3")
      // Add image to existing session
      // ─────────────────────────────────────────────────────
      const displayOrder = parseInt(caption.trim(), 10);

      // Query for active session
      const { data: session, error: sessionError } = await supabase
        .from("admin_upload_sessions")
        .select("product_id, variant_id")
        .eq("admin_phone", senderPhone)
        .single();

      if (sessionError || !session) {
        console.warn(`No active session for ${senderPhone}`);
        await sendWhatsAppReply(
          senderPhone,
          "❌ No active product session. Send a photo with a product description first.",
        );
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      const { variant_id } = session;

      // Download image from Meta
      console.log(`⬇️  Downloading image from Meta...`);
      const { buffer } = await downloadImageFromMeta(message.image!.id!);

      // Determine the folder based on product code
      const { data: product } = await supabase
        .from("products")
        .select("product_code")
        .eq("id", session.product_id)
        .single();

      const folder = product?.product_code || `products/${session.product_id}`;

      // Upload to Cloudinary
      console.log(`☁️  Uploading to Cloudinary (folder: ${folder})...`);
      const imageUrl = await uploadToCloudinary(buffer, folder);

      // Insert into variant_images
      const { error: insertError } = await supabase
        .from("variant_images")
        .insert({
          variant_id,
          image_url: imageUrl,
          is_primary: false,
          display_order: displayOrder,
        });

      if (insertError) {
        console.error("Failed to insert variant_images:", insertError);
        await sendWhatsAppReply(senderPhone, "❌ Failed to save image to database.");
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      console.log(
        `✓ Image added to variant ${variant_id} with display_order ${displayOrder}`,
      );
      await sendWhatsAppReply(
        senderPhone,
        `✅ Photo saved at position ${displayOrder}!\nSend next photos as numbers (2, 3, 4...) or send a new product description to start fresh.`,
      );
    } else {
      // ─────────────────────────────────────────────────────
      // SCENARIO B: Text caption (product description)
      // Create new product + variant + image
      // ─────────────────────────────────────────────────────
      const productDescription = caption.trim();
      const sku = generateProductSKU(productDescription);

      console.log(`📝 Creating new product: ${sku} (${productDescription})`);

      // Download image from Meta
      console.log(`⬇️  Downloading image from Meta...`);
      const { buffer } = await downloadImageFromMeta(message.image!.id!);

      // Create new product
      const { data: newProduct, error: productError } = await supabase
        .from("products")
        .insert({
          name: productDescription,
          slug: sku.toLowerCase().replace(/-+/g, "-"),
          product_code: sku,
          status: "draft",
          fabric_type: null,
          description: `Created via WhatsApp bot from: ${productDescription}`,
          stock_type: "supplier",
        })
        .select()
        .single();

      if (productError || !newProduct) {
        console.error("Failed to create product:", productError);
        await sendWhatsAppReply(senderPhone, "❌ Failed to create product.");
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      console.log(`✓ Product created: ${newProduct.id}`);

      // Create default variant (generic color)
      const { data: newVariant, error: variantError } = await supabase
        .from("product_variants")
        .insert({
          product_id: newProduct.id,
          color: "Default",
          color_hex: "#000000",
          status: "available",
          display_order: 1,
        })
        .select()
        .single();

      if (variantError || !newVariant) {
        console.error("Failed to create variant:", variantError);
        await sendWhatsAppReply(senderPhone, "❌ Failed to create variant.");
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      console.log(`✓ Variant created: ${newVariant.id}`);

      // Upload image to Cloudinary
      console.log(`☁️  Uploading to Cloudinary (folder: ${sku})...`);
      const imageUrl = await uploadToCloudinary(buffer, sku);

      // Insert primary image
      const { error: imageError } = await supabase
        .from("variant_images")
        .insert({
          variant_id: newVariant.id,
          image_url: imageUrl,
          is_primary: true,
          display_order: 1,
        });

      if (imageError) {
        console.error("Failed to insert image:", imageError);
        await sendWhatsAppReply(senderPhone, "❌ Failed to save image.");
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      console.log(`✓ Image inserted`);

      // Upsert session state
      const { error: sessionUpsertError } = await supabase
        .from("admin_upload_sessions")
        .upsert({
          admin_phone: senderPhone,
          product_id: newProduct.id,
          variant_id: newVariant.id,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (sessionUpsertError) {
        console.error("Failed to upsert session:", sessionUpsertError);
      }

      console.log(`✓ Session state saved`);
      await sendWhatsAppReply(
        senderPhone,
        `✅ Product "${productDescription}" created!\n\nSKU: ${sku}\n\nSend photos for this product as simple numbers:\n• 2 for second photo\n• 3 for third photo\n• etc.\n\nOr send a new description to create a different product.`,
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Webhook handler error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
