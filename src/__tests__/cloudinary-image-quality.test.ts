import { describe, expect, it } from "vitest";
import { cld } from "@/lib/cloudinary";

const source = "https://res.cloudinary.com/demo/image/upload/v1/catalog/saree.jpg";

describe("Cloudinary storefront transforms", () => {
  it("delivers card images large enough for high-density screens", () => {
    expect(cld(source, "card")).toContain(
      "/upload/c_fill,w_1200,h_1600,q_auto:best,f_auto/",
    );
  });

  it("uses a wide source for landscape collection cards", () => {
    expect(cld(source, "landscape")).toContain(
      "/upload/c_fill,w_1600,h_1000,q_auto:best,f_auto/",
    );
  });

  it("does not stack another transform onto an already transformed URL", () => {
    const transformed = cld(source, "full");
    expect(cld(transformed, "card")).toBe(transformed);
  });
});
