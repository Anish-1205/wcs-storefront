"use client";

import { useState } from "react";
import Image from "next/image";
import { cld } from "@/lib/cloudinary";
import { cn } from "@/lib/utils";

export interface UploadedImage {
  image_url: string;
  is_primary: boolean;
  display_order: number;
}

// Custom MIME type for the drag payload — scoped so a stray drag from
// elsewhere on the page (or another browser tab/app) is never mistaken for
// a cross-variant image move.
const DRAG_MIME = "application/x-wcs-variant-image";

interface Props {
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
  /** Stable id for this variant's image grid, used to tag dragged images so
   * a drop elsewhere knows which variant they came from. */
  dragId: string;
  /** Called when an image dragged out of a DIFFERENT variant's grid is
   * dropped on this one — the parent (VariantManager) owns moving it
   * between variants, since that touches two variants' image arrays. */
  onExternalImageDrop: (fromDragId: string, imageIndex: number) => void;
}

/**
 * Per-variant image uploader.
 * 1. Requests a signed upload payload from /api/upload (admin-only).
 * 2. Uploads the file directly to Cloudinary from the browser.
 * 3. Stores the returned secure_url. The API secret never reaches the client.
 *
 * Also doubles as a drag source/drop target: images are draggable, and
 * dropping one from another variant's grid reassigns it here (used to
 * manually correct AI colour-variant grouping).
 */
export function ImageUploader({ images, onChange, dragId, onExternalImageDrop }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);

    try {
      // Get a signature once per batch.
      const sigRes = await fetch("/api/upload", { method: "POST" });
      if (!sigRes.ok) throw new Error("Could not get upload signature");
      const sig = await sigRes.json();

      const uploaded: UploadedImage[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("api_key", sig.apiKey);
        fd.append("timestamp", String(sig.timestamp));
        fd.append("signature", sig.signature);
        fd.append("folder", sig.folder);

        const res = await fetch(sig.uploadUrl, { method: "POST", body: fd });
        if (!res.ok) throw new Error("Cloudinary upload failed");
        const data = await res.json();
        uploaded.push({
          image_url: data.secure_url,
          is_primary: false,
          display_order: 0,
        });
      }

      const combined = [...images, ...uploaded].map((img, i) => ({
        ...img,
        display_order: i,
      }));
      if (!combined.some((c) => c.is_primary) && combined[0]) {
        combined[0].is_primary = true;
      }
      onChange(combined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function setPrimary(idx: number) {
    onChange(images.map((img, i) => ({ ...img, is_primary: i === idx })));
  }

  function remove(idx: number) {
    const next = images
      .filter((_, i) => i !== idx)
      .map((img, i) => ({ ...img, display_order: i }));
    if (!next.some((c) => c.is_primary) && next[0]) next[0].is_primary = true;
    onChange(next);
  }

  function handleDragStart(e: React.DragEvent, idx: number) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ dragId, imageIndex: idx }));
  }

  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDragEnter(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only clear the highlight once the pointer actually leaves this
    // grid — moving between child thumbnails fires leave/enter too, but
    // relatedTarget stays inside the container in that case.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    try {
      const { dragId: fromDragId, imageIndex } = JSON.parse(raw) as { dragId: string; imageIndex: number };
      if (fromDragId === dragId) return; // dropped back into its own grid — no-op
      onExternalImageDrop(fromDragId, imageIndex);
    } catch {
      // Malformed payload (not ours) — ignore.
    }
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "flex flex-wrap gap-3 rounded-sm p-1 transition-colors",
          dragOver && "bg-gold/10 ring-2 ring-gold ring-offset-1",
        )}
      >
        {images.map((img, i) => (
          <div
            key={i}
            draggable
            onDragStart={(e) => handleDragStart(e, i)}
            className="relative h-24 w-20 cursor-grab overflow-hidden rounded-sm border border-border active:cursor-grabbing"
          >
            <Image
              src={cld(img.image_url, "thumbnail")}
              alt="variant"
              fill
              sizes="80px"
              className="pointer-events-none object-cover"
            />
            {img.is_primary && (
              <span className="absolute left-1 top-1 rounded-sm bg-gold px-1 text-[9px] font-medium text-white">
                Primary
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 px-1 py-0.5 text-[10px] text-white">
              {!img.is_primary && (
                <button type="button" onClick={() => setPrimary(i)}>
                  Set primary
                </button>
              )}
              <button type="button" onClick={() => remove(i)} className="ml-auto">
                ✕
              </button>
            </div>
          </div>
        ))}

        {images.length === 0 && (
          <div className="flex h-24 w-20 items-center justify-center rounded-sm border border-dashed border-border text-center text-[10px] leading-tight text-muted-foreground">
            Drag a photo here
          </div>
        )}
      </div>

      <div>
        <label
          className={`inline-flex h-9 cursor-pointer items-center rounded-sm border border-gold px-4 text-xs font-medium text-primary hover:bg-gold hover:text-white ${
            uploading ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={uploading}
          />
          {uploading ? "Uploading…" : "Upload images"}
        </label>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
