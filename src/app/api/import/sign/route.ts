import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/admin-auth";
import { signUpload } from "@/lib/cloudinary";
import { checkRateLimit } from "@/lib/rate-limit";
import { importUploadSignRequestSchema, MAX_IMPORT_ASSETS_PER_BATCH } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * POST /api/import/sign  (admin only)
 * Returns a Cloudinary signed-upload payload for one file in an import
 * batch. The client then uploads the file directly to Cloudinary — the API
 * secret never leaves the server. Also creates (or reuses, if the same
 * client_upload_id is retried) the pending import_assets row that the
 * upload will complete against.
 */
export async function POST(req: Request) {
  const rateLimit = await checkRateLimit(req);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } },
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const admin = createAdminClient();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = importUploadSignRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const input = parsed.data;

  const { data: batch } = await admin
    .from("import_batches")
    .select("id, status")
    .eq("id", input.batch_id)
    .maybeSingle();
  if (!batch) {
    return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  }
  if ((batch as { status: string }).status !== "open") {
    return NextResponse.json({ error: "This import batch is no longer accepting uploads" }, { status: 409 });
  }

  const { count } = await admin
    .from("import_assets")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", input.batch_id);
  if ((count ?? 0) >= MAX_IMPORT_ASSETS_PER_BATCH) {
    return NextResponse.json({ error: `This batch has reached the ${MAX_IMPORT_ASSETS_PER_BATCH}-file limit` }, { status: 409 });
  }

  const { error: upsertError } = await admin.from("import_assets").upsert(
    {
      batch_id: input.batch_id,
      client_upload_id: input.client_upload_id,
      kind: input.kind,
      original_filename: input.filename,
      original_relative_path: input.original_relative_path ?? null,
      boundary_start: input.boundary_start,
      upload_status: "pending",
    },
    { onConflict: "batch_id,client_upload_id", ignoreDuplicates: false },
  );
  if (upsertError) {
    console.error("import sign: failed to record pending asset", upsertError.message);
    return NextResponse.json({ error: "Could not register upload" }, { status: 500 });
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `imports/${input.batch_id}/${input.client_upload_id}`;
    const resourceType = input.kind === "video" ? "video" : "image";

    const { signature, apiKey, cloudName, uploadUrl } = await signUpload({ timestamp, public_id: publicId }, resourceType);

    return NextResponse.json({
      signature,
      timestamp,
      apiKey,
      cloudName,
      uploadUrl,
      publicId,
      resourceType,
    });
  } catch (e) {
    console.error("import sign: cloudinary signing failed:", e);
    return NextResponse.json({ error: "Cloudinary is not configured" }, { status: 500 });
  }
}
