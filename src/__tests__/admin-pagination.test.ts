import { describe, expect, it } from "vitest";
import { pageWindow } from "@/lib/pagination";
import {
  ADMIN_PAGE_SIZES,
  DEFAULT_ADMIN_PAGE_SIZE,
  adminProductsQuerySchema,
  isAdminPageSize,
} from "@/lib/validation";

describe("pageWindow", () => {
  it("lists every page when there are few", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps first, last and a run around the current page", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, null, 20]);
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 17, 18, 19, 20]);
  });
});

describe("adminProductsQuerySchema", () => {
  it("defaults a bare query", () => {
    const query = adminProductsQuerySchema.parse({});
    expect(query).toMatchObject({
      page: 1,
      per: DEFAULT_ADMIN_PAGE_SIZE,
      sort: "created_at",
      dir: "desc",
      q: "",
    });
  });

  it("accepts only the offered page sizes, falling back rather than throwing", () => {
    for (const size of ADMIN_PAGE_SIZES) {
      expect(adminProductsQuerySchema.parse({ per: String(size) }).per).toBe(size);
    }
    // A hand-edited URL can't ask Postgres for the whole table.
    expect(adminProductsQuerySchema.parse({ per: "100000" }).per).toBe(DEFAULT_ADMIN_PAGE_SIZE);
    expect(adminProductsQuerySchema.parse({ per: "nonsense" }).per).toBe(DEFAULT_ADMIN_PAGE_SIZE);
    expect(isAdminPageSize(100000)).toBe(false);
  });

  it("clamps a nonsense page back to the first one", () => {
    expect(adminProductsQuerySchema.parse({ page: "0" }).page).toBe(1);
    expect(adminProductsQuerySchema.parse({ page: "-4" }).page).toBe(1);
    expect(adminProductsQuerySchema.parse({ page: "abc" }).page).toBe(1);
    expect(adminProductsQuerySchema.parse({ page: "3" }).page).toBe(3);
  });
});
