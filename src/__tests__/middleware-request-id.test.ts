import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

import { middleware } from "@/middleware";

describe("middleware request id (T2.6)", () => {
  it("adds an x-request-id to public responses and forwards it to the route", async () => {
    const res = await middleware(new NextRequest("http://localhost/sarees/x"));
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    // NextResponse.next forwards overridden request headers via x-middleware-request-*.
    expect(res.headers.get("x-middleware-request-x-request-id")).toBe(id);
  });

  it("keeps a well-formed incoming id and replaces anything else", async () => {
    const kept = await middleware(new NextRequest("http://localhost/", { headers: { "x-request-id": "edge-abc123_DEF" } }));
    expect(kept.headers.get("x-request-id")).toBe("edge-abc123_DEF");
    const replaced = await middleware(new NextRequest("http://localhost/", { headers: { "x-request-id": "<script>alert(1)</script>" } }));
    expect(replaced.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
