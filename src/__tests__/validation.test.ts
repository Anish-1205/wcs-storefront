import { afterEach, describe, expect, it } from "vitest";
import {
  contactSchema,
  firstIssueMessage,
  inquirySchema,
  productInputSchema,
  subscriberSchema,
} from "@/lib/validation";
import { isEmailAllowed } from "@/lib/admin-auth";

describe("productInputSchema variant images", () => {
  const base = {
    name: "Kanjivaram",
    slug: "kanjivaram",
    category_id: null,
    fabric_type: null,
    description: null,
    highlights: [],
    base_price_min: null,
    base_price_max: null,
    status: "draft" as const,
    product_code: null,
    is_featured: false,
    stock_type: "held" as const,
    collection_ids: [],
  };

  function withImage(image_url: string) {
    return productInputSchema.safeParse({
      ...base,
      variants: [
        {
          color: "Green",
          color_hex: null,
          status: "available" as const,
          price_min: null,
          price_max: null,
          display_order: 0,
          images: [{ image_url, is_primary: true, display_order: 0 }],
        },
      ],
    });
  }

  it("accepts a site-relative media path (file-synced products)", () => {
    expect(withImage("/media/kanjivaram/01.jpg").success).toBe(true);
  });

  it("accepts an absolute Cloudinary URL", () => {
    expect(withImage("https://res.cloudinary.com/demo/image/upload/x.jpg").success).toBe(true);
  });

  it("rejects a bare string that is neither a URL nor a rooted path", () => {
    const result = withImage("media/kanjivaram/01.jpg");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstIssueMessage(result.error, "fallback")).toBe(
        "variants.0.images.0.image_url: Invalid url",
      );
    }
  });
});

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

describe("contactSchema", () => {
  it("accepts HTML date values and normalizes them", () => {
    const result = contactSchema.safeParse({
      name: "Asha",
      phone: "+91 98765 43210",
      role: "customer",
      status_tag: "regular",
      city: null,
      source: "manual",
      whatsapp_opt_in: false,
      rating: null,
      notes: null,
      last_contacted_at: "2026-07-17T09:30",
      next_follow_up_on: "2026-08-01",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.last_contacted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(result.data.next_follow_up_on).toBe("2026-08-01");
    }
  });

  it("accepts legacy date strings and blanks", () => {
    const result = contactSchema.safeParse({
      name: "Meera",
      phone: "+91 90000 00000",
      role: "reseller",
      status_tag: "priority",
      city: "Surat",
      source: "import",
      whatsapp_opt_in: true,
      rating: 4,
      notes: "",
      last_contacted_at: "17-07-2026 14:15",
      next_follow_up_on: "17-08-2026",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.last_contacted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(result.data.next_follow_up_on).toBe("2026-08-17");
    }
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
