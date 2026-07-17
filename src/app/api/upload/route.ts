import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/admin-auth";
import { signUpload } from "@/lib/cloudinary";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/upload  (admin only)
 * Returns a Cloudinary signed-upload payload. The client then uploads the file
 * directly to Cloudinary using this signature — the API secret never leaves
 * the server.
 */
export async function POST(req: Request) {
  const rateLimit = await checkRateLimit(req);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } },
    );
  }

  // Verify an authenticated admin session.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    console.warn("upload signing denied: unauthenticated");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isEmailAllowed(user.email)) {
    console.warn("upload signing denied: forbidden");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Cloudinary requires a UNIX timestamp; the request time is fine here.
    const timestamp = Math.floor(new Date().getTime() / 1000);
    const folder = process.env.CLOUDINARY_UPLOAD_FOLDER || "sarees";

    const { signature, apiKey, cloudName, uploadUrl } = await signUpload({
      timestamp,
      folder,
    });

    return NextResponse.json({
      signature,
      timestamp,
      folder,
      apiKey,
      cloudName,
      uploadUrl,
    });
  } catch (e) {
    console.error("upload signing failed:", e);
    return NextResponse.json(
      { error: "Cloudinary is not configured" },
      { status: 500 },
    );
  }
}
