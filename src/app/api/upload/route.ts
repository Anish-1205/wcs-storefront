import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/admin-auth";
import { signUpload } from "@/lib/cloudinary";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { reportError } from "@/lib/report-error";
import { logger, requestIdFrom } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/upload  (admin only)
 * Returns a Cloudinary signed-upload payload. The client then uploads the file
 * directly to Cloudinary using this signature — the API secret never leaves
 * the server.
 */
export async function POST(req: Request) {
  // Fails closed (503): admin auth below already keeps strangers out, so
  // this bucket exists to bound a runaway client that would spend real
  // Cloudinary quota. Without a limiter there is nothing bounding it.
  const limited = rateLimitResponse(await checkRateLimit(req, { failure: "closed" }));
  if (limited) return limited;

  // Verify an authenticated admin session.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logger.warn("upload", "upload signing denied: unauthenticated", { requestId: requestIdFrom(req) });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isEmailAllowed(user.email)) {
    logger.warn("upload", "upload signing denied: forbidden", { requestId: requestIdFrom(req) });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Cloudinary requires a UNIX timestamp; the request time is fine here.
    const timestamp = Math.floor(new Date().getTime() / 1000);
    const folder = process.env.CLOUDINARY_UPLOAD_FOLDER || "sarees";

    // "auto" lets Cloudinary detect image vs video per file server-side, so
    // one signed request covers a batch of either (or both) — the admin
    // panel's variant image uploader now accepts video too, matching what
    // the WhatsApp ingestion path already stores as variant_images.media_type.
    const { signature, apiKey, cloudName, uploadUrl } = await signUpload(
      { timestamp, folder },
      "auto",
    );

    return NextResponse.json({
      signature,
      timestamp,
      folder,
      apiKey,
      cloudName,
      uploadUrl,
    });
  } catch (e) {
    reportError(e, { scope: "upload-signing" });
    return NextResponse.json(
      { error: "Cloudinary is not configured" },
      { status: 500 },
    );
  }
}
