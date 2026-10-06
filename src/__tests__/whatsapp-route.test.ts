import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), sign: vi.fn(), ai: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: mocks.client }));
vi.mock("@/lib/cloudinary", () => ({ signUpload: mocks.sign }));
vi.mock("@/lib/ai", () => ({ getAiProvider: mocks.ai }));
vi.mock("@/lib/report-error", () => ({ reportError: mocks.report }));
import { POST } from "@/app/api/whatsapp/route";

const phone = "919876543210";
// Each call gets a later timestamp than the last, like real WhatsApp sends —
// 027's batch-join logic keys off message_timestamp, not call/arrival order.
let nextTimestamp = 1700000000;
function message(id: string, caption = "", kind = "image", timestamp = String(nextTimestamp++)) {
  return { id, from: phone, timestamp, type: kind,
    ...(kind === "text" ? { text: { body: caption } } : { [kind]: { id: `media-${id}`, caption } }) };
}
function envelope(messages: unknown[]) {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages } }] }] };
}
function request(payload: unknown) {
  const body = JSON.stringify(payload);
  return new Request("http://localhost/api/whatsapp", { method: "POST", body,
    headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}` } });
}
// Stateful transport double; actual SQL locking/rollback is tested separately on PostgreSQL.
function database() {
  const jobs = new Map<string, any>();
  const plans: any[] = [];
  let openBatch = 1;
  let token = 0;
  const failures = new Map<string, number>();
  // A batch is joinable by plain media as long as it has no finalize job yet,
  // or its finalize job's own message_timestamp is >= this media's timestamp
  // — mirrors 027's timestamp-based enqueue_whatsapp_messages join condition.
  // 'numbered' never joins the open (unsealed) batch — same as the real
  // schema, it attaches to the latest *sealed* batch, or starts its own new
  // sealed one if none exists yet.
  let numberedBatch = 0;
  function batchJoinable(batchId: number, mediaTimestamp: string): boolean {
    const finalizeJob = [...jobs.values()].find((j) => j.batch === batchId && j.payload.mode === "finalize");
    return !finalizeJob || Date.parse(finalizeJob.payload.message_timestamp) >= Date.parse(mediaTimestamp);
  }
  const rpc = vi.fn(async (name: string, args: any) => {
    if ((failures.get(name) ?? 0) > 0) { failures.set(name, failures.get(name)! - 1); return { error: { message: "injected failure" }, data: null }; }
    if (name === "enqueue_whatsapp_messages") {
      for (const m of args.p_messages) {
        if (jobs.has(m.message_id)) continue;
        let targetBatch: number;
        if (m.mode === "numbered") {
          // Joins the latest sealed batch (one whose finalize has been
          // enqueued), else starts its own fresh sealed batch.
          const sealedBatches = [...jobs.values()].filter((j) => j.payload.mode === "finalize").map((j) => j.batch);
          targetBatch = sealedBatches.length ? Math.max(...sealedBatches) : ++numberedBatch + 1000;
        } else {
          if (!batchJoinable(openBatch, m.message_timestamp)) openBatch++;
          targetBatch = openBatch;
        }
        jobs.set(m.message_id, { payload: m, batch: targetBatch, state: "pending", attempts: 0, asset: null });
      }
      return { error: null };
    }
    const job = jobs.get(args.p_message_id);
    if (name === "claim_whatsapp_message") {
      if (job.state === "done") return { data: { done: true } };
      const earlier = [...jobs.values()].slice(0, [...jobs.values()].indexOf(job));
      const siblingsUnfinished = [...jobs.values()].some((j) => j !== job && j.batch === job.batch && j.payload.mode === "media" && j.state !== "done");
      // A media message never waits on a same-batch finalize ahead of it in
      // sequence — see 027's claim_whatsapp_message comment on why that
      // exemption prevents a straggler/finalize deadlock.
      if (job.state === "processing"
        || earlier.some((j) => j.payload.sender_phone === job.payload.sender_phone && j.state !== "done"
          && !(job.payload.mode === "media" && j.payload.mode === "finalize" && j.batch === job.batch))
        || (job.payload.mode === "finalize" && siblingsUnfinished)
      ) return { data: { busy: true } };
      job.state = "processing"; job.attempts++; job.token = `token-${++token}`;
      return { data: { ...job, pending_media: [...jobs.values()].filter((j) => j !== job && j.batch === job.batch && j.asset).map((j) => j.asset) } };
    }
    if (args.p_token !== job.token) return { error: { message: "stale worker" } };
    if (name === "checkpoint_whatsapp_asset") job.asset = args.p_asset;
    if (name === "fail_whatsapp_message") { job.state = "failed"; job.last_error = args.p_error; }
    if (name === "complete_whatsapp_message") { job.state = "done"; job.reply = args.p_plan.reply; plans.push(args.p_plan); }
    return { data: {}, error: null };
  });
  function from(table: string): any {
    let id: string;
    let update: any;
    const chain = {
      select: () => chain, eq: (_: string, value: string) => { id = value; return chain; },
      maybeSingle: async () => ({ data: { ...jobs.get(id), sender_phone: phone }, error: null }),
      update: (value: any) => { update = value; return chain; },
      then: (resolve: any) => { if (update) Object.assign(jobs.get(id), update); resolve({ data: table === "categories" ? [{ id: "cat", name: "Silk", slug: "silk" }] : [{ id: "collection", name: "Bridal", description: null }], error: null }); },
    };
    return chain;
  }
  return { rpc, from, jobs, plans, failures };
}
let db: ReturnType<typeof database>;
let uploads: number;
beforeEach(() => {
  vi.clearAllMocks();
  nextTimestamp = 1700000000;
  vi.stubEnv("WHATSAPP_APP_SECRET", "secret"); vi.stubEnv("WHATSAPP_ADMIN_NUMBERS", phone);
  for (const key of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME"]) vi.stubEnv(key, "test");
  db = database(); mocks.client.mockReturnValue(db);
  mocks.ai.mockReturnValue({ isConfigured: () => false });
  mocks.sign.mockResolvedValue({ signature: "signed", uploadUrl: "https://upload.invalid" });
  uploads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://upload.invalid") {
      uploads++; const id = (init?.body as FormData).get("public_id");
      return new Response(JSON.stringify({ secure_url: `https://cdn.invalid/${id}.jpg`, public_id: id }));
    }
    if (url.includes("/resources/")) return new Response("{}", { status: 404 });
    if (url.includes("/messages")) return new Response("{}");
    if (url === "https://media.invalid") return new Response(new Uint8Array([1,2,3]));
    return new Response(JSON.stringify({ url: "https://media.invalid" }));
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("durable WhatsApp route (F02/F03/F04)", () => {
  it("rejects invalid signatures and ignores unauthorized senders", async () => {
    expect((await POST(new Request("http://localhost", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await POST(request(envelope([{ ...message("a"), from: "11111111111" }])))).status).toBe(200);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("enumerates every message, change and entry and matches contacts by sender", async () => {
    const payload = { object: "whatsapp_business_account", entry: [
      { changes: [{ value: { messages: [message("a"), message("b")] } }, { value: { messages: [message("c")] } }] },
      { changes: [{ value: { messages: [message("d")], contacts: [{ wa_id: "wrong", profile: { name: "Wrong" } }, { wa_id: phone, profile: { name: "Right" } }] } }] },
    ] };
    expect((await POST(request(payload))).status).toBe(200);
    expect([...db.jobs.keys()]).toEqual(["a", "b", "c", "d"]);
    expect(db.jobs.get("d").payload.contact_name).toBe("Right");
    expect(uploads).toBe(4);
    expect(db.plans.every((p) => p.reply === null)).toBe(true);
  });
  it("fails closed if durable acceptance fails, before uploading anything", async () => {
    db.failures.set("enqueue_whatsapp_messages", 1);
    expect((await POST(request(envelope([message("a")])))).status).toBe(503);
    expect(uploads).toBe(0);
  });
  it("handles videos, text finalization and subsequent products with disjoint batches", async () => {
    const payload = envelope([message("a"), message("b", "", "video"), message("c", "Silk saree | 1200", "text"), message("d", "Cotton saree | 900")]);
    expect((await POST(request(payload))).status).toBe(200);
    const products = db.plans.filter((p) => p.variants?.length);
    expect(products).toHaveLength(2);
    expect(products[0].variants[0].media.map((m: any) => m.message_id)).toEqual(["a", "b"]);
    expect(products[1].variants[0].media.map((m: any) => m.message_id)).toEqual(["d"]);
    expect(products[0].price).toBe(1200);
  });
  it("deduplicates simultaneous deliveries before external side effects", async () => {
    const payload = envelope([message("a", "Silk saree | 1200")]);
    await Promise.all([POST(request(payload)), POST(request(payload))]);
    expect(uploads).toBe(1); expect(db.plans).toHaveLength(1);
    expect((await POST(request(payload))).status).toBe(200);
    expect(uploads).toBe(1);
  });
  it("retains upload and failed state when commit fails; retry reuses media and creates once", async () => {
    db.failures.set("complete_whatsapp_message", 1);
    const payload = envelope([message("a", "Silk saree | 1200")]);
    expect((await POST(request(payload))).status).toBe(503);
    expect(db.jobs.get("a")).toMatchObject({ state: "failed", asset: { media_id: "media-a" }, last_error: expect.stringContaining("injected") });
    expect(db.plans).toHaveLength(0);
    expect((await POST(request(payload))).status).toBe(200);
    expect(uploads).toBe(1); expect(db.plans).toHaveLength(1);
  });
  it("retains raw media identity even when the upload checkpoint write fails", async () => {
    db.failures.set("checkpoint_whatsapp_asset", 1);
    const payload = envelope([message("a")]);
    expect((await POST(request(payload))).status).toBe(503);
    expect(db.jobs.get("a").payload).toMatchObject({ media_id: "media-a", public_id: expect.any(String) });
    expect((await POST(request(payload))).status).toBe(200);
    const calls = mocks.sign.mock.calls;
    expect(calls[0][0].public_id).toBe(calls[1][0].public_id);
    expect(calls[0][0].overwrite).toBe("false");
  });
  it("recovers an orphaned upload by its stable identity even after Meta media expires", async () => {
    db.failures.set("checkpoint_whatsapp_asset", 1);
    const payload = envelope([message("a", "Silk")]);
    expect((await POST(request(payload))).status).toBe(503);
    const original = global.fetch;
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0]);
      if (url.includes("/resources/")) return new Response(JSON.stringify({ secure_url: "https://cdn.invalid/recovered.jpg" }));
      if (url.includes("media-a")) throw new Error("Meta media expired");
      return original(...args);
    }));
    expect((await POST(request(payload))).status).toBe(200);
    expect(uploads).toBe(1);
    expect(db.jobs.get("a").asset.url).toBe("https://cdn.invalid/recovered.jpg");
  });
  it("records all messages before a failure and keeps later batches recoverable", async () => {
    db.failures.set("complete_whatsapp_message", 1);
    const payload = envelope([message("a"), message("b", "Silk", "text"), message("c", "Cotton")]);
    expect((await POST(request(payload))).status).toBe(503);
    expect(db.jobs.size).toBe(3);
    expect(db.jobs.get("b").state).toBe("pending");
    expect((await POST(request(payload))).status).toBe(200);
    expect(db.plans.filter((p) => p.variants?.length)).toHaveLength(2);
  });
  it("retains a recoverable error when Meta fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 500 })));
    expect((await POST(request(envelope([message("a")])))).status).toBe(503);
    expect(db.jobs.get("a").state).toBe("failed");
    expect(db.plans).toHaveLength(0);
  });
  it("completes empty text with a helpful durable reply, and numbered photos with no new product plan", async () => {
    expect((await POST(request(envelope([message("a", "Silk", "text"), message("b", "2")])))).status).toBe(200);
    expect(db.plans[0]).toMatchObject({ variants: [], reply: expect.stringContaining("No photos") });
    expect(db.plans[1]).toEqual({ reply: "Saved photo 2." });
  });
  it("preserves AI metadata, collection tagging, colour splitting and video ownership in the atomic plan", async () => {
    mocks.ai.mockReturnValue({ isConfigured: () => true,
      suggestProductMetadata: vi.fn().mockResolvedValue({ category_slug: { value: "silk", confidence: 0.9 }, highlights: { value: ["Zari border"], confidence: 0.9 } }),
      classifyCollection: vi.fn().mockResolvedValue([{ collection_id: "collection", collection_name: "Bridal", confidence: 0.9, evidence: "bridal" }]),
      suggestColorVariants: vi.fn().mockResolvedValue([
        { color: "Ivory", color_hex: null, asset_client_upload_ids: ["media-a"], confidence: 0.9, is_best_display: true },
        { color: "Pink", color_hex: null, asset_client_upload_ids: ["media-b"], confidence: 0.9, is_best_display: false },
      ]),
    });
    expect((await POST(request(envelope([message("a"), message("b"), message("v", "", "video"), message("close", "Bridal Silk | 1200 | Silk", "text")])))).status).toBe(200);
    const product = db.plans.at(-1);
    expect(product).toMatchObject({ category_id: "cat", collection_ids: ["collection"], highlights: ["Zari border"], fabric_type: "Silk" });
    expect(product.variants.map((v: any) => v.color)).toEqual(["Ivory", "Pink"]);
    expect(product.variants[0].media.map((m: any) => m.message_id)).toEqual(["a", "v"]);
    expect(product.variants[1].media.map((m: any) => m.message_id)).toEqual(["b"]);
  });
  it("falls back to a single variant when AI suggestions fail", async () => {
    mocks.ai.mockReturnValue({ isConfigured: () => true,
      suggestProductMetadata: vi.fn().mockRejectedValue(new Error("AI offline")),
      classifyCollection: vi.fn().mockRejectedValue(new Error("AI offline")),
      suggestColorVariants: vi.fn().mockRejectedValue(new Error("AI offline")),
    });
    expect((await POST(request(envelope([message("a", "Silk | 1200 | Silk")])))).status).toBe(200);
    expect(db.plans[0].variants[0].color).toBe("Default");
  });
  it("waits for a straggling photo that arrives after its finalize text instead of building the product without it", async () => {
    // "a" (photo) and "late" (photo) were both sent before the finalize text
    // "b" (WhatsApp's own message_timestamp says so), but "late" reaches this
    // server after "b" — the out-of-order case a real multi-photo-then-caption
    // upload hits when one photo's Meta download/Cloudinary upload is slower.
    const payload = envelope([message("a"), message("b", "Silk saree | 1200", "text"), message("late", "", "image", "1700000000.5")]);
    const first = await POST(request(payload));
    expect(first.status).toBe(503); // finalize must wait on "late", not build without it
    expect(db.plans.filter((p) => p.variants?.length)).toHaveLength(0);
    expect(db.jobs.get("late").batch).toBe(db.jobs.get("a").batch); // joined the same batch, not orphaned
    const second = await POST(request(payload));
    expect(second.status).toBe(200);
    const products = db.plans.filter((p) => p.variants?.length);
    expect(products).toHaveLength(1);
    expect(products[0].variants[0].media.map((m: any) => m.message_id).sort()).toEqual(["a", "late"]);
  });
  it("starts a fresh batch for media that arrives once the prior batch's finalize is already done", async () => {
    expect((await POST(request(envelope([message("a"), message("b", "Silk | 1200", "text")])))).status).toBe(200);
    expect((await POST(request(envelope([message("c")])))).status).toBe(200);
    expect(db.jobs.get("c").batch).not.toBe(db.jobs.get("a").batch);
  });
  it("does not recreate products if reply delivery fails after commit", async () => {
    const original = global.fetch;
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => String(args[0]).includes("/messages") ? new Response("failed", { status: 500 }) : original(...args)));
    const payload = envelope([message("a", "Silk | 1200")]);
    expect((await POST(request(payload))).status).toBe(503);
    expect(db.jobs.get("a").state).toBe("done");
    expect((await POST(request(payload))).status).toBe(503);
    expect(db.plans).toHaveLength(1); expect(uploads).toBe(1);
  });
});
