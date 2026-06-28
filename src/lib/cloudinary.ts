// Cloudinary URL transform helpers.
// Named transforms from the deployment plan:
//   thumbnail: c_fill,w_400,h_500,q_auto,f_auto
//   pinterest: c_fill,w_1000,h_1500,q_auto,f_auto

type Transform = "thumbnail" | "pinterest" | "card" | "full";

const TRANSFORMS: Record<Transform, string> = {
  thumbnail: "c_fill,w_400,h_500,q_auto,f_auto",
  card: "c_fill,w_600,h_800,q_auto,f_auto",
  full: "c_fill,w_1200,h_1600,q_auto,f_auto",
  pinterest: "c_fill,w_1000,h_1500,q_auto,f_auto",
};

/**
 * Apply a named transform to a Cloudinary delivery URL.
 * If the URL is not a Cloudinary upload URL it is returned unchanged
 * (e.g. Unsplash placeholders during dev).
 */
export function cld(url: string | null | undefined, transform: Transform = "card"): string {
  if (!url) return "";
  const marker = "/upload/";
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  // Avoid double-applying if a transform is already present.
  const after = url.slice(idx + marker.length);
  if (after.startsWith("c_") || after.startsWith("w_") || after.startsWith("q_")) {
    return url;
  }
  return `${url.slice(0, idx + marker.length)}${TRANSFORMS[transform]}/${after}`;
}

/**
 * Build a signed-upload payload (SERVER ONLY).
 * Called from /api/upload after the admin session is verified. The API secret
 * is used here only for SHA-1 signing and never leaves the server.
 */
export async function signUpload(params: Record<string, string | number>) {
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!apiSecret || !apiKey || !cloudName) {
    throw new Error("Cloudinary server credentials are not configured.");
  }

  // Cloudinary signs the sorted, &-joined param string + the api secret (SHA-1).
  const toSign =
    Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&") + apiSecret;

  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(toSign),
  );
  const signature = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    signature,
    apiKey,
    cloudName,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
  };
}
