/**
 * Take the build-time snapshot of the slugs admin has hidden
 * (see src/lib/catalog-visibility-snapshot.mjs for why it exists).
 *
 *   node scripts/snapshot-catalog-visibility.mjs
 *
 * Runs before `next build` (prebuild). It makes one small read of
 * `storefront_hidden_slugs` with the anon key and writes
 * .generated/catalog-visibility.json, which next.config.mjs inlines into the
 * server bundle.
 *
 * When the read fails:
 *   - a production deploy on Vercel (VERCEL_ENV=production) stops here. The
 *     deployment that is already live keeps serving with the snapshot it was
 *     built with, which is safer than shipping one that cannot tell what is
 *     hidden. Set CATALOG_SNAPSHOT_OPTIONAL=1 to deploy anyway.
 *   - every other build (local, CI, previews) carries on without a fresh
 *     snapshot; CI builds against a placeholder Supabase URL on purpose.
 * Either way a snapshot already on disk is never replaced by a failed read.
 */
import { existsSync, readFileSync } from "node:fs";
import { SNAPSHOT_FILE, writeVisibilitySnapshot } from "../src/lib/catalog-visibility-snapshot.mjs";

// Same reader as scripts/check-env.mjs: `next build` loads .env.local itself,
// but this runs before it.
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
const required = env.VERCEL_ENV === "production" && env.CATALOG_SNAPSHOT_OPTIONAL !== "1";

const result = await writeVisibilitySnapshot({
  url: env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

if (result.ok) {
  console.log(`catalog visibility snapshot: ${result.count} hidden slug(s) written to ${SNAPSHOT_FILE}`);
} else if (required) {
  const missingView = /HTTP 40[14]/.test(result.reason);
  console.error(
    `catalog visibility snapshot FAILED: ${result.reason}\n` +
      "This is a production build, so it stops here rather than ship a storefront that cannot tell which\n" +
      "products admin has hidden if Supabase is unreachable. The live deployment is unaffected.\n" +
      (missingView
        ? "That status usually means the storefront_hidden_slugs view is missing or not readable by the anon\n" +
          "key: apply supabase/migrations/021_storefront_hidden_slugs.sql, then redeploy.\n"
        : "") +
      "Retry once Supabase is reachable, or set CATALOG_SNAPSHOT_OPTIONAL=1 to deploy without the snapshot.",
  );
  process.exit(1);
} else {
  console.warn(
    `catalog visibility snapshot skipped: ${result.reason}` +
      (result.keptExisting ? ` (keeping the existing ${SNAPSHOT_FILE})` : " (building without one)"),
  );
}
