/**
 * Pure helpers for a product variant's image list, shared by ImageUploader
 * and VariantManager. Kept out of those "use client" component files so
 * they (and their tests) don't need to load any JSX.
 */

export interface UploadedImage {
  image_url: string;
  is_primary: boolean;
  display_order: number;
  /** "video" only ever comes from the WhatsApp ingestion flow, which is the
   * only path that attaches video to a variant — everything uploaded via
   * ImageUploader's own file picker is always "image". */
  media_type: "image" | "video";
}

/**
 * Whether a variant_images row is really a video — checks media_type first,
 * but also falls back to the Cloudinary URL shape (/video/upload/ or a
 * video file extension). Older rows can have a stale media_type of "image"
 * from before this column existed on the save path (any edit-and-save
 * before that fix silently reset it to the column default) — the URL
 * itself still reveals the truth, so this self-heals the display for that
 * existing data without needing a backfill.
 */
export function isVideoMedia(img: Pick<UploadedImage, "media_type" | "image_url">): boolean {
  if (img.media_type === "video") return true;
  return /\/video\/upload\//.test(img.image_url) || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(img.image_url);
}

/** Recomputes display_order after any reorder/add/remove, and makes sure
 * exactly one image is primary (promoting the first one) if none is. */
export function reindexImages(images: UploadedImage[]): UploadedImage[] {
  const next = images.map((img, i) => ({ ...img, display_order: i }));
  if (next.length > 0 && !next.some((img) => img.is_primary)) {
    next[0] = { ...next[0], is_primary: true };
  }
  return next;
}

/** One entry in the product preview's media strip. */
export interface PreviewMedia {
  image_url: string;
  is_primary: boolean;
  isVideo: boolean;
  colour: string;
  variantIndex: number;
}

/**
 * Flattens every variant's media into one strip, in variant then display
 * order, tagged with the colourway it belongs to.
 */
export function previewMediaFor(
  variants: Array<{ color: string; images: UploadedImage[] }>,
): PreviewMedia[] {
  return variants.flatMap((variant, variantIndex) =>
    variant.images.map((image) => ({
      image_url: image.image_url,
      is_primary: image.is_primary,
      isVideo: isVideoMedia(image),
      colour: variant.color,
      variantIndex,
    })),
  );
}

/**
 * The photo the preview should show large: the one the admin picked, else
 * the primary, else the first.
 *
 * Resolving by URL rather than holding an index is what keeps the preview
 * correct while the form is edited underneath it — deleting, reordering or
 * moving the selected photo to another variant falls back cleanly instead of
 * showing the wrong saree or going blank.
 */
export function pickPreviewHero(
  media: PreviewMedia[],
  selectedUrl: string | null,
): PreviewMedia | null {
  return (
    media.find((m) => m.image_url === selectedUrl) ??
    media.find((m) => m.is_primary) ??
    media[0] ??
    null
  );
}
