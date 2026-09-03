import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockCreateAdminClient = vi.hoisted(() => vi.fn());
const mockSignUpload = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/cloudinary", () => ({ signUpload: mockSignUpload }));

import { POST } from "@/app/api/whatsapp/route";

const APP_SECRET = "secret";
const ADMIN_NUMBER = "919876543210";

function signedRequest(body: string) {
  const digest = createHmac("sha256", APP_SECRET).update(body).digest("hex");
  return new Request("http://localhost/api/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${digest}` },
    body,
  });
}

function imageMessagePayload(opts: { caption: string; mediaId?: string; messageId?: string; from?: string }) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "Store Admin" } }],
              messages: [
                {
                  from: opts.from ?? ADMIN_NUMBER,
                  id: opts.messageId ?? "wamid.1",
                  timestamp: "1700000000",
                  type: "image",
                  image: { id: opts.mediaId ?? "media-1", caption: opts.caption },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

/**
 * Minimal chainable Supabase query-builder stub. Each terminal call
 * (`.maybeSingle()`, `.single()`, or a bare `await ...insert(...)`) consumes
 * the next entry from `queue`, in the exact order the route issues them.
 */
function createSupabaseMock(queue: Array<{ data: unknown; error: unknown }>) {
  let cursor = 0;
  const next = () => queue[cursor++] ?? { data: null, error: null };

  function chain(): any {
    const node: any = {
      select: () => chain(),
      eq: () => chain(),
      maybeSingle: async () => next(),
      single: async () => next(),
      insert: (payload: unknown) => {
        const inserted = chain();
        inserted.__payload = payload;
        inserted.then = (resolve: (v: unknown) => void) => resolve(next());
        return inserted;
      },
      upsert: async () => next(),
    };
    return node;
  }

  return { from: () => chain() };
}

function mockFetchSequence(responses: Array<{ ok: boolean; json?: unknown; text?: string; headers?: Record<string, string> }>) {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const r = responses[i++] ?? { ok: true, json: {} };
      return {
        ok: r.ok,
        status: r.ok ? 200 : 500,
        headers: new Map(Object.entries(r.headers ?? { "content-type": "image/jpeg" })),
        json: async () => r.json ?? {},
        text: async () => r.text ?? "",
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    }),
  );
}

describe("WhatsApp route boundary", () => {
  afterEach(() => {
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_ADMIN_NUMBERS;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects unsigned webhook payloads", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await POST(
      new Request("http://localhost/api/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=invalid" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("ignores correctly signed image messages from non-admin senders", async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_ADMIN_NUMBERS = ADMIN_NUMBER;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = imageMessagePayload({ caption: "Test", from: "919999999999" });
    const response = await POST(signedRequest(body));
    expect(response.status).toBe(200);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("whatsapp webhook: ignored message from a non-admin sender");
  });

  it("ignores a duplicate message_id without re-processing it", async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_ADMIN_NUMBERS = ADMIN_NUMBER;
    const supabase = createSupabaseMock([{ data: { message_id: "wamid.dup" }, error: null }]);
    mockCreateAdminClient.mockReturnValue(supabase);

    const body = imageMessagePayload({ caption: "New Kanjivaram", messageId: "wamid.dup" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("creates a new draft product + variant + primary image from a captioned image message", async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_ADMIN_NUMBERS = ADMIN_NUMBER;
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";
    process.env.CLOUDINARY_API_KEY = "key";
    process.env.CLOUDINARY_API_SECRET = "secret";
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "cloud";

    mockSignUpload.mockResolvedValue({
      signature: "sig",
      apiKey: "key",
      cloudName: "cloud",
      uploadUrl: "https://api.cloudinary.com/v1_1/cloud/image/upload",
    });

    const supabase = createSupabaseMock([
      { data: null, error: null }, // dedup check: not seen before
      { data: { id: "prod-1", name: "Kanjivaram Red", slug: "kanjivaram-red", product_code: "KANJIVARAM-RED" }, error: null }, // products.insert().select().single()
      { data: { id: "var-1", product_id: "prod-1" }, error: null }, // product_variants.insert().select().single()
      { data: null, error: null }, // variant_images.insert()
      { data: null, error: null }, // admin_upload_sessions.upsert()
      { data: null, error: null }, // whatsapp_ingest_events.insert()
    ]);
    mockCreateAdminClient.mockReturnValue(supabase);

    mockFetchSequence([
      { ok: true, json: { url: "https://graph.example/media/media-1", mime_type: "image/jpeg" } }, // Meta media metadata
      { ok: true, headers: { "content-type": "image/jpeg" } }, // Meta binary download
      { ok: true, json: { secure_url: "https://res.cloudinary.com/cloud/image/upload/v1/kanjivaram-red.jpg", public_id: "kanjivaram-red" } }, // Cloudinary upload
      { ok: true, json: {} }, // WhatsApp reply
    ]);

    const body = imageMessagePayload({ caption: "Kanjivaram Red" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("adds a numbered photo to the sender's active upload session", async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_ADMIN_NUMBERS = ADMIN_NUMBER;
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";
    process.env.CLOUDINARY_API_KEY = "key";
    process.env.CLOUDINARY_API_SECRET = "secret";
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "cloud";

    mockSignUpload.mockResolvedValue({
      signature: "sig",
      apiKey: "key",
      cloudName: "cloud",
      uploadUrl: "https://api.cloudinary.com/v1_1/cloud/image/upload",
    });

    const supabase = createSupabaseMock([
      { data: null, error: null }, // dedup check
      { data: { product_id: "prod-1", variant_id: "var-1" }, error: null }, // admin_upload_sessions lookup
      { data: { id: "prod-1", product_code: "KANJIVARAM-RED", slug: "kanjivaram-red" }, error: null }, // products lookup
      { data: null, error: null }, // variant_images.insert()
      { data: null, error: null }, // admin_upload_sessions.upsert() (touch)
      { data: null, error: null }, // whatsapp_ingest_events.insert()
    ]);
    mockCreateAdminClient.mockReturnValue(supabase);

    mockFetchSequence([
      { ok: true, json: { url: "https://graph.example/media/media-2" } },
      { ok: true, headers: { "content-type": "image/jpeg" } },
      { ok: true, json: { secure_url: "https://res.cloudinary.com/cloud/image/upload/v1/kanjivaram-red-2.jpg" } },
      { ok: true, json: {} },
    ]);

    const body = imageMessagePayload({ caption: "2", mediaId: "media-2", messageId: "wamid.2" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("replies with a helpful message and does not create a product when no session and no caption", async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_ADMIN_NUMBERS = ADMIN_NUMBER;
    const supabase = createSupabaseMock([{ data: null, error: null }]); // dedup check only
    mockCreateAdminClient.mockReturnValue(supabase);

    const body = imageMessagePayload({ caption: "" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
