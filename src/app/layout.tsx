import * as Sentry from "@sentry/nextjs";
import type { Metadata } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import { SITE, SOCIAL_LINKS } from "@/lib/site";
import { jsonLdScript } from "@/lib/json-ld";
import { Analytics } from "@/components/layout/Analytics";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-playfair",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(SITE.url),
    title: {
      default: SITE.seoTitle,
      template: `%s | ${SITE.name}`,
    },
    description: SITE.description,
    applicationName: SITE.name,
    openGraph: {
      type: "website",
      siteName: SITE.name,
      title: SITE.seoTitle,
      description: SITE.description,
      images: [
        { url: "/brand/og.jpg", width: 1200, height: 630, alt: SITE.name },
      ],
    },
    twitter: { card: "summary_large_image" },
    robots: { index: true, follow: true },
    verification: {
      ...(process.env.GOOGLE_SITE_VERIFICATION
        ? { google: process.env.GOOGLE_SITE_VERIFICATION }
        : {}),
      ...(process.env.BING_SITE_VERIFICATION
        ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } }
        : {}),
    },
    other: {
      ...Sentry.getTraceData(),
    },
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var c=localStorage.getItem('wcs.theme');var t=(c==='dark'||c==='light')?c:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: SITE.name,
              url: SITE.url,
              logo: new URL(SITE.logo, SITE.url).toString(),
              ...(SITE.gstin ? { taxID: SITE.gstin } : {}),
              ...(SOCIAL_LINKS.length > 0
                ? { sameAs: SOCIAL_LINKS.map((s) => s.url) }
                : {}),
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: SITE.name,
              url: SITE.url,
              potentialAction: {
                "@type": "SearchAction",
                target: `${SITE.url}/search?q={search_term_string}`,
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
