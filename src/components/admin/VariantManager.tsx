"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ImageUploader } from "./ImageUploader";
import { isVideoMedia, reindexImages, type UploadedImage } from "@/lib/variant-images";
import { detectVariantColor } from "@/app/admin/variant-color-actions";
import { displayColourName } from "@/lib/colour-variants";
import type { VariantInputShape } from "@/lib/validation";

interface Props {
  variants: VariantInputShape[];
  onChange: (variants: VariantInputShape[]) => void;
}

const emptyVariant = (order: number): VariantInputShape => ({
  color: "",
  color_hex: "#6B1E2E",
  status: "available",
  price_min: null,
  price_max: null,
  display_order: order,
  images: [],
});

const defaultSingleVariant = (order: number): VariantInputShape => ({
  ...emptyVariant(order),
  color: "Single color",
});

// The server-side Anthropic call already aborts itself at 20s (see
// REQUEST_TIMEOUT_MS in anthropic-provider.ts) — this is a client-side
// backstop so the UI can never get stuck on "detecting…" even if that
// response somehow never makes it back (a hung connection, a platform-level
// function timeout cutting the request off mid-flight, etc).
const DETECTION_TIMEOUT_MS = 25_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Colour detection timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

let clientKeySeq = 0;
function makeClientKey() {
  clientKeySeq += 1;
  return `new-${Date.now().toString(36)}-${clientKeySeq}`;
}

export function VariantManager({ variants, onChange }: Props) {
  // Stable per-row identity, independent of array index (which shifts on
  // reorder/add/remove) — an existing variant keys off its DB id, a brand
  // new one gets a generated client-only key. Used as the React `key`, as
  // the drag-and-drop identifier, and to track colour auto-detection below.
  const [variantKeys, setVariantKeys] = useState<string[]>(() =>
    variants.map((v) => v.id ?? makeClientKey()),
  );
  // Per-variant colour-detection status (drives the "Detecting…" /
  // "couldn't detect" hints) — this IS rendered, so it's real state. Absent
  // key = idle (nothing in flight, no error to show).
  const [detectionStatus, setDetectionStatus] = useState<Record<string, "detecting" | "error">>({});

  // Everything below is read inside an async (`.then`) callback that can
  // resolve seconds after further edits happened — refs keep it reading the
  // latest values instead of whatever was captured when the request started.
  const variantsRef = useRef(variants);
  variantsRef.current = variants;
  const variantKeysRef = useRef(variantKeys);
  variantKeysRef.current = variantKeys;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // key -> true once its colour was set by auto-detection (never manually
  // typed since) — the ONLY state that decides whether the next detection
  // is allowed to overwrite it. Not rendered, so a ref is enough (and, since
  // it's read from the async callback, a ref is exactly what avoids acting
  // on a stale "was this manually edited in the meantime" snapshot).
  const autoDetectedRef = useRef<Record<string, boolean>>({});
  // Per-variant request counter so a slow, superseded detection response
  // (e.g. two drags into the same variant in quick succession) never
  // clobbers a newer one that already resolved.
  const detectionSeqRef = useRef<Record<string, number>>({});

  function syncKeys(nextVariants: VariantInputShape[], nextKeys: string[]) {
    setVariantKeys(nextKeys);
    onChange(nextVariants);
  }

  function update(i: number, patch: Partial<VariantInputShape>) {
    onChange(variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }

  function add() {
    syncKeys([...variants, emptyVariant(variants.length)], [...variantKeys, makeClientKey()]);
  }
  function addSingle() {
    syncKeys([...variants, defaultSingleVariant(variants.length)], [...variantKeys, makeClientKey()]);
  }
  function remove(i: number) {
    const nextVariants = variants
      .filter((_, idx) => idx !== i)
      .map((v, idx) => ({ ...v, display_order: idx }));
    const nextKeys = variantKeys.filter((_, idx) => idx !== i);
    syncKeys(nextVariants, nextKeys);
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= variants.length) return;
    const nextVariants = [...variants];
    [nextVariants[i], nextVariants[j]] = [nextVariants[j], nextVariants[i]];
    const nextKeys = [...variantKeys];
    [nextKeys[i], nextKeys[j]] = [nextKeys[j], nextKeys[i]];
    syncKeys(
      nextVariants.map((v, idx) => ({ ...v, display_order: idx })),
      nextKeys,
    );
  }

  /** A manual edit to colour/swatch always wins — clear the auto-detected
   * flag so future re-detection knows to leave it alone. */
  function updateColorManually(i: number, key: string, patch: Partial<VariantInputShape>) {
    update(i, patch);
    autoDetectedRef.current = { ...autoDetectedRef.current, [key]: false };
    // A manual edit resolves any lingering "couldn't detect" hint too.
    setDetectionStatus((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function scheduleColorDetection(key: string, images: UploadedImage[]) {
    const mySeq = (detectionSeqRef.current[key] ?? 0) + 1;
    detectionSeqRef.current = { ...detectionSeqRef.current, [key]: mySeq };

    // Colour detection is a photo-only concept — a WhatsApp-attached video
    // sent to the vision API as an "image" is exactly what was producing
    // the request failed (400) / response failed validation errors.
    const photoUrls = images.filter((img) => !isVideoMedia(img)).map((img) => img.image_url);
    if (photoUrls.length === 0) {
      setDetectionStatus((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    setDetectionStatus((prev) => ({ ...prev, [key]: "detecting" }));

    withTimeout(detectVariantColor(photoUrls), DETECTION_TIMEOUT_MS)
      .then((result) => {
        if (detectionSeqRef.current[key] !== mySeq) return; // superseded

        if (!result) {
          setDetectionStatus((prev) => ({ ...prev, [key]: "error" }));
          return;
        }

        const idx = variantKeysRef.current.indexOf(key);
        if (idx === -1) return; // variant removed while detection was running

        const current = variantsRef.current[idx];
        const isProtected = current.color.trim() !== "" && autoDetectedRef.current[key] !== true;
        if (isProtected) {
          setDetectionStatus((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          return; // admin's own colour — never overwrite it
        }

        onChangeRef.current(
          variantsRef.current.map((v, i) =>
            i === idx
              ? {
                  ...v,
                  color: displayColourName(result.color),
                  color_hex: result.color_hex ?? v.color_hex,
                }
              : v,
          ),
        );
        autoDetectedRef.current = { ...autoDetectedRef.current, [key]: true };
        setDetectionStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      })
      .catch((error) => {
        if (detectionSeqRef.current[key] !== mySeq) return;
        setDetectionStatus((prev) => ({ ...prev, [key]: "error" }));
        console.warn("Colour detection failed", error instanceof Error ? error.message : error);
      });
  }

  function updateImages(i: number, key: string, images: UploadedImage[]) {
    update(i, { images });
    scheduleColorDetection(key, images);
  }

  /** Reassigns one image from another variant's grid into this one —
   * mutates both variants' image arrays in a single update. `atIndex` places
   * it at that position (dropped on a specific thumbnail); omitted appends
   * it to the end (dropped on open grid space). */
  function handleExternalDrop(fromKey: string, fromImageIndex: number, toKey: string, atIndex?: number) {
    if (fromKey === toKey) return;
    const fromIdx = variantKeys.indexOf(fromKey);
    const toIdx = variantKeys.indexOf(toKey);
    if (fromIdx === -1 || toIdx === -1) return;

    const fromImages = [...variants[fromIdx].images];
    const [moved] = fromImages.splice(fromImageIndex, 1);
    if (!moved) return;
    const toImages = [...variants[toIdx].images];
    const movedImage = { ...moved, is_primary: false };
    if (atIndex == null || atIndex >= toImages.length) {
      toImages.push(movedImage);
    } else {
      toImages.splice(atIndex, 0, movedImage);
    }

    const reindexedFrom = reindexImages(fromImages);
    const reindexedTo = reindexImages(toImages);

    onChange(
      variants.map((v, idx) => {
        if (idx === fromIdx) return { ...v, images: reindexedFrom };
        if (idx === toIdx) return { ...v, images: reindexedTo };
        return v;
      }),
    );

    scheduleColorDetection(fromKey, reindexedFrom);
    scheduleColorDetection(toKey, reindexedTo);
  }

  return (
    <div className="space-y-4">
      {variants.length === 0 && (
        <div className="rounded-sm border border-dashed border-border bg-secondary/20 p-4">
          <p className="text-sm text-foreground/80">
            This saree can have one version or multiple color variants.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button type="button" variant="outline" size="sm" onClick={addSingle}>
              + Add single variant
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={add}>
              + Add color variant
            </Button>
          </div>
        </div>
      )}

      {variants.map((v, i) => {
        const key = variantKeys[i];
        return (
          <div key={key} className="rounded-sm border border-border bg-secondary/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-primary">
                Variant {i + 1}
              </span>
              <div className="flex items-center gap-2 text-xs">
                <button type="button" onClick={() => move(i, -1)} className="px-1" aria-label="Move up">↑</button>
                <button type="button" onClick={() => move(i, 1)} className="px-1" aria-label="Move down">↓</button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-destructive hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-xs text-muted-foreground">
                  Color name *
                  {detectionStatus[key] === "detecting" && (
                    <span className="italic text-antique-gold"> — detecting…</span>
                  )}
                  {detectionStatus[key] === "error" && (
                    <span className="italic text-destructive"> — couldn&apos;t detect, enter manually</span>
                  )}
                </label>
                <Input
                  value={v.color}
                  onChange={(e) => updateColorManually(i, key, { color: e.target.value })}
                  placeholder="e.g. Maroon"
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Color swatch</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={v.color_hex ?? "#6B1E2E"}
                    onChange={(e) => updateColorManually(i, key, { color_hex: e.target.value })}
                    className="h-9 w-12 rounded-sm border border-input"
                  />
                  <Input
                    value={v.color_hex ?? ""}
                    onChange={(e) => updateColorManually(i, key, { color_hex: e.target.value })}
                    className="h-9"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Status</label>
                <Select
                  value={v.status}
                  onChange={(e) =>
                    update(i, { status: e.target.value as VariantInputShape["status"] })
                  }
                  className="h-9"
                >
                  <option value="available">Available</option>
                  <option value="sold_out">Sold out</option>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Price min</label>
                  <Input
                    type="number"
                    value={v.price_min ?? ""}
                    onChange={(e) =>
                      update(i, { price_min: e.target.value ? Number(e.target.value) : null })
                    }
                    placeholder="₹"
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Price max</label>
                  <Input
                    type="number"
                    value={v.price_max ?? ""}
                    onChange={(e) =>
                      update(i, { price_max: e.target.value ? Number(e.target.value) : null })
                    }
                    placeholder="₹"
                    className="h-9"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label className="text-xs text-muted-foreground">Images</label>
              <p className="mb-1 text-[11px] text-muted-foreground/70">
                Drag a photo to reorder it within this grid, or onto another variant&apos;s grid to
                move it there — colour name/swatch re-detect automatically unless you&apos;ve set
                them yourself.
              </p>
              <div className="mt-1">
                <ImageUploader
                  images={v.images}
                  onChange={(images) => updateImages(i, key, images)}
                  dragId={key}
                  onExternalImageDrop={(fromKey, imageIndex, atIndex) =>
                    handleExternalDrop(fromKey, imageIndex, key, atIndex)
                  }
                />
              </div>
            </div>
          </div>
        );
      })}

      {variants.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" size="sm" onClick={addSingle}>
            + Add single variant
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={add}>
            + Add color variant
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Leave a variant&apos;s price blank to use the product&apos;s base price range.
      </p>
    </div>
  );
}
