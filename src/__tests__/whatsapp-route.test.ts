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
// the batch-join logic keys off message_timestamp, not call/arrival order.
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
const send = async (...messages: unknown[]) => (await POST(request(envelope(messages)))).status;
/** Only Date is faked (the route's poll still uses a real timer), so this is how leases and backoffs elapse. */
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

const MAX_ATTEMPTS = 5;
const TERMINAL = ["done", "dead"];
// Stateful transport double mirroring migration 028's functions rule for rule;
// actual SQL locking/rollback is tested separately on PostgreSQL (scripts/verify-p0.mjs).
function database() {
  const jobs = new Map<string, any>(); // insertion order is whatsapp_inbox.sequence
  const batches: { id: number; sender: string; sealed: boolean; product: boolean }[] = [];
  const plans: any[] = [];
  let token = 0;
  const failures = new Map<string, number>();
  const all = () => [...jobs.values()];
  const sentAt = (job: any) => Date.parse(job.payload.message_timestamp);
  const mode = (job: any) => job.payload.mode;
  const newBatch = (sender: string, sealed: boolean) => { const b = { id: batches.length + 1, sender, sealed, product: false }; batches.push(b); return b; };

  function enqueue(messages: any[]) {
    for (const m of messages) {
      if (jobs.has(m.message_id)) continue;
      const mine = batches.filter((b) => b.sender === m.sender_phone);
      let batch: (typeof batches)[number] | undefined;
      if (m.mode === "numbered") {
        batch = mine.filter((b) => b.sealed).at(-1) ?? newBatch(m.sender_phone, true);
      } else {
        if (m.mode === "media") {
          // The sealed batch whose finalize was sent soonest at/after this
          // media (within an hour), while that finalize is still to run or
          // has produced a product to append to.
          const t = Date.parse(m.message_timestamp);
          batch = mine.filter((b) => b.sealed)
            .flatMap((b) => all().filter((f) => f.batch === b.id && mode(f) === "finalize").map((f) => ({ b, f })))
            .filter(({ b, f }) => sentAt(f) >= t && sentAt(f) <= t + 3_600_000 && (!TERMINAL.includes(f.state) || b.product))
            .sort((x, y) => sentAt(x.f) - sentAt(y.f) || x.b.id - y.b.id)[0]?.b;
        }
        batch ??= mine.find((b) => !b.sealed) ?? newBatch(m.sender_phone, false);
        if (m.mode === "finalize") batch.sealed = true;
      }
      jobs.set(m.message_id, { message_id: m.message_id, payload: m, batch: batch.id, state: "pending", attempts: 0, asset: null,
        token: null, lease_until: null, last_error: null, reply: null, reply_sent: false, reply_attempts: 0, reply_lease_until: null, completed_at: null });
    }
  }
  function blocked(job: any) {
    const siblings = all().filter((s) => s.batch === job.batch && s !== job && !TERMINAL.includes(s.state));
    if (mode(job) === "finalize") return siblings.some((s) => mode(s) === "media");
    if (mode(job) === "numbered") return siblings.some((s) => mode(s) === "finalize");
    return false;
  }
  function bury(job: any, error: string) {
    if (TERMINAL.includes(job.state)) return;
    Object.assign(job, { state: "dead", token: null, lease_until: null, completed_at: Date.now(), last_error: error,
      reply: mode(job) === "finalize" ? "Something went wrong creating your listing, so it was not saved. Please resend the photos/videos and then the description."
        : mode(job) === "numbered" ? `Photo ${job.payload.caption} could not be added after several tries. Please resend it.`
        : "One photo/video could not be saved after several tries and was left out. Please resend it, or add it in the admin panel." });
  }
  function take(job: any) {
    Object.assign(job, { state: "processing", token: `token-${++token}`, lease_until: Date.now() + 120_000, attempts: job.attempts + 1, last_error: null });
    return { ...job, pending_media: all().filter((j) => j !== job && j.batch === job.batch && mode(j) !== "numbered" && j.state !== "dead" && j.asset).map((j) => j.asset) };
  }
  function claimNext(sender: string) {
    for (;;) {
      const job = all().find((j) => j.payload.sender_phone === sender && ["pending", "failed", "processing"].includes(j.state)
        && (j.state === "pending" || j.lease_until === null || j.lease_until <= Date.now()) && !blocked(j));
      if (!job) return { idle: true, in_flight: all().some((j) => j.payload.sender_phone === sender && j.state === "processing" && j.lease_until > Date.now()) };
      if (job.attempts >= MAX_ATTEMPTS) { bury(job, `${job.last_error ?? "Worker lease expired"} (retry limit reached)`); continue; }
      return take(job);
    }
  }
  function complete(job: any, plan: any) {
    const batch = batches.find((b) => b.id === job.batch)!;
    const planned = new Set((plan.variants ?? []).flatMap((v: any) => (v.media ?? []).map((m: any) => m.url)));
    // The batch gained media the plan does not cover: hand the finalize back, attempt refunded.
    if (mode(job) === "finalize" && all().some((s) => s.batch === job.batch && mode(s) === "media" && s !== job && s.state !== "dead"
      && (s.state !== "done" || (s.asset && !planned.has(s.asset.url))))) {
      Object.assign(job, { state: "pending", token: null, lease_until: null, attempts: Math.max(job.attempts - 1, 0) });
      return { requeued: true };
    }
    let reply = plan.reply ?? null;
    if (mode(job) === "finalize" && plan.variants?.length) batch.product = true;
    else if (mode(job) === "numbered" && !batch.product) reply = `Photo ${job.payload.caption} was not added: there is no listing to add it to. Forward the photos/videos, then send a description.`;
    else if (mode(job) === "numbered" && !job.asset) throw new Error("Missing media checkpoint");
    else if (mode(job) === "media" && job.asset && batch.product) { job.appended = true; reply ??= "A late photo/video was added to your last listing."; }
    Object.assign(job, { state: "done", completed_at: Date.now(), lease_until: null, reply });
    plans.push(plan);
    return {};
  }
  const rpc = vi.fn(async (name: string, args: any) => {
    if ((failures.get(name) ?? 0) > 0) { failures.set(name, failures.get(name)! - 1); return { error: { message: "injected failure" }, data: null }; }
    if (name === "enqueue_whatsapp_messages") { enqueue(args.p_messages); return { data: null, error: null }; }
    if (name === "claim_next_whatsapp_message") return { data: claimNext(args.p_sender_phone), error: null };
    if (name === "claim_whatsapp_replies") {
      const due = all().filter((j) => j.payload.sender_phone === args.p_sender_phone && TERMINAL.includes(j.state) && j.reply && !j.reply_sent
        && j.reply_attempts < 5 && (j.reply_lease_until === null || j.reply_lease_until <= Date.now()) && j.completed_at > Date.now() - 86_400_000);
      for (const j of due) { j.reply_attempts++; j.reply_lease_until = Date.now() + 60_000; }
      return { data: due.map((j) => ({ message_id: j.message_id, sender_phone: j.payload.sender_phone, reply: j.reply, state: j.state, last_error: j.last_error })), error: null };
    }
    const job = jobs.get(args.p_message_id);
    if (name === "finish_whatsapp_reply") {
      if (!job.reply_sent) { job.reply_sent = args.p_sent; job.reply_lease_until = args.p_sent ? null : Date.now() + job.reply_attempts * 5_000; }
      return { data: null, error: null };
    }
    const owns = job.state === "processing" && job.token === args.p_token;
    if (name === "fail_whatsapp_message") {
      if (owns) {
        Object.assign(job, { state: "failed", last_error: args.p_error, lease_until: Date.now() + job.attempts * 5_000 });
        if (job.attempts >= MAX_ATTEMPTS) bury(job, args.p_error);
      }
      return { data: null, error: null };
    }
    if (!owns) return { data: null, error: { message: "Stale WhatsApp worker" } };
    if (name === "checkpoint_whatsapp_asset") { job.asset = args.p_asset; return { data: null, error: null }; }
    if (name === "complete_whatsapp_message") {
      try { return { data: complete(job, args.p_plan), error: null }; } catch (error) { return { data: null, error: { message: (error as Error).message } }; }
    }
    throw new Error(`Unexpected rpc ${name}`);
  });
  function from(table: string): any {
    let ids: string[] = [];
    const chain = {
      select: () => chain, in: (_: string, values: string[]) => { ids = values; return chain; },
      then: (resolve: any) => resolve({ error: null, data: table === "whatsapp_inbox" ? ids.filter((id) => jobs.has(id)).map((id) => ({ ...jobs.get(id) }))
        : table === "categories" ? [{ id: "cat", name: "Silk", slug: "silk" }] : [{ id: "collection", name: "Bridal", description: null }] }),
    };
    return chain;
  }
  return { rpc, from, jobs, plans, failures, batches };
}
let db: ReturnType<typeof database>;
let uploads: number;
let replies: string[];
const products = () => db.plans.filter((p) => p.variants?.length);
const mediaOf = (plan: any) => plan.variants.flatMap((v: any) => v.media.map((m: any) => m.message_id));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  nextTimestamp = 1700000000;
  vi.stubEnv("WHATSAPP_APP_SECRET", "secret"); vi.stubEnv("WHATSAPP_ADMIN_NUMBERS", phone);
  for (const key of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME"]) vi.stubEnv(key, "test");
  db = database(); mocks.client.mockReturnValue(db);
  mocks.ai.mockReturnValue({ isConfigured: () => false });
  mocks.sign.mockResolvedValue({ signature: "signed", uploadUrl: "https://upload.invalid" });
  uploads = 0; replies = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://upload.invalid") {
      uploads++; const id = (init?.body as FormData).get("public_id");
      return new Response(JSON.stringify({ secure_url: `https://cdn.invalid/${id}.jpg`, public_id: id }));
    }
    if (url.includes("/resources/")) return new Response("{}", { status: 404 });
    if (url.includes("/messages")) { replies.push(JSON.parse(String(init?.body)).text.body); return new Response("{}"); }
    if (url === "https://media.invalid") return new Response(new Uint8Array([1,2,3]));
    if (url.includes("media-bad")) return new Response("unavailable", { status: 500 });
    return new Response(JSON.stringify({ url: "https://media.invalid" }));
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("durable WhatsApp route (F02/F03/F04)", () => {
  it("rejects invalid signatures and ignores unauthorized senders", async () => {
    expect((await POST(new Request("http://localhost", { method: "POST", body: "{}" }))).status).toBe(401);
    expect(await send({ ...message("a"), from: "11111111111" })).toBe(200);
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
    expect(await send(message("a"))).toBe(503);
    expect(uploads).toBe(0);
  });
  it("handles videos, text finalization and subsequent products with disjoint batches", async () => {
    expect(await send(message("a"), message("b", "", "video"), message("c", "Silk saree | 1200", "text"), message("d", "Cotton saree | 900"))).toBe(200);
    expect(products()).toHaveLength(2);
    expect(mediaOf(products()[0])).toEqual(["a", "b"]);
    expect(mediaOf(products()[1])).toEqual(["d"]);
    expect(products()[0].price).toBe(1200);
  });
  it("deduplicates simultaneous deliveries before external side effects, and replies once", async () => {
    const payload = envelope([message("a", "Silk saree | 1200")]);
    const statuses = await Promise.all([POST(request(payload)), POST(request(payload))]);
    expect(statuses.map((r) => r.status)).toEqual([200, 200]);
    expect(uploads).toBe(1); expect(db.plans).toHaveLength(1);
    expect((await POST(request(payload))).status).toBe(200);
    expect(uploads).toBe(1); expect(replies).toHaveLength(1);
  });
  it("retains upload and failed state when commit fails; retry reuses media and creates once", async () => {
    db.failures.set("complete_whatsapp_message", 1);
    const payload = envelope([message("a", "Silk saree | 1200")]);
    expect((await POST(request(payload))).status).toBe(503);
    expect(db.jobs.get("a")).toMatchObject({ state: "failed", asset: { media_id: "media-a" }, last_error: expect.stringContaining("injected") });
    expect(db.plans).toHaveLength(0);
    // Still inside the retry backoff: retained, not hammered.
    expect((await POST(request(payload))).status).toBe(503);
    expect(db.jobs.get("a").attempts).toBe(1);
    advance(6_000);
    expect((await POST(request(payload))).status).toBe(200);
    expect(uploads).toBe(1); expect(db.plans).toHaveLength(1);
  });
  it("retains raw media identity even when the upload checkpoint write fails", async () => {
    db.failures.set("checkpoint_whatsapp_asset", 1);
    const payload = envelope([message("a")]);
    expect((await POST(request(payload))).status).toBe(503);
    expect(db.jobs.get("a").payload).toMatchObject({ media_id: "media-a", public_id: expect.any(String) });
    advance(6_000);
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
    advance(6_000);
    expect((await POST(request(payload))).status).toBe(200);
    expect(uploads).toBe(1);
    expect(db.jobs.get("a").asset.url).toBe("https://cdn.invalid/recovered.jpg");
  });
  it("records all messages before a failure; an unrelated later batch still completes", async () => {
    db.failures.set("complete_whatsapp_message", 1);
    const payload = envelope([message("a"), message("b", "Silk", "text"), message("c", "Cotton")]);
    expect((await POST(request(payload))).status).toBe(503);
    expect(db.jobs.size).toBe(3);
    expect(db.jobs.get("b").state).toBe("pending"); // waits for its own batch's photo
    expect(db.jobs.get("c").state).toBe("done"); // a different batch is not held up by it
    advance(6_000);
    expect((await POST(request(payload))).status).toBe(200);
    expect(products()).toHaveLength(2);
  });
  it("retains a recoverable error when Meta fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 500 })));
    expect(await send(message("a"))).toBe(503);
    expect(db.jobs.get("a").state).toBe("failed");
    expect(db.plans).toHaveLength(0);
  });
  it("completes empty text with a helpful durable reply, and answers a numbered photo that has no listing", async () => {
    expect(await send(message("a", "Silk", "text"), message("b", "2"))).toBe(200);
    expect(db.plans[0]).toMatchObject({ variants: [], reply: expect.stringContaining("No photos") });
    expect(db.jobs.get("b")).toMatchObject({ state: "done", reply: expect.stringContaining("no listing to add it to") });
    expect(replies).toEqual([expect.stringContaining("No photos"), expect.stringContaining("Photo 2 was not added")]);
  });
  it("appends a numbered photo to the latest listing", async () => {
    expect(await send(message("a"), message("b", "Silk | 1200", "text"), message("c", "2"))).toBe(200);
    expect(db.jobs.get("c").batch).toBe(db.jobs.get("a").batch);
    expect(db.plans.at(-1)).toEqual({ reply: "Saved photo 2." });
    expect(products()).toHaveLength(1);
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
    expect(await send(message("a"), message("b"), message("v", "", "video"), message("close", "Bridal Silk | 1200 | Silk", "text"))).toBe(200);
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
    expect(await send(message("a", "Silk | 1200 | Silk"))).toBe(200);
    expect(db.plans[0].variants[0].color).toBe("Default");
  });
  it("does not recreate products if reply delivery fails after commit, and stops retrying the reply eventually", async () => {
    const original = global.fetch;
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => String(args[0]).includes("/messages") ? new Response("failed", { status: 500 }) : original(...args)));
    const payload = envelope([message("a", "Silk | 1200")]);
    expect((await POST(request(payload))).status).toBe(503);
    expect(db.jobs.get("a").state).toBe("done");
    expect((await POST(request(payload))).status).toBe(503);
    expect(db.plans).toHaveLength(1); expect(uploads).toBe(1);
    expect(db.jobs.get("a").reply_attempts).toBe(1); // leased: the immediate redelivery did not resend
    for (let i = 0; i < 4; i++) { advance(60_000); await POST(request(payload)); }
    expect(db.jobs.get("a")).toMatchObject({ reply_attempts: 5, reply_sent: false });
    expect((await POST(request(payload))).status).toBe(200); // bounded: no longer asks Meta to redeliver
    expect(db.plans).toHaveLength(1);
  });
});

describe("batching across out-of-order deliveries", () => {
  it("includes a straggling photo that arrives after its finalize text", async () => {
    // "late" was sent before the finalize text "b" (WhatsApp's own
    // message_timestamp says so) but reaches this server after it.
    expect(await send(message("a"), message("b", "Silk saree | 1200", "text"), message("late", "", "image", "1700000000.5"))).toBe(200);
    expect(db.jobs.get("late").batch).toBe(db.jobs.get("a").batch); // joined the same batch, not orphaned
    expect(products()).toHaveLength(1);
    expect(mediaOf(products()[0])).toEqual(["a", "late"]);
  });
  it("rebuilds the listing when a straggler lands while the finalize is already building it", async () => {
    let delivered = false;
    mocks.ai.mockReturnValue({ isConfigured: () => true,
      // The straggler's own webhook arrives mid-finalize, after the plan's media snapshot.
      suggestProductMetadata: vi.fn(async () => {
        if (!delivered) { delivered = true; expect(await send(message("late", "", "image", "1700000000.5"))).toBe(200); }
        return {};
      }),
      classifyCollection: vi.fn().mockResolvedValue([]), suggestColorVariants: vi.fn().mockResolvedValue([]),
    });
    expect(await send(message("a"), message("b", "Silk saree | 1200", "text"))).toBe(200);
    expect(products()).toHaveLength(1);
    expect(mediaOf(products()[0])).toEqual(["a", "late"]);
    expect(db.jobs.get("b").attempts).toBe(1); // a wait, not a failure: the attempt was refunded
    expect(replies).toHaveLength(1);
  });
  it("starts a fresh batch for media sent after the prior batch's finalize", async () => {
    expect(await send(message("a"), message("b", "Silk | 1200", "text"))).toBe(200);
    expect(await send(message("c"))).toBe(200);
    expect(db.jobs.get("c").batch).not.toBe(db.jobs.get("a").batch);
    expect(db.jobs.get("c").appended).toBeUndefined();
  });
  it("appends a photo that turns up after its listing was already created", async () => {
    const late = message("late");
    expect(await send(message("a"), message("b", "Silk | 1200", "text"))).toBe(200);
    expect(await send(late)).toBe(200);
    expect(db.jobs.get("late")).toMatchObject({ batch: db.jobs.get("a").batch, appended: true });
    expect(replies.at(-1)).toContain("late photo/video was added");
    expect(products()).toHaveLength(1);
  });
  it("never attaches a days-late redelivery to an unrelated listing", async () => {
    const stale = message("stale", "", "image", String(1700000000 - 86_400));
    expect(await send(message("a"), message("b", "Silk | 1200", "text"))).toBe(200);
    expect(await send(stale)).toBe(200);
    expect(db.jobs.get("stale").batch).not.toBe(db.jobs.get("a").batch);
    expect(db.jobs.get("stale").appended).toBeUndefined();
  });
});

describe("the pipeline never goes silent", () => {
  it("text first, then photos, then text: one draft with every photo, in a batch of its own", async () => {
    // The production sequence, delivered the way Meta delivers it: one webhook per message.
    expect(await send(message("text-1", "Silk saree | 1200", "text"))).toBe(200);
    expect(replies).toEqual([expect.stringContaining("No photos or videos received yet")]);
    for (const id of ["p1", "p2", "p3"]) expect(await send(message(id))).toBe(200);
    expect(await send(message("text-2", "Silk saree | 1200", "text"))).toBe(200);
    expect(products()).toHaveLength(1);
    expect(mediaOf(products()[0])).toEqual(["p1", "p2", "p3"]);
    expect(db.jobs.get("p1").batch).not.toBe(db.jobs.get("text-1").batch);
    expect(db.jobs.get("text-2").batch).toBe(db.jobs.get("p1").batch);
    expect(replies).toHaveLength(2);
    expect(replies[1]).toContain("with 3 photo(s)/video(s)");
    expect([...db.jobs.values()].every((j) => j.state === "done")).toBe(true);
  });
  it("an empty finalize cannot swallow photos stamped in the same second", async () => {
    // WhatsApp timestamps are whole seconds: a description sent just before
    // its photos can carry the very same timestamp as them.
    const second = String(nextTimestamp++);
    expect(await send(message("text-1", "Silk | 1200", "text", second))).toBe(200);
    expect(await send(message("p1", "", "image", second))).toBe(200);
    expect(db.jobs.get("p1").batch).not.toBe(db.jobs.get("text-1").batch);
    expect(await send(message("text-2", "Silk | 1200", "text"))).toBe(200);
    expect(products()).toHaveLength(1);
    expect(mediaOf(products()[0])).toEqual(["p1"]);
  });
  it("drains photos and their description delivered as concurrent webhooks", async () => {
    const batch = [message("p1"), message("p2"), message("p3"), message("text", "Silk | 1200", "text")];
    const statuses = await Promise.all(batch.map((m) => POST(request(envelope([m])))));
    expect(statuses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(products()).toHaveLength(1);
    expect(mediaOf(products()[0]).sort()).toEqual(["p1", "p2", "p3"]);
    expect(uploads).toBe(3); expect(replies).toHaveLength(1);
  });
  it("a message stuck in a killed invocation does not block the sender, and is resumed once its lease expires", async () => {
    // What a killed function leaves behind: the upload checkpointed, but the
    // row still 'processing' under a running lease that nobody will finish.
    db.failures.set("complete_whatsapp_message", 1);
    expect(await send(message("stuck"))).toBe(503);
    Object.assign(db.jobs.get("stuck"), { state: "processing", lease_until: Date.now() + 120_000 });
    expect(db.jobs.get("stuck")).toMatchObject({ attempts: 1, asset: { media_id: "media-stuck" } });
    expect(await send(message("b"))).toBe(200); // not queued behind the stuck photo
    expect(db.jobs.get("b").state).toBe("done");
    advance(121_000);
    // No redelivery of "stuck" itself: the next message from the sender resumes it.
    expect(await send(message("text", "Silk | 1200", "text"))).toBe(200);
    expect(products()).toHaveLength(1);
    expect(mediaOf(products()[0])).toEqual(["stuck", "b"]);
    expect(uploads).toBe(2); // the checkpointed upload was reused, not repeated
  });
  it("dead-letters a photo that keeps failing, tells the admin, and still builds the listing from the rest", async () => {
    expect(await send(message("good"))).toBe(200);
    const bad = envelope([message("bad")]);
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await POST(request(bad))).status).toBe(attempt < 5 ? 503 : 200);
      advance(60_000);
    }
    expect(db.jobs.get("bad")).toMatchObject({ state: "dead", attempts: 5, reply_sent: true, last_error: expect.stringContaining("Meta media lookup failed") });
    expect(replies).toEqual([expect.stringContaining("could not be saved after several tries")]);
    expect(mocks.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ scope: "whatsapp-dead-letter", messageId: "bad" }));
    expect((await POST(request(bad))).status).toBe(200); // terminal: redelivery is a no-op
    expect(replies).toHaveLength(1);
    expect(await send(message("text", "Silk | 1200", "text"))).toBe(200);
    expect(products()).toHaveLength(1);
    expect(mediaOf(products()[0])).toEqual(["good"]);
  });
  it("dead-letters a message whose invocations keep getting killed, without waiting on its redelivery", async () => {
    expect(await send(message("a"))).toBe(200);
    // Five claims, none of which ever reported back.
    Object.assign(db.jobs.get("a"), { state: "processing", attempts: 5, token: "gone", lease_until: Date.now() - 1 });
    expect(await send(message("text", "Silk | 1200", "text"))).toBe(200);
    expect(db.jobs.get("a").state).toBe("dead");
    expect(replies).toEqual([expect.stringContaining("could not be saved"), expect.stringContaining("No photos")]);
  });
  it("dead-letters a description that can never be saved and asks for a resend", async () => {
    db.failures.set("complete_whatsapp_message", 5);
    const payload = envelope([message("a", "Silk | 1200")]);
    for (let attempt = 1; attempt <= 5; attempt++) { await POST(request(payload)); advance(60_000); }
    expect(db.jobs.get("a")).toMatchObject({ state: "dead", reply_sent: true });
    expect(replies).toEqual([expect.stringContaining("Please resend the photos/videos and then the description")]);
    expect(products()).toHaveLength(0);
    // The resend forms a fresh, working batch.
    expect(await send(message("b"), message("c", "Silk | 1200", "text"))).toBe(200);
    expect(mediaOf(products()[0])).toEqual(["b"]);
  });
  it("a reply that cannot be sent never fails the webhook's own processing", async () => {
    const original = global.fetch;
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => { if (String(args[0]).includes("/messages")) throw new Error("network down"); return original(...args); }));
    expect(await send(message("a", "Silk | 1200"))).toBe(503); // retained only so Meta redelivers and the reply is retried
    expect(db.jobs.get("a")).toMatchObject({ state: "done", reply_sent: false });
    vi.stubGlobal("fetch", original);
    advance(6_000);
    expect(await send(message("b"))).toBe(200); // the next message flushes the reply that was owed
    expect(replies).toEqual([expect.stringContaining("Created")]);
  });
});
