import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_WEBHOOK_BYTES = 1_000_000;

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export function isAllowedWhatsAppAdmin(
  sender: string,
  configured = process.env.WHATSAPP_ADMIN_NUMBERS ?? "",
): boolean {
  const normalizedSender = normalizePhone(sender);
  if (!normalizedSender) return false;

  return configured
    .split(",")
    .map(normalizePhone)
    .filter(Boolean)
    .includes(normalizedSender);
}

export function verifyWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret = process.env.WHATSAPP_APP_SECRET ?? "",
): boolean {
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;

  const supplied = signatureHeader.slice("sha256=".length).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}
