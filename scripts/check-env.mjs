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

const ingestNames = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_ADMIN_NUMBERS"];
if (ingestNames.some((name) => values[name]) && !ingestNames.every((name) => values[name])) {
  invalid.push(`WhatsApp ingestion is partially configured; set all of: ${ingestNames.join(", ")}`);
}

if (missing.length || invalid.length) {
  if (missing.length) console.error(`Missing required variables: ${missing.join(", ")}`);
  invalid.forEach((message) => console.error(message));
  process.exit(1);
}

const optional = ["RESEND_API_KEY", "INQUIRY_NOTIFICATION_EMAIL", "RESEND_FROM_EMAIL", "NEXT_PUBLIC_GA_MEASUREMENT_ID", "NEXT_PUBLIC_CLARITY_PROJECT_ID", "NEXT_PUBLIC_PINTEREST_TAG_ID", "NEXT_PUBLIC_SENTRY_DSN", "ANTHROPIC_API_KEY", "NEXT_PUBLIC_GSTIN", "NEXT_PUBLIC_CONTACT_EMAIL", "NEXT_PUBLIC_INSTAGRAM_URL", "NEXT_PUBLIC_GOOGLE_AUTH_ENABLED"];
const unsetOptional = optional.filter((name) => !values[name]);
console.log("Production environment configuration passed required checks.");
if (unsetOptional.length) console.warn(`Optional integrations not configured: ${unsetOptional.join(", ")}`);
