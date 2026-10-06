// The one next/image loader for the whole app (`images.loaderFile` in
// next.config.mjs). Nothing goes through Vercel's `/_next/image` optimizer:
// once its transformation allowance is spent it answers 402 for every size
// not already cached, which is how new product photos came to show as alt
// text on the live storefront.
//
//  - Cloudinary media is resized by Cloudinary itself (f_auto,q_auto,w_<n>,c_limit).
//  - Photos under public/media are served from the pre-sized WebP copies that
//    scripts/build-media-variants.mjs writes to public/m/<width>/.
//  - Anything else (brand PNGs, data: URIs, other hosts) is returned as-is.

/** Widths scripts/build-media-variants.mjs produces. Keep the two in step. */
export const LOCAL_VARIANT_WIDTHS = [128, 384, 640] as const;

const CLOUDINARY_HOST = "res.cloudinary.com";
// A transformation segment is a comma list of `<1-3 letter key>_<value>`
// (c_fill,w_400 / so_0 / f_auto), which a version (v123) or folder never is.
const TRANSFORM_SEGMENT = /^[a-z]{1,3}_[^/,]+(,[a-z]{1,3}_[^/,]+)*$/;
const VIDEO_FILE = /\.(mp4|mov|webm|m4v)$/i;
const LOCAL_PHOTO = /^\/media\/(.+)\.(jpe?g|png)$/i;

function cloudinaryUrl(src: string, width: number): string | null {
  let url: URL;
  try { url = new URL(src); } catch { return null; }
  if (url.hostname !== CLOUDINARY_HOST) return null;
  const match = /^(\/[^/]+\/(image|video)\/upload\/)(.+)$/.exec(url.pathname);
  if (!match) return null; // raw files, fetch/private delivery types: leave alone
  const [, prefix, resource, rest] = match;

  const segments = rest.split("/");
  const existing: string[] = [];
  while (segments.length > 1 && TRANSFORM_SEGMENT.test(segments[0])) existing.push(segments.shift()!);
  let path = segments.join("/");

  // f_auto on a video resource negotiates a *video* format, so a frame taken
  // from a video is always asked for as a JPG instead.
  let resize = resource === "image" ? `f_auto,q_auto,w_${width},c_limit` : `q_auto,w_${width},c_limit`;
  if (resource === "video" && VIDEO_FILE.test(path)) {
    // A video URL in an <img> can never render: ask for its poster frame.
    path = path.replace(VIDEO_FILE, ".jpg");
    if (!existing.some((segment) => /(^|,)so_/.test(segment))) resize = `so_0,${resize}`;
  }

  // An existing transformation (a crop from `cld`, the poster frame from
  // `cldVideoThumbnail`) is kept and the resize is chained after it.
  url.pathname = `${prefix}${[...existing, resize].join("/")}/${path}`;
  return url.href;
}

function localVariant(src: string, width: number): string | null {
  const match = LOCAL_PHOTO.exec(src);
  if (!match) return null;
  const variant = LOCAL_VARIANT_WIDTHS.find((candidate) => candidate >= width);
  // Wider than the largest copy: the original is already capped at 1600px.
  return variant ? `/m/${variant}/${match[1]}.webp` : src;
}

export default function imageLoader({ src, width }: { src: string; width: number; quality?: number }): string {
  return cloudinaryUrl(src, width) ?? localVariant(src, width) ?? src;
}
