"use client";

import { useState } from "react";
import Image from "next/image";
import { cld } from "@/lib/cloudinary";

export interface UploadedImage {
  image_url: string;
  is_primary: boolean;
  display_order: number;
}

interface Props {
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
}

/**
 * Per-variant image uploader.
 * 1. Requests a signed upload payload from /api/upload (admin-only).
 * 2. Uploads the file directly to Cloudinary from the browser.
 * 3. Stores the returned secure_url. The API secret never reaches the client.
 */
export function ImageUploader({ images, onChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {images.map((img, i) => (
          <div
            key={i}
            className="relative h-24 w-20 overflow-hidden rounded-sm border border-border"
          >
            <Image
              src={cld(img.image_url, "thumbnail")}
              alt="variant"
              fill
              sizes="80px"
              className="object-cover"
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
      </div>

      <div>
        <label
          className={`inline-flex h-9 cursor-pointer items-center rounded-sm border border-gold px-4 text-xs font-medium text-burgundy hover:bg-gold hover:text-white ${
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
