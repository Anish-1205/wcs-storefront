import { withSentryConfig } from "@sentry/nextjs";

// Scope the Cloudinary remote pattern to our own delivery account. Cloudinary
// URLs are https://res.cloudinary.com/<cloud-name>/<resource>/... so restricting
// the pathname to our cloud name stops the Image Optimizer being used as a
// fetch proxy for arbitrary third-party Cloudinary accounts. Falls back to the
// broad pattern only if the (public) cloud name is unavailable at build time.
const cloudinaryCloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
    // Product photography contains fine weave and zari detail. Keep those
    // details through the final Next.js encode while still serving responsive
    // AVIF/WebP sizes for each viewport.
    // 75 remains available for small admin/interface thumbnails; storefront
    // photography opts into 90 in the components below.
    qualities: [75, 90],
    // Next's defaults (8 deviceSizes x 8 imageSizes) generate far more
    // variants than this site ever requests: source photography is capped at
    // 1600px (scripts/prepare-media.mjs MAX_EDGE) or 1800px (Cloudinary's
    // "full" transform, src/lib/cloudinary.ts), so device widths above ~1920
    // are pure waste, and the layout never needs the full stock ladder of
    // tiny imageSizes either (actual `fill` thumbnails use 14-112px, ~44-96
    // for admin panels, ~400+ for cards/galleries). Trimming both arrays
    // directly cuts the per-image variant count Vercel bills as
    // transformations.
    deviceSizes: [384, 640, 828, 1080, 1280, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: cloudinaryCloudName ? `/${cloudinaryCloudName}/**` : "/**",
      },
    ],
  },
  // The /wholesale page was removed (Sept 2026) — "Ask on WhatsApp" is now the
  // one consistent CTA for resellers and retail customers alike. Redirect any
  // bookmarked/shared links instead of 404ing.
  // Retired product slugs (see RETIRED_SLUGS in src/data/products.ts) keep
  // their URL working — they are linked from WhatsApp threads and indexed by
  // search — by pointing at the product that absorbed them.
  async redirects() {
    return [
      { source: "/wholesale", destination: "/contact", permanent: false },
      {
        // WCS-024, the dusty-pink colourway, is now part of WCS-023.
        source: "/sarees/bandhani-on-gaji-silk-sarees-with-hand-work",
        destination: "/sarees/the-most-demanded-collection-in-georgette-parsi-work-sarees",
        permanent: false,
      },
    ];
  },
  // /admin/database reads supabase/migrations/*.sql off disk at request time
  // (fs.readdirSync/readFileSync inside a Server Action) — Next's build-time
  // file tracer can't see that (it only sees static imports), so without this
  // the folder is silently dropped from the deployed function's bundle: works
  // in `next dev` (reads straight off disk), 500s once deployed. See
  // src/app/admin/db-migrations-actions.ts.
  outputFileTracingIncludes: {
    "/admin/database": ["./supabase/migrations/**/*.sql"],
  },
  // Static, request-independent security headers. The Content-Security-Policy
  // itself is set per-request in middleware.ts (it needs a fresh nonce), not here.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "anishs-org",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  hideSourceMaps: true,

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
