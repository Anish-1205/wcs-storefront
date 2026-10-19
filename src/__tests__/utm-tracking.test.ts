import { describe, expect, it } from "vitest";
import { normaliseUtm } from "@/lib/source-tracking";

describe("UTM capture is allowlisted (T4.6)", () => {
  it("keeps short slugs, lowercased, and drops anything else", () => {
    expect(normaliseUtm("CPC")).toBe("cpc");
    expect(normaliseUtm("diwali-2026_sale")).toBe("diwali-2026_sale");
    expect(normaliseUtm("<script>")).toBeNull();
    expect(normaliseUtm("a b")).toBeNull();
    expect(normaliseUtm("x".repeat(65))).toBeNull();
    expect(normaliseUtm(null)).toBeNull();
  });
});
