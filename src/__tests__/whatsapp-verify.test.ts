import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({}) }));

import { GET } from "@/app/api/whatsapp/route";

const verify = (token: string) =>
  GET(new Request(`http://localhost/api/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=12345`));

afterEach(() => vi.unstubAllEnvs());

describe("WhatsApp webhook verification (T3.11)", () => {
  it("echoes the challenge only for the right token", async () => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "the-right-token");
    const ok = await verify("the-right-token");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    expect((await verify("the-wrong-token")).status).toBe(403);
    expect((await verify("the-right-token-plus")).status).toBe(403);
  });

  it("refuses (403, not a 500) when no token is configured", async () => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
    expect((await verify("")).status).toBe(403);
  });
});
