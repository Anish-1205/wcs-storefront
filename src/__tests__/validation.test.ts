import { afterEach, describe, expect, it } from "vitest";
import { inquirySchema, subscriberSchema } from "@/lib/validation";
import { isEmailAllowed } from "@/lib/admin-auth";

describe("inquirySchema", () => {
  it("accepts a valid retail inquiry", () => {
    const result = inquirySchema.safeParse({
      name: "Asha",
      phone: "+91 98765 43210",
      email: "asha@example.com",
      message: "Interested in bridal sarees",
      inquiry_type: "retail",
      product_id: null,
      variant_id: null,
      product_name: null,
      source: "direct",
      website: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.inquiry_type).toBe("retail");
    }
  });

  it("rejects an invalid phone number", () => {
    const result = inquirySchema.safeParse({
      name: "Asha",
      phone: "abc",
      email: "",
      message: "",
      inquiry_type: "general",
      source: "unknown",
      website: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]?.message).toContain("valid phone");
    }
  });
});

describe("subscriberSchema", () => {
  it("accepts a valid subscriber payload", () => {
    const result = subscriberSchema.safeParse({
      name: "Riya",
      phone: "+919876543210",
      source: "direct",
    });

    expect(result.success).toBe(true);
  });
});

describe("isEmailAllowed", () => {
  const original = process.env.ADMIN_EMAILS;

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = original;
  });

  it("allows only configured admin emails", () => {
    process.env.ADMIN_EMAILS = "admin@example.com, owner@example.com";

    expect(isEmailAllowed("admin@example.com")).toBe(true);
    expect(isEmailAllowed("Owner@Example.com")).toBe(true);
    expect(isEmailAllowed("guest@example.com")).toBe(false);
    expect(isEmailAllowed(null)).toBe(false);
  });
});
