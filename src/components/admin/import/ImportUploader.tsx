"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type QueueStatus = "queued" | "signing" | "uploading" | "finishing" | "done" | "error" | "cancelled";

interface QueueItem {
  id: string; // client_upload_id
  file: File;
  kind: "image" | "video";
  status: QueueStatus;
  progress: number;
  error?: string;
  duplicateOfAssetId?: string | null;
  boundaryStart: boolean;
  xhr?: XMLHttpRequest;
  previewUrl?: string;
}

interface Props {
  batchId: string;
  onUploaded: () => void;
}

const ACCEPT = "image/*,video/*";

function kindOf(file: File): "image" | "video" {
  return file.type.startsWith("video/") ? "video" : "image";
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const supportsDirectoryPicker =
  typeof document !== "undefined" && "webkitdirectory" in document.createElement("input");

export function ImportUploader({ batchId, onUploaded }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef<string[]>([]);

  function patchItem(id: string, patch: Partial<QueueItem>) {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function uploadOne(item: QueueItem) {
    patchItem(item.id, { status: "signing", error: undefined });

    let sig: {
      signature: string;
      timestamp: number;
      apiKey: string;
      cloudName: string;
      uploadUrl: string;
      publicId: string;
      resourceType: string;
    };
    try {
      const res = await fetch("/api/import/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          batch_id: batchId,
          client_upload_id: item.id,
          filename: item.file.name,
          mime_type: item.file.type || "application/octet-stream",
          kind: item.kind,
          bytes: item.file.size,
          boundary_start: item.boundaryStart,
          original_relative_path: (item.file as unknown as { webkitRelativePath?: string }).webkitRelativePath || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not get an upload authorization");
      }
      sig = await res.json();
    } catch (e) {
      patchItem(item.id, { status: "error", error: e instanceof Error ? e.message : "Signing failed" });
      return;
    }

    patchItem(item.id, { status: "uploading", progress: 0 });

    let cloudinaryError: string | null = null;
    const cloudinaryResult = await new Promise<Record<string, unknown> | null>((resolve) => {
      const fd = new FormData();
      fd.append("file", item.file);
      fd.append("api_key", sig.apiKey);
      fd.append("timestamp", String(sig.timestamp));
      fd.append("signature", sig.signature);
      fd.append("public_id", sig.publicId);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", sig.uploadUrl);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          patchItem(item.id, { progress: Math.round((event.loaded / event.total) * 100) });
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            cloudinaryError = "Cloudinary returned an unreadable response";
            resolve(null);
          }
        } else {
          try {
            const body = JSON.parse(xhr.responseText);
            cloudinaryError = body?.error?.message || `Cloudinary upload failed (${xhr.status})`;
          } catch {
            cloudinaryError = `Cloudinary upload failed (${xhr.status})`;
          }
          resolve(null);
        }
      };
      xhr.onerror = () => {
        cloudinaryError = "Network error reaching Cloudinary";
        resolve(null);
      };
      xhr.onabort = () => resolve(null);
      patchItem(item.id, { xhr });
      xhr.send(fd);
    });

    if (!cloudinaryResult) {
      setQueue((prev) => {
        const current = prev.find((q) => q.id === item.id);
        if (current?.status === "cancelled") return prev;
        return prev.map((q) =>
          q.id === item.id ? { ...q, status: "error", error: cloudinaryError || "Upload to Cloudinary failed" } : q,
        );
      });
      return;
    }

    patchItem(item.id, { status: "finishing" });

    try {
      const res = await fetch("/api/import/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          batch_id: batchId,
          client_upload_id: item.id,
          kind: item.kind,
          cloudinary_public_id: cloudinaryResult.public_id,
          cloudinary_secure_url: cloudinaryResult.secure_url,
          cloudinary_etag: cloudinaryResult.etag ?? null,
          bytes: cloudinaryResult.bytes ?? item.file.size,
          width: cloudinaryResult.width ?? null,
          height: cloudinaryResult.height ?? null,
          duration_seconds: cloudinaryResult.duration ?? null,
          original_filename: item.file.name,
          original_relative_path: (item.file as unknown as { webkitRelativePath?: string }).webkitRelativePath || null,
          boundary_start: item.boundaryStart,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not finalize the upload");
      }
      const data = await res.json();
      patchItem(item.id, { status: "done", progress: 100, duplicateOfAssetId: data.duplicate_of_asset_id ?? null });
      onUploaded();
    } catch (e) {
      patchItem(item.id, { status: "error", error: e instanceof Error ? e.message : "Could not finalize the upload" });
    }
  }

  function enqueueFiles(files: FileList | File[]) {
    const items: QueueItem[] = Array.from(files)
      .filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"))
      .map((file) => ({
        id: newId(),
        file,
        kind: kindOf(file),
        status: "queued",
        progress: 0,
        boundaryStart: false,
        previewUrl: URL.createObjectURL(file),
      }));
    if (items.length === 0) return;
    for (const item of items) if (item.previewUrl) previewUrlsRef.current.push(item.previewUrl);
    setQueue((prev) => [...prev, ...items]);
    for (const item of items) void uploadOne(item);
  }

  // Intentionally reads the ref at cleanup time (not effect-run time) to
  // revoke every preview URL accumulated over the component's lifetime.
  useEffect(() => {
    return () => {
      const urls = previewUrlsRef.current;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  function retry(item: QueueItem) {
    void uploadOne(item);
  }

  function cancel(item: QueueItem) {
    item.xhr?.abort();
    patchItem(item.id, { status: "cancelled" });
  }

  function toggleBoundary(id: string) {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, boundaryStart: !q.boundaryStart } : q)));
  }

  return (
    <div className="space-y-4">
      {/* Desktop drag-and-drop + multi-select + folder select */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files.length) enqueueFiles(e.dataTransfer.files);
        }}
        className={`hidden rounded-sm border-2 border-dashed p-8 text-center sm:block ${
          dragActive ? "border-gold bg-gold/5" : "border-border"
        }`}
      >
        <p className="mb-3 text-sm text-foreground/80">Drag photos or videos here, or</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => desktopInputRef.current?.click()}>
            Choose files
          </Button>
          {supportsDirectoryPicker && (
            <Button type="button" variant="ghost" size="sm" onClick={() => folderInputRef.current?.click()}>
              Choose a folder
            </Button>
          )}
        </div>
        <input
          ref={desktopInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          data-testid="import-desktop-file-input"
          className="hidden"
          onChange={(e) => e.target.files && enqueueFiles(e.target.files)}
        />
        {supportsDirectoryPicker && (
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error non-standard attribute, feature-detected above
            webkitdirectory=""
            multiple
            className="hidden"
            onChange={(e) => e.target.files && enqueueFiles(e.target.files)}
          />
        )}
      </div>

      {/* Mobile: camera + library, presented as two explicit choices */}
      <div className="flex gap-3 sm:hidden">
        <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => cameraInputRef.current?.click()}>
          Take photo/video
        </Button>
        <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => libraryInputRef.current?.click()}>
          Choose from library
        </Button>
        <input
          ref={cameraInputRef}
          type="file"
          accept={ACCEPT}
          capture="environment"
          className="hidden"
          onChange={(e) => e.target.files && enqueueFiles(e.target.files)}
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => e.target.files && enqueueFiles(e.target.files)}
        />
      </div>

      {queue.length > 0 && (
        <ul className="divide-y divide-border rounded-sm border border-border bg-card text-sm">
          {queue.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3 py-2">
              {item.previewUrl && item.kind === "video" ? (
                <video src={item.previewUrl} muted playsInline preload="metadata" className="h-10 w-10 shrink-0 rounded-sm object-cover" />
              ) : item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not a remote/optimizable image
                <img src={item.previewUrl} alt="" className="h-10 w-10 shrink-0 rounded-sm object-cover" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] text-muted-foreground">
                  file
                </span>
              )}
              <div className="min-w-0 flex-1">
                <span className="block truncate">{item.file.name}</span>
                {item.status === "error" && item.error && (
                  <span className="block truncate text-[11px] text-destructive" title={item.error}>
                    {item.error}
                  </span>
                )}
              </div>
              <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={item.boundaryStart}
                  disabled={item.status !== "queued"}
                  onChange={() => toggleBoundary(item.id)}
                />
                Start next product
              </label>
              <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                {item.status === "uploading" ? `${item.progress}%` : item.status}
              </span>
              {item.duplicateOfAssetId && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">possible duplicate</span>
              )}
              {(item.status === "uploading" || item.status === "signing") && (
                <button type="button" className="shrink-0 text-xs text-destructive" onClick={() => cancel(item)}>
                  Cancel
                </button>
              )}
              {item.status === "error" && (
                <button type="button" className="shrink-0 text-xs text-primary underline" onClick={() => retry(item)}>
                  Retry
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
