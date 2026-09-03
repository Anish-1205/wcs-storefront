import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isAllowedWhatsAppAdmin,
  normalizePhone,
  verifyWhatsAppSignature,
} from "@/lib/webhook-security";

describe("WhatsApp webhook security", () => {
  it("normalizes and allowlists exact administrator numbers", () => {
    expect(normalizePhone("+91 98765-43210")).toBe("919876543210");
    expect(isAllowedWhatsAppAdmin("+91 98765 43210", "919876543210, 447700900123")).toBe(true);
    expect(isAllowedWhatsAppAdmin("919999999999", "919876543210")).toBe(false);
    expect(isAllowedWhatsAppAdmin("919876543210", "")).toBe(false);
  });

  it("accepts only a valid sha256 signature", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    const secret = "test-app-secret";
    const digest = createHmac("sha256", secret).update(body).digest("hex");

    expect(verifyWhatsAppSignature(body, `sha256=${digest}`, secret)).toBe(true);
    expect(verifyWhatsAppSignature(body, `sha256=${"0".repeat(64)}`, secret)).toBe(false);
    expect(verifyWhatsAppSignature(body, null, secret)).toBe(false);
    expect(verifyWhatsAppSignature(body, `sha256=${digest}`, "")).toBe(false);
  });
});
