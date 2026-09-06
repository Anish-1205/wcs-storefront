import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * Web app manifest. Next serves this at /manifest.webmanifest and links it
 * automatically. Icons point at the app-directory icon files (also used for
 * the favicon / apple-touch-icon).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: "WCS",
    description: SITE.tagline,
    start_url: "/",
    display: "standalone",
    background_color: "#FAF2E7",
    theme_color: "#100D0E",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
