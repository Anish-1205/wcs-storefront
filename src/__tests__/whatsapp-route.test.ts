import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateAdminClient = vi.hoisted(() => vi.fn());
const mockSignUpload = vi.hoisted(() => vi.fn());
const mockGetAiProvider = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/cloudinary", () => ({ signUpload: mockSignUpload }));
vi.mock("@/lib/ai", () => ({ getAiProvider: mockGetAiProvider }));

import { POST } from "@/app/api/whatsapp/route";
import { deriveProductName, parseCollectionMessage, parseProductCaption } from "@/lib/whatsapp-caption";

const AI_OFF_PROVIDER = {
  name: "off",
  isConfigured: () => false,
  suggestProductMetadata: vi.fn(),
  classifyCollection: vi.fn(),
  suggestColorVariants: vi.fn(),
};

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

function videoMessagePayload(opts: { caption?: string; mediaId?: string; messageId?: string; from?: string }) {
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
                  id: opts.messageId ?? "wamid.video",
                  timestamp: "1700000000",
                  type: "video",
                  video: { id: opts.mediaId ?? "media-video", caption: opts.caption ?? "" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function textMessagePayload(opts: { body: string; messageId?: string; from?: string }) {
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
                  id: opts.messageId ?? "wamid.text",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: opts.body },
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
 * (`.maybeSingle()`, `.single()`, a bare `await ...insert(...)`, or
 * `.rpc(...)`) consumes the next entry from `queue`, in the exact order the
 * route issues them.
 */
function createSupabaseMock(
  queue: Array<{ data: unknown; error: unknown }>,
  tableResponses: Record<string, { data: unknown; error: unknown }> = {},
) {
  let cursor = 0;
  const next = () => queue[cursor++] ?? { data: null, error: null };
  const inserts: Array<{ table: string; payload: any }> = [];

  function chain(table?: string): any {
    const node: any = {
      select: () => chain(table),
      eq: () => chain(table),
      maybeSingle: async () => next(),
      single: async () => next(),
      insert: (payload: unknown) => {
        inserts.push({ table: table ?? "", payload });
        const inserted = chain(table);
        inserted.__payload = payload;
        inserted.then = (resolve: (v: unknown) => void) => resolve(next());
        return inserted;
      },
      upsert: async () => next(),
      // A bare `await supabase.from(x).select(...)` with no further chaining
      // (e.g. the categories/collections lookups) resolves via this — table
      // -specific canned responses when given, otherwise the shared queue.
      then: (resolve: (v: unknown) => void) =>
        resolve(table && tableResponses[table] ? tableResponses[table] : next()),
    };
    return node;
  }

  return { from: (table: string) => chain(table), rpc: async () => next(), inserts };
}

function mockFetchSequence(responses: Array<{ ok: boolean; json?: unknown; text?: string; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
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
  return calls;
}

function setBaseEnv() {
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_ADMIN_NUMBERS = ADMIN_NUMBER;
}

function setReplyEnv() {
  process.env.WHATSAPP_ACCESS_TOKEN = "token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";
}

function setCloudinaryEnv() {
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "cloud";
}

describe("parseProductCaption", () => {
  it("splits description | price | fabric and cleans the price", () => {
    expect(parseProductCaption("Red silk saree with gold border | 2500 | Silk")).toEqual({
      description: "Red silk saree with gold border",
      price: 2500,
      fabric: "Silk",
    });
  });

  it("strips currency symbols and commas from the price", () => {
    expect(parseProductCaption("Green saree | ₹1,999 | Cotton").price).toBe(1999);
  });

  it("falls back to the whole caption as description when there is no separator", () => {
    expect(parseProductCaption("Kanjivaram Red")).toEqual({
      description: "Kanjivaram Red",
      price: null,
      fabric: null,
    });
  });

  it("treats a missing or non-numeric price as null without dropping the fabric", () => {
    expect(parseProductCaption("Blue saree | | Georgette")).toEqual({
      description: "Blue saree",
      price: null,
      fabric: "Georgette",
    });
  });

  it("rejects a zero price", () => {
    expect(parseProductCaption("Saree | 0 | Silk").price).toBeNull();
  });
});

describe("parseCollectionMessage", () => {
  it("extracts a trailing price from free-flowing prose", () => {
    expect(
      parseCollectionMessage("Exquisite Kanjivaram-style Tissue Benarasi sarees... 4900"),
    ).toEqual({
      description: "Exquisite Kanjivaram-style Tissue Benarasi sarees",
      price: 4900,
      fabric: null,
    });
  });

  it("understands a currency symbol and /- suffix", () => {
    expect(parseCollectionMessage("Pure mysore silk saree ₹4,500/-")).toEqual({
      description: "Pure mysore silk saree",
      price: 4500,
      fabric: null,
    });
  });

  it("falls back to the whole text as description when no price is found", () => {
    expect(parseCollectionMessage("Beautiful cotton sarees, new arrivals")).toEqual({
      description: "Beautiful cotton sarees, new arrivals",
      price: null,
      fabric: null,
    });
  });

  it("still honours the pipe-separated legacy format", () => {
    expect(parseCollectionMessage("Red silk saree | 2500 | Silk")).toEqual({
      description: "Red silk saree",
      price: 2500,
      fabric: "Silk",
    });
  });
});

describe("deriveProductName", () => {
  it("keeps a short description as-is", () => {
    expect(deriveProductName("Kanjivaram Red")).toBe("Kanjivaram Red");
  });

  it("truncates a long description to a word boundary within 60 chars", () => {
    const long =
      "Exquisite Kanjivaram-style Tissue Benarasi sarees with a rich gold zari border and traditional temple motifs";
    const name = deriveProductName(long);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(long.startsWith(name)).toBe(true);
    expect(name.endsWith(" ")).toBe(false);
  });
});

describe("WhatsApp route boundary", () => {
  beforeEach(() => {
    mockGetAiProvider.mockReturnValue(AI_OFF_PROVIDER);
  });

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
    setBaseEnv();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = imageMessagePayload({ caption: "Test", from: "919999999999" });
    const response = await POST(signedRequest(body));
    expect(response.status).toBe(200);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("whatsapp webhook: ignored message from a non-admin sender");
  });

  it("ignores a duplicate message_id without re-processing it", async () => {
    setBaseEnv();
    const supabase = createSupabaseMock([{ data: { message_id: "wamid.dup" }, error: null }]);
    mockCreateAdminClient.mockReturnValue(supabase);

    const body = imageMessagePayload({ caption: "New Kanjivaram", messageId: "wamid.dup" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("silently queues an uncaptioned photo without creating a product or replying", async () => {
    setBaseEnv();
    setReplyEnv();
    setCloudinaryEnv();

    mockSignUpload.mockResolvedValue({
      signature: "sig",
      apiKey: "key",
      cloudName: "cloud",
      uploadUrl: "https://api.cloudinary.com/v1_1/cloud/image/upload",
    });

    const supabase = createSupabaseMock([
      { data: null, error: null }, // dedup check
      { data: null, error: null }, // rpc append_whatsapp_pending_media
      { data: null, error: null }, // whatsapp_ingest_events.insert()
    ]);
    mockCreateAdminClient.mockReturnValue(supabase);

    const calls = mockFetchSequence([
      { ok: true, json: { url: "https://graph.example/media/media-1", mime_type: "image/jpeg" } }, // Meta media metadata
      { ok: true, headers: { "content-type": "image/jpeg" } }, // Meta binary download
      { ok: true, json: { secure_url: "https://res.cloudinary.com/cloud/image/upload/v1/pending-1.jpg" } }, // Cloudinary upload
    ]);

    const body = imageMessagePayload({ caption: "" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    // Exactly 3 fetch calls (metadata, download, upload) — no WhatsApp reply sent.
    expect(calls.length).toBe(3);
  });

  it("silently queues an uncaptioned video the same way as a photo", async () => {
    setBaseEnv();
    setReplyEnv();
    setCloudinaryEnv();

    mockSignUpload.mockResolvedValue({
      signature: "sig",
      apiKey: "key",
      cloudName: "cloud",
      uploadUrl: "https://api.cloudinary.com/v1_1/cloud/video/upload",
    });

    const supabase = createSupabaseMock([
      { data: null, error: null }, // dedup check
      { data: null, error: null }, // rpc append
      { data: null, error: null }, // ingest insert
    ]);
    mockCreateAdminClient.mockReturnValue(supabase);

    const calls = mockFetchSequence([
      { ok: true, json: { url: "https://graph.example/media/media-video", mime_type: "video/mp4" } },
      { ok: true, headers: { "content-type": "video/mp4" } },
      { ok: true, json: { secure_url: "https://res.cloudinary.com/cloud/video/upload/v1/pending-video.mp4" } },
    ]);

    const body = videoMessagePayload({});
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(calls.length).toBe(3);
  });

  it("finalizes a batch of queued photos + a video into one product when the description text arrives", async () => {
    setBaseEnv();
    setReplyEnv();

    const supabase = createSupabaseMock([
      { data: null, error: null }, // dedup check
      {
        data: {
          pending_media: [
            { media_id: "m1", message_id: "wamid.m1", url: "https://res.cloudinary.com/cloud/image/upload/v1/a.jpg", kind: "image", received_at: "2026-01-01T00:00:00.000Z" },
            { media_id: "m2", message_id: "wamid.m2", url: "https://res.cloudinary.com/cloud/video/upload/v1/b.mp4", kind: "video", received_at: "2026-01-01T00:00:01.000Z" },
          ],
        },
        error: null,
      }, // admin_upload_sessions pending_media lookup
      { data: { id: "prod-1", name: "Exquisite Kanjivaram-style Tissue Benarasi sarees", slug: "exquisite-kanjivaram-style-tissue-benarasi-sarees", product_code: "EXQUISITE-KANJIVARAM-STYLE-TISSUE-BENARASI-SAREES" }, error: null }, // products.insert().select().single()
      { data: { id: "var-1", product_id: "prod-1" }, error: null }, // product_variants.insert().select().single()
      { data: null, error: null }, // variant_images.insert() (bulk)
      { data: null, error: null }, // admin_upload_sessions.upsert() (reset)
      { data: null, error: null }, // whatsapp_ingest_events.insert()
    ]);
    mockCreateAdminClient.mockReturnValue(supabase);

    const calls = mockFetchSequence([{ ok: true, json: {} }]); // WhatsApp reply only — no media in this message

    const body = textMessagePayload({
      body: "Exquisite Kanjivaram-style Tissue Benarasi sarees... 4900",
      messageId: "wamid.finalize",
    });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(calls.length).toBe(1);
    const replyBody = JSON.parse((calls[0].init?.body as string) ?? "{}");
    expect(replyBody.text.body).toContain("Exquisite Kanjivaram");
    expect(replyBody.text.body).toContain("1 photo and 1 video");
  });

  it("replies with the correct photo/video counts on finalize", async () => {
    setBaseEnv();
    setReplyEnv();

    const supabase = createSupabaseMock([
      { data: null, error: null },
      {
        data: {
          pending_media: [
            { media_id: "m1", message_id: "wamid.m1", url: "https://res.cloudinary.com/cloud/image/upload/v1/a.jpg", kind: "image", received_at: "t1" },
            { media_id: "m2", message_id: "wamid.m2", url: "https://res.cloudinary.com/cloud/video/upload/v1/b.mp4", kind: "video", received_at: "t2" },
          ],
        },
        error: null,
      },
      { data: { id: "prod-1", name: "Some Saree", slug: "some-saree", product_code: "SOME-SAREE" }, error: null },
      { data: { id: "var-1", product_id: "prod-1" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    mockCreateAdminClient.mockReturnValue(supabase);

    const calls = mockFetchSequence([{ ok: true, json: {} }]);

    const body = textMessagePayload({ body: "Some saree 1200", messageId: "wamid.finalize-2" });
    await POST(signedRequest(body));

    const replyBody = JSON.parse((calls[0].init?.body as string) ?? "{}");
    expect(replyBody.text.body).toContain("1 photo and 1 video");
    expect(replyBody.text.body).toContain("₹1200");
    expect(replyBody.text.body).toContain("Some Saree");
  });

  it("replies with a helpful hint instead of creating a product when the description arrives with nothing queued", async () => {
    setBaseEnv();
    setReplyEnv();

    const supabase = createSupabaseMock([
      { data: null, error: null }, // dedup check
      { data: { pending_media: [] }, error: null }, // pending_media lookup: empty
    ]);
    mockCreateAdminClient.mockReturnValue(supabase);

    const calls = mockFetchSequence([{ ok: true, json: {} }]);

    const body = textMessagePayload({ body: "Some description 1200" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(calls.length).toBe(1);
    const replyBody = JSON.parse((calls[0].init?.body as string) ?? "{}");
    expect(replyBody.text.body).toMatch(/forward the photos/i);
  });

  it("keeps the legacy single-image-with-caption flow working", async () => {
    setBaseEnv();
    setReplyEnv();
    setCloudinaryEnv();

    mockSignUpload.mockResolvedValue({
      signature: "sig",
      apiKey: "key",
      cloudName: "cloud",
      uploadUrl: "https://api.cloudinary.com/v1_1/cloud/image/upload",
    });

    const supabase = createSupabaseMock([
      { data: null, error: null }, // dedup check
      { data: null, error: null }, // rpc append
      {
        data: { pending_media: [{ media_id: "media-1", message_id: "wamid.1", url: "https://res.cloudinary.com/cloud/image/upload/v1/kanjivaram-red.jpg", kind: "image", received_at: "t1" }] },
        error: null,
      }, // pending_media lookup (finalize)
      { data: { id: "prod-1", name: "Kanjivaram Red", slug: "kanjivaram-red", product_code: "KANJIVARAM-RED" }, error: null }, // products.insert().select().single()
      { data: { id: "var-1", product_id: "prod-1" }, error: null }, // product_variants.insert().select().single()
      { data: null, error: null }, // variant_images.insert()
      { data: null, error: null }, // admin_upload_sessions.upsert() (reset)
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
    setBaseEnv();
    setReplyEnv();
    setCloudinaryEnv();

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

  it("replies with a helpful message when a numbered caption arrives with no active session", async () => {
    setBaseEnv();
    setReplyEnv();

    const supabase = createSupabaseMock([
      { data: null, error: null }, // dedup check
      { data: null, error: null }, // admin_upload_sessions lookup: none
    ]);
    mockCreateAdminClient.mockReturnValue(supabase);

    const calls = mockFetchSequence([{ ok: true, json: {} }]);

    const body = imageMessagePayload({ caption: "2", mediaId: "media-2", messageId: "wamid.no-session" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(calls.length).toBe(1);
    const replyBody = JSON.parse((calls[0].init?.body as string) ?? "{}");
    expect(replyBody.text.body).toMatch(/no active product session/i);
  });

  it("retries with a -2 suffix on a slug collision instead of failing", async () => {
    setBaseEnv();
    setReplyEnv();

    const supabase = createSupabaseMock([
      { data: null, error: null }, // dedup check
      {
        data: { pending_media: [{ media_id: "m1", message_id: "wamid.m1", url: "https://res.cloudinary.com/cloud/image/upload/v1/a.jpg", kind: "image", received_at: "t1" }] },
        error: null,
      }, // pending_media lookup
      { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "products_slug_key"' } }, // first insert attempt: collision
      { data: { id: "prod-2", name: "Some Saree", slug: "some-saree-2", product_code: "SOME-SAREE-2" }, error: null }, // second attempt: success
      { data: { id: "var-1", product_id: "prod-2" }, error: null }, // product_variants insert
      { data: null, error: null }, // variant_images insert
      { data: null, error: null }, // session reset
      { data: null, error: null }, // ingest insert
    ]);
    mockCreateAdminClient.mockReturnValue(supabase);

    const calls = mockFetchSequence([{ ok: true, json: {} }]);

    const body = textMessagePayload({ body: "Some saree 1200", messageId: "wamid.collision" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    const replyBody = JSON.parse((calls[0].init?.body as string) ?? "{}");
    expect(replyBody.text.body).toContain("SOME-SAREE-2");
    expect(replyBody.text.body).toContain("Some Saree");
  });

  it("never fails silently: a persistent DB error still gets a plain-language WhatsApp reply, not the raw error", async () => {
    setBaseEnv();
    setReplyEnv();

    const dedupAndLookup = [
      { data: null, error: null }, // dedup check
      {
        data: { pending_media: [{ media_id: "m1", message_id: "wamid.m1", url: "https://res.cloudinary.com/cloud/image/upload/v1/a.jpg", kind: "image", received_at: "t1" }] },
        error: null,
      }, // pending_media lookup
    ];
    const persistentCollisions = Array.from({ length: 25 }, () => ({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "products_slug_key"' },
    }));
    const supabase = createSupabaseMock([...dedupAndLookup, ...persistentCollisions]);
    mockCreateAdminClient.mockReturnValue(supabase);

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const calls = mockFetchSequence([{ ok: true, json: {} }]);

    const body = textMessagePayload({ body: "Some saree 1200", messageId: "wamid.fail" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(calls.length).toBe(1);
    const replyBody = JSON.parse((calls[0].init?.body as string) ?? "{}");
    expect(replyBody.text.body).toMatch(/problem saving your product/i);
    expect(replyBody.text.body).not.toMatch(/duplicate key/i);
    expect(replyBody.text.body).not.toMatch(/23505/);
    error.mockRestore();
  });
});

describe("WhatsApp route — AI auto-tagging", () => {
  afterEach(() => {
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_ADMIN_NUMBERS;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function fakeAiProvider(overrides: Record<string, unknown> = {}) {
    return {
      name: "fake",
      isConfigured: () => true,
      suggestProductMetadata: vi.fn().mockResolvedValue(null),
      classifyCollection: vi.fn().mockResolvedValue([]),
      suggestColorVariants: vi.fn().mockResolvedValue(null),
      ...overrides,
    };
  }

  const CATEGORY_TABLE_RESPONSE = {
    data: [{ id: "cat-banarasi", slug: "banarasi", name: "Banarasi" }],
    error: null,
  };
  const COLLECTION_TABLE_RESPONSE = {
    data: [{ id: "col-bridal", name: "Bridal Sarees", description: null }],
    error: null,
  };

  it("auto-fills category/fabric/highlights, tags a confident collection, and splits into colour-variant products", async () => {
    setBaseEnv();
    setReplyEnv();

    mockGetAiProvider.mockReturnValue(
      fakeAiProvider({
        suggestProductMetadata: vi.fn().mockResolvedValue({
          category_slug: { value: "banarasi", confidence: 0.9 },
          highlights: { value: ["Rich zari border"], confidence: 0.8 },
          fabric_type: { value: "Tissue silk", confidence: 0.85 },
        }),
        classifyCollection: vi
          .fn()
          .mockResolvedValue([{ collection_id: "col-bridal", collection_name: "Bridal Sarees", confidence: 0.85, evidence: "e" }]),
        suggestColorVariants: vi.fn().mockResolvedValue([
          { color: "Ivory", color_hex: null, asset_client_upload_ids: ["m1", "m2"], confidence: 0.9, is_best_display: true },
          { color: "Rani Pink", color_hex: null, asset_client_upload_ids: ["m3"], confidence: 0.85, is_best_display: false },
        ]),
      }),
    );

    const supabase = createSupabaseMock(
      [
        { data: null, error: null }, // dedup check
        {
          data: {
            pending_media: [
              { media_id: "m1", message_id: "wamid.m1", url: "https://res.cloudinary.com/cloud/image/upload/v1/ivory1.jpg", kind: "image", received_at: "t1" },
              { media_id: "m2", message_id: "wamid.m2", url: "https://res.cloudinary.com/cloud/image/upload/v1/ivory2.jpg", kind: "image", received_at: "t2" },
              { media_id: "m3", message_id: "wamid.m3", url: "https://res.cloudinary.com/cloud/image/upload/v1/pink1.jpg", kind: "image", received_at: "t3" },
              { media_id: "v1", message_id: "wamid.v1", url: "https://res.cloudinary.com/cloud/video/upload/v1/clip.mp4", kind: "video", received_at: "t4" },
            ],
          },
          error: null,
        }, // pending_media lookup
        { data: { id: "prod-1", name: "Banarasi Tissue Saree", slug: "banarasi-tissue-saree", product_code: "BANARASI-TISSUE-SAREE" }, error: null }, // products.insert
        { data: { id: "var-ivory", product_id: "prod-1" }, error: null }, // product_variants.insert (Ivory)
        { data: null, error: null }, // variant_images.insert (Ivory + video)
        { data: { id: "var-pink", product_id: "prod-1" }, error: null }, // product_variants.insert (Rani Pink)
        { data: null, error: null }, // variant_images.insert (Rani Pink)
        { data: null, error: null }, // collection_products.insert
        { data: null, error: null }, // admin_upload_sessions.upsert (reset)
        { data: null, error: null }, // whatsapp_ingest_events.insert
      ],
      { categories: CATEGORY_TABLE_RESPONSE, collections: COLLECTION_TABLE_RESPONSE },
    );
    mockCreateAdminClient.mockReturnValue(supabase);

    const calls = mockFetchSequence([{ ok: true, json: {} }]);

    const body = textMessagePayload({ body: "Exquisite Banarasi tissue sarees 4900", messageId: "wamid.tagged" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);

    const productInsert = supabase.inserts.find((i) => i.table === "products");
    expect(productInsert?.payload).toMatchObject({
      category_id: "cat-banarasi",
      highlights: ["Rich zari border"],
      fabric_type: "Tissue silk",
    });

    const variantInserts = supabase.inserts.filter((i) => i.table === "product_variants");
    expect(variantInserts.map((i) => i.payload.color)).toEqual(["Ivory", "Rani Pink"]);

    const imageInserts = supabase.inserts.filter((i) => i.table === "variant_images");
    expect(imageInserts[0].payload).toHaveLength(3); // 2 ivory photos + the video
    expect(imageInserts[0].payload.some((row: any) => row.media_type === "video")).toBe(true);
    expect(imageInserts[1].payload).toHaveLength(1); // 1 pink photo

    const collectionInsert = supabase.inserts.find((i) => i.table === "collection_products");
    expect(collectionInsert?.payload).toEqual([{ collection_id: "col-bridal", product_id: "prod-1", display_order: 0 }]);

    const replyBody = JSON.parse((calls[0].init?.body as string) ?? "{}");
    expect(replyBody.text.body).toContain("2 colourways");
    expect(replyBody.text.body).toContain("Category: Banarasi.");
    expect(replyBody.text.body).toContain("Collections: Bridal Sarees.");
  });

  it("keeps a single Default variant when AI can't confidently split colours, but still applies tags", async () => {
    setBaseEnv();
    setReplyEnv();

    mockGetAiProvider.mockReturnValue(
      fakeAiProvider({
        suggestProductMetadata: vi.fn().mockResolvedValue({
          category_slug: { value: "banarasi", confidence: 0.9 },
        }),
        suggestColorVariants: vi.fn().mockResolvedValue([
          { color: "Ivory", color_hex: null, asset_client_upload_ids: ["m1", "m2"], confidence: 0.9, is_best_display: true },
        ]), // only one colourway found — not a split
      }),
    );

    const supabase = createSupabaseMock(
      [
        { data: null, error: null }, // dedup check
        {
          data: {
            pending_media: [
              { media_id: "m1", message_id: "wamid.m1", url: "https://res.cloudinary.com/cloud/image/upload/v1/a.jpg", kind: "image", received_at: "t1" },
              { media_id: "m2", message_id: "wamid.m2", url: "https://res.cloudinary.com/cloud/image/upload/v1/b.jpg", kind: "image", received_at: "t2" },
            ],
          },
          error: null,
        },
        { data: { id: "prod-1", name: "Some Saree", slug: "some-saree", product_code: "SOME-SAREE" }, error: null },
        { data: { id: "var-1", product_id: "prod-1" }, error: null }, // single Default variant
        { data: null, error: null }, // variant_images.insert
        { data: null, error: null }, // admin_upload_sessions.upsert (reset)
        { data: null, error: null }, // whatsapp_ingest_events.insert
      ],
      { categories: CATEGORY_TABLE_RESPONSE, collections: { data: [], error: null } },
    );
    mockCreateAdminClient.mockReturnValue(supabase);

    const calls = mockFetchSequence([{ ok: true, json: {} }]);

    const body = textMessagePayload({ body: "Some saree 1200", messageId: "wamid.no-split" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(supabase.inserts.filter((i) => i.table === "product_variants")).toHaveLength(1);
    expect(supabase.inserts.find((i) => i.table === "product_variants")?.payload.color).toBe("Default");

    const replyBody = JSON.parse((calls[0].init?.body as string) ?? "{}");
    expect(replyBody.text.body).not.toMatch(/colourways/);
    expect(replyBody.text.body).toContain("Category: Banarasi.");
  });

  it("still creates the product when the category/collection lookup itself fails", async () => {
    setBaseEnv();
    setReplyEnv();

    mockGetAiProvider.mockReturnValue(fakeAiProvider());

    const supabase = createSupabaseMock(
      [
        { data: null, error: null }, // dedup check
        {
          data: { pending_media: [{ media_id: "m1", message_id: "wamid.m1", url: "https://res.cloudinary.com/cloud/image/upload/v1/a.jpg", kind: "image", received_at: "t1" }] },
          error: null,
        },
        { data: { id: "prod-1", name: "Some Saree", slug: "some-saree", product_code: "SOME-SAREE" }, error: null },
        { data: { id: "var-1", product_id: "prod-1" }, error: null },
        { data: null, error: null }, // variant_images.insert
        { data: null, error: null }, // admin_upload_sessions.upsert (reset)
        { data: null, error: null }, // whatsapp_ingest_events.insert
      ],
      {
        categories: { data: null, error: { message: "categories lookup boom" } },
        collections: { data: null, error: { message: "collections lookup boom" } },
      },
    );
    mockCreateAdminClient.mockReturnValue(supabase);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const calls = mockFetchSequence([{ ok: true, json: {} }]);

    const body = textMessagePayload({ body: "Some saree 1200", messageId: "wamid.lookup-fail" });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(200);
    expect(calls.length).toBe(1); // still got exactly one reply, not an error reply
    const productInsert = supabase.inserts.find((i) => i.table === "products");
    expect(productInsert?.payload).toMatchObject({ category_id: null, highlights: [] });
    warn.mockRestore();
  });
});
