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

const values = { ...readEnvFile(".env.local"), ...process.env };
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "NEXT_PUBLIC_WHATSAPP_NUMBER",
  "NEXT_PUBLIC_BUSINESS_NAME",
  "NEXT_PUBLIC_SITE_URL",
  "ADMIN_EMAILS",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

const missing = required.filter((name) => !values[name]);
const invalid = [];
if (/localhost|example\.com|yourdomain/i.test(values.NEXT_PUBLIC_SITE_URL ?? "")) invalid.push("NEXT_PUBLIC_SITE_URL must be the deployed HTTPS URL");
if (values.NEXT_PUBLIC_SITE_URL && !values.NEXT_PUBLIC_SITE_URL.startsWith("https://")) invalid.push("NEXT_PUBLIC_SITE_URL must use HTTPS");
if (!/^\d{10,15}$/.test(values.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "")) invalid.push("NEXT_PUBLIC_WHATSAPP_NUMBER must contain 10–15 digits only");

// Catalogue visibility (src/lib/storefront-catalog-resilience.ts). Both are
// optional and both default to the safe setting, so this only checks that a
// value which *is* set means what the operator thinks it means.
if (values.VISIBILITY_MAX_STALE_MS !== undefined && values.VISIBILITY_MAX_STALE_MS !== "") {
  const budget = Number(values.VISIBILITY_MAX_STALE_MS);
  if (!Number.isFinite(budget) || budget <= 0) {
    invalid.push("VISIBILITY_MAX_STALE_MS must be a positive number of milliseconds (unset = 900000, 15 minutes)");
  }
}
if (values.VISIBILITY_FAIL_OPEN !== undefined && values.VISIBILITY_FAIL_OPEN !== "" && values.VISIBILITY_FAIL_OPEN !== "1") {
  invalid.push('VISIBILITY_FAIL_OPEN must be "1" or unset');
}

const ingestNames = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_ADMIN_NUMBERS"];
if (ingestNames.some((name) => values[name]) && !ingestNames.every((name) => values[name])) {
  invalid.push(`WhatsApp ingestion is partially configured; set all of: ${ingestNames.join(", ")}`);
}

if (missing.length || invalid.length) {
  if (missing.length) console.error(`Missing required variables: ${missing.join(", ")}`);
  invalid.forEach((message) => console.error(message));
  process.exit(1);
}

const optional = ["RESEND_API_KEY", "INQUIRY_NOTIFICATION_EMAIL", "RESEND_FROM_EMAIL", "NEXT_PUBLIC_GA_MEASUREMENT_ID", "NEXT_PUBLIC_CLARITY_PROJECT_ID", "NEXT_PUBLIC_PINTEREST_TAG_ID", "NEXT_PUBLIC_SENTRY_DSN", "ANTHROPIC_API_KEY", "NEXT_PUBLIC_GSTIN", "NEXT_PUBLIC_CONTACT_EMAIL", "NEXT_PUBLIC_INSTAGRAM_URL", "NEXT_PUBLIC_GOOGLE_AUTH_ENABLED", "DATABASE_URL", "DATABASE_CA_CERT"];
const unsetOptional = optional.filter((name) => !values[name]);
console.log("Production environment configuration passed required checks.");
if (unsetOptional.length) console.warn(`Optional integrations not configured: ${unsetOptional.join(", ")}`);
// Not a failure — it is a deliberate incident setting — but it must never be
// left on unnoticed: with it on, a product hidden in admin can be shown.
// In production that is a live customer-facing risk, so it is impossible to
// miss in a deploy log rather than one line among the optional-integration
// notes. "Production" = this script's own --production flag (how
// `npm run check:env` runs it), Vercel's own environment, or NODE_ENV.
if (values.VISIBILITY_FAIL_OPEN === "1") {
  const isProduction =
    process.argv.includes("--production") || values.VERCEL_ENV === "production" || values.NODE_ENV === "production";
  if (isProduction) {
    const rule = "=".repeat(78);
    console.warn(
      `\n${rule}\n` +
        "!!  WARNING: VISIBILITY_FAIL_OPEN=1 IN PRODUCTION\n" +
        `${rule}\n` +
        "!!  The live storefront will keep listing products even when it cannot\n" +
        "!!  confirm which ones admin has hidden. A saree that has been taken\n" +
        "!!  down can therefore be shown to customers, and in the worst case\n" +
        "!!  the whole file catalogue is served with no hidden list at all.\n" +
        "!!\n" +
        "!!  This is an incident-only override. Unset it as soon as Supabase is\n" +
        "!!  healthy again. See docs/storefront-catalogue.md.\n" +
        `${rule}\n`,
    );
  } else {
    console.warn(
      "VISIBILITY_FAIL_OPEN=1: the storefront will list products even when it cannot confirm which are hidden. Unset it once the incident is over.",
    );
  }
}
if (values.CATALOG_SNAPSHOT_OPTIONAL === "1") {
  console.warn("CATALOG_SNAPSHOT_OPTIONAL=1: a production build will not fail if the hidden-slug snapshot cannot be taken.");
}
