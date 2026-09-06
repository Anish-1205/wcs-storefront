// Submits changed URLs to Bing/IndexNow so they're picked up faster than a
// crawl of /sitemap.xml alone. Manual — run after publishing a catalog
// change. See SEO_SETUP.md for setup (generating INDEXNOW_KEY, etc).
//
// Usage:
//   node scripts/indexnow.mjs                     # submits every URL in the live sitemap
//   node scripts/indexnow.mjs <url> <url> ...      # submits only the given URLs
import { existsSync, readFileSync } from "node:fs";

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
      }),
  );
}

const env = { ...readEnvFile(".env.local"), ...process.env };
const key = env.INDEXNOW_KEY;
const siteUrl = (env.NEXT_PUBLIC_SITE_URL || "https://weaversclubsarees.com").replace(/\/$/, "");

if (!key) {
  console.error("[indexnow] INDEXNOW_KEY is not set. See SEO_SETUP.md to generate one.");
  process.exit(1);
}

async function urlsFromSitemap() {
  const res = await fetch(`${siteUrl}/sitemap.xml`);
  if (!res.ok) throw new Error(`Failed to fetch ${siteUrl}/sitemap.xml (${res.status})`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
}

const explicitUrls = process.argv.slice(2);
const urlList = explicitUrls.length > 0 ? explicitUrls : await urlsFromSitemap();

if (urlList.length === 0) {
  console.error("[indexnow] No URLs to submit.");
  process.exit(1);
}

const host = new URL(siteUrl).host;
const body = {
  host,
  key,
  keyLocation: `${siteUrl}/${key}.txt`,
  urlList,
};

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

if (!res.ok) {
  console.error(`[indexnow] Submission failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log(`[indexnow] Submitted ${urlList.length} URL(s) for ${host}.`);
