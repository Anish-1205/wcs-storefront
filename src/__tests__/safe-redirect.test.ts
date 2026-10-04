import { describe, expect, it } from "vitest";
import { safeRedirect } from "@/lib/safe-redirect";

describe("F24 same-origin relative redirects", () => {
  it.each(["javascript:alert(1)", "https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/%5cevil.invalid", "/%2fevil.invalid", "/\nevil.invalid", "data:text/html,test", " /admin", "/%00bad", "/%zz", "/.//evil.invalid", "/foo/..//evil.invalid", "/%2e//evil.invalid"])("rejects %j", (value) => {
    expect(safeRedirect(value)).toBe("/account");
    expect(safeRedirect(value, "/admin")).toBe("/admin");
  });
  it.each(["/admin", "/account?tab=profile", "/catalog#silk", "/search?q=blue%20silk"])("allows %j", (value) => {
    expect(safeRedirect(value)).toBe(value);
  });
});
