import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/admin-auth";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { importAssetCompleteSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * POST /api/import/complete  (admin only)
 * Records that a file finished uploading directly to Cloudinary from the
 * browser. Idempotent: calling this twice with the same batch_id +
 * client_upload_id updates the same row rather than creating a duplicate,
 * so a client retry after a dropped response is always safe.
 *
 * Also performs duplicate detection: if another asset in the same batch
 * already completed with the same Cloudinary etag, this one is flagged
 * (not rejected) via duplicate_of_asset_id so the review UI can warn the
 * admin without silently dropping anything.
 */
export async function POST(req: Request) {
  const rateLimit = await checkImportRateLimit(req);
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

  const parsed = importAssetCompleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const input = parsed.data;

  const expectedPublicId = `imports/${input.batch_id}/${input.client_upload_id}`;
  if (input.cloudinary_public_id !== expectedPublicId) {
    console.warn("import complete: public_id mismatch, rejecting", input.cloudinary_public_id);
    return NextResponse.json({ error: "This upload does not belong to the given batch/file" }, { status: 400 });
  }

  // Mirror /api/import/sign's batch checks — without this, a completion
  // call that skips signing entirely could register assets against a
  // batch that never authorized them, bypassing both the "still open"
  // rule and (since each call can use a fresh client_upload_id) the
  // per-batch file-count ceiling that /sign enforces.
  const { data: batch } = await admin.from("import_batches").select("id, status").eq("id", input.batch_id).maybeSingle();
  if (!batch) {
    return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  }
  if ((batch as { status: string }).status !== "open") {
    return NextResponse.json({ error: "This import batch is no longer accepting uploads" }, { status: 409 });
  }

  const { data: asset, error: upsertError } = await admin
    .from("import_assets")
    .upsert(
      {
        batch_id: input.batch_id,
        client_upload_id: input.client_upload_id,
        kind: input.kind,
        original_filename: input.original_filename ?? null,
        original_relative_path: input.original_relative_path ?? null,
        boundary_start: input.boundary_start,
        upload_status: "uploaded",
        cloudinary_public_id: input.cloudinary_public_id,
        cloudinary_secure_url: input.cloudinary_secure_url,
        cloudinary_etag: input.cloudinary_etag ?? null,
        bytes: input.bytes ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        duration_seconds: input.duration_seconds ?? null,
      },
      { onConflict: "batch_id,client_upload_id" },
    )
    .select("id, created_at")
    .single();

  if (upsertError) {
    console.error("import complete: failed to record asset", upsertError.message);
    return NextResponse.json({ error: "Could not record upload" }, { status: 500 });
  }

  let duplicateOfAssetId: string | null = null;
  if (input.cloudinary_etag) {
    const { data: possibleDuplicates } = await admin
      .from("import_assets")
      .select("id, created_at")
      .eq("batch_id", input.batch_id)
      .eq("cloudinary_etag", input.cloudinary_etag)
      .eq("upload_status", "uploaded")
      .neq("id", asset.id)
      .order("created_at", { ascending: true })
      .limit(1);

    const earlier = (possibleDuplicates ?? [])[0] as { id: string } | undefined;
    if (earlier) {
      duplicateOfAssetId = earlier.id;
      await admin.from("import_assets").update({ duplicate_of_asset_id: earlier.id }).eq("id", asset.id);
    }
  }

  return NextResponse.json({ asset_id: asset.id, duplicate_of_asset_id: duplicateOfAssetId });
}
