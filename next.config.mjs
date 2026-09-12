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
  async redirects() {
    return [{ source: "/wholesale", destination: "/contact", permanent: false }];
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
