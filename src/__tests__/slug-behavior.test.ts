import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/utils";

function makeUniqueSlug(base: string, existing: Set<string>) {
  const root = slugify(base);
  let candidate = root;
  let counter = 2;
  while (existing.has(candidate)) {
    candidate = `${root}-${counter++}`;
  }
  return candidate;
}

function makeStableSlug(base: string, existing: Set<string>, currentSlug?: string | null) {
  const root = slugify(base);
  if (currentSlug && currentSlug === root) {
    return currentSlug;
  }
  const collisions = new Set(existing);
  if (currentSlug) {
    collisions.delete(currentSlug);
  }
  return makeUniqueSlug(root, collisions);
}

describe("slug behavior", () => {
  it("keeps the slug unchanged when editing without changes", () => {
    const existing = new Set(["royal-gadwal-silk-saree"]);

    expect(makeStableSlug("Royal Gadwal Silk Saree", existing, "royal-gadwal-silk-saree")).toBe("royal-gadwal-silk-saree");
  });

  it("suffixes a colliding slug on edit", () => {
    const existing = new Set(["royal-gadwal-silk-saree"]);

    expect(makeStableSlug("Royal Gadwal Silk Saree", existing, null)).toBe("royal-gadwal-silk-saree-2");
  });

  it("suffixes a colliding slug on create", () => {
    const existing = new Set(["royal-gadwal-silk-saree"]);

    expect(makeUniqueSlug("Royal Gadwal Silk Saree", existing)).toBe("royal-gadwal-silk-saree-2");
  });
});