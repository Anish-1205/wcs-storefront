/**
 * Part of `npm run test:ingest`: what the sender is told, and what they can send back.
 * Unsupported message types, the price sent on its own, the success reply, the 24-hour window.
 * Needs the local disposable cluster (ingest-eval/README.md).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", async () => (await import("./lib/mocks")).serverMock);
vi.mock("@/lib/ai", async () => (await import("./lib/mocks")).aiMock);
vi.mock("@/lib/report-error", async () => (await import("./lib/mocks")).reportMock);

import { sweepSenders } from "@/lib/whatsapp-pipeline";
import { createRunDb, ensureTemplate, shiftTime, type RunDb } from "./lib/db";
import { installFetch, serverMock, state } from "./lib/mocks";
import { replay, SENDER, type Snapshot, type Stream } from "./lib/replay";
import { loadStreams } from "./lib/streams";

let db: RunDb;
beforeAll(async () => {
  vi.stubGlobal("fetch", installFetch());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  db = await createRunDb(await ensureTemplate());
});
afterAll(async () => { await db?.close(); });
afterEach(() => { state.failReplies = false; });

const run = async (stream: Stream, options: Parameters<typeof replay>[2]) => {
  await db.reset();
  return replay(db, stream, options);
};
const all = loadStreams();
const stream = (name: string) => all.find((s) => s.name === name)!;
const last = (s: Stream) => Math.max(...s.events.map((e) => e.sent));
const text = (id: string, body: string) => ({ id: `wamid.${id}`, type: "text", text: { body } });
const listings = (snap: Snapshot) => snap.products.filter((p) => !p.unassigned);

describe("messages a listing cannot be made from", () => {
  const voice = { id: "wamid.VOICE", type: "audio", audio: { id: "mid.voice", mime_type: "audio/ogg; codecs=opus", voice: true } };
  const file = { id: "wamid.FILE", type: "document", document: { id: "mid.file", mime_type: "application/pdf", filename: "price list.pdf" } };
  const card = { id: "wamid.CARD", type: "contacts", contacts: [{ name: { formatted_name: "Someone" }, phones: [{ phone: "+15550100002" }] }] };
  const sticker = { id: "wamid.STICKER", type: "sticker", sticker: { id: "mid.sticker", mime_type: "image/webp" } };

  it("get a friendly reply and never hold up, or join, the listing they arrived in the middle of", async () => {
    const base = stream("PF1"); // 8 photos, then the description
    const snap = await run(base, { ai: "off", raw: [{ arrive: 2, message: voice }, { arrive: 3, message: file }, { arrive: 4, message: card }, { arrive: 4, message: sticker }] });
    expect(listings(snap)).toHaveLength(1);
    expect(listings(snap)[0].variants[0].images).toHaveLength(8);
    expect(snap.replies).toEqual([
      "I can't listen to voice notes or audio yet, so that one wasn't used. Please type the description as a text message.",
      "I can't open documents or files. If it was a photo or video, please send it as a normal photo/video, not as a file.",
      "I can't use contact cards, so that one was ignored. To add a listing, send the photos/videos and a description.",
      "Draft created: Banarasi Georgette Saree with Brocade Border. 8 photos used.",
    ]);
    // None of them was ever queued: 8 photos and 1 description, nothing else.
    expect(snap.rows).toBe(9);
    expect(snap.dead).toEqual([]);
    expect(snap.errors).toEqual([]);
  });

  it("is answered once however often Meta redelivers it, and once per minute however many are sent", async () => {
    const base = stream("PF1");
    const more = { ...voice, id: "wamid.VOICE2" };
    const snap = await run(base, { ai: "off", raw: [{ arrive: 2, message: voice }, { arrive: 2, sent: 2, message: voice }, { arrive: 3, sent: 2, message: more }] });
    expect(snap.replies.filter((r) => r.includes("voice notes"))).toHaveLength(1);
  });
});

describe("a price sent on its own", () => {
  const NO_PRICE = "TXT03"; // "Beautiful banarasi saree with zari border"

  it("fills the price of the draft that was created without one", async () => {
    const base = stream(NO_PRICE);
    const snap = await run(base, { ai: "off", raw: [{ arrive: last(base) + 40, message: text("PRICE", "Rs. 4,500/-") }] });
    expect(snap.replies).toEqual([
      "Draft created: Banarasi Saree with Zari Border. 1 photo used. Price missing, please send it. Please check: no fabric was mentioned.",
      "Price ₹4500 added to Banarasi Saree with Zari Border.",
    ]);
    const [product] = listings(snap);
    expect(product).toMatchObject({ priceMin: 4500, priceMax: 4500, status: "draft", reviewReasons: ["fabric_missing"], needsReview: true });
    expect(snap.products).toHaveLength(1); // the price did not become a listing of its own
  });

  it("never overwrites a price that is already there", async () => {
    const base = stream(NO_PRICE);
    const snap = await run(base, { ai: "off", raw: [
      { arrive: last(base) + 40, message: text("PRICE1", "4500") },
      { arrive: last(base) + 60, message: text("PRICE2", "price 5200") },
    ] });
    expect(listings(snap)[0].priceMin).toBe(4500);
    expect(snap.replies.at(-1)).toBe("Banarasi Saree with Zari Border already has a price (₹4500), so I did not change it. You can edit it in the admin panel.");
    expect(snap.products).toHaveLength(1);
  });

  it("leaves an admin's own price alone", async () => {
    const base = stream(NO_PRICE);
    await run(base, { ai: "off" });
    await db.pg.query("update products set base_price_min=7000, base_price_max=7000");
    const { POST } = await import("@/app/api/whatsapp/route");
    const { createHmac } = await import("node:crypto");
    const now = Math.floor(Number((await db.pg.query("select extract(epoch from now()) as e")).rows[0].e));
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from: SENDER, timestamp: String(now), ...text("LATE", "4500") }] } }] }] });
    await POST(new Request("http://localhost/api/whatsapp", { method: "POST", body, headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}` } }));
    expect((await db.pg.query("select base_price_min from products")).rows[0].base_price_min).toBe(7000);
  });

  it("refuses a price that is out of range instead of storing it", async () => {
    const base = stream(NO_PRICE);
    const snap = await run(base, { ai: "off", raw: [{ arrive: last(base) + 40, message: text("PRICE", "99999999") }] });
    expect(listings(snap)[0].priceMin).toBeNull();
    expect(snap.replies.at(-1)).toBe("That price looks wrong (outside ₹100 to ₹500000), so I left it empty. Please send it again.");
    expect(listings(snap)[0].reviewReasons).toContain("price_missing");
  });

  it("is still an ordinary description when photos are waiting for one", async () => {
    // Photos, then nothing but a price: the listing it has always made, price included.
    const photos: Stream = { ...stream("PF1"), events: stream("PF1").events.filter((e) => e.type !== "text") };
    const snap = await run(photos, { ai: "off", raw: [{ arrive: last(photos) + 6, message: text("ONLYPRICE", "3300/-") }] });
    expect(listings(snap)).toHaveLength(1);
    expect(listings(snap)[0]).toMatchObject({ name: "Saree", priceMin: 3300 });
    expect(listings(snap)[0].variants[0].images).toHaveLength(8);
  });
});

describe("WhatsApp's 24-hour reply window", () => {
  it("a reply that could not be sent is retried a bounded number of times, and never after 24 hours", async () => {
    state.failReplies = true;
    const snap = await run(stream("PF1"), { ai: "off", horizonSeconds: 600 });
    expect(listings(snap)).toHaveLength(1); // the listing does not depend on the reply
    expect(snap.replies).toEqual([]);
    const owed = async () => (await db.pg.query("select reply_sent, reply_attempts from whatsapp_inbox where reply is not null")).rows;
    expect(await owed()).toEqual([{ reply_sent: false, reply_attempts: 5 }]);

    // A fresh reply that is owed, then a day goes by before WhatsApp accepts anything again.
    await db.pg.query("update whatsapp_inbox set reply_attempts=0, reply_lease_until=null where reply is not null");
    await shiftTime(db.pg, SENDER, 25 * 3600);
    state.failReplies = false;
    await sweepSenders(serverMock.createAdminClient() as never, Date.now() + 110_000);
    expect(state.replies).toEqual([]);
    expect(await owed()).toEqual([{ reply_sent: false, reply_attempts: 0 }]);
  });

  it("the same reply inside the window is delivered as soon as WhatsApp accepts it", async () => {
    state.failReplies = true;
    await run(stream("PF1"), { ai: "off", horizonSeconds: 30 });
    await db.pg.query("update whatsapp_inbox set reply_attempts=0, reply_lease_until=null where reply is not null");
    await shiftTime(db.pg, SENDER, 3 * 3600);
    state.failReplies = false;
    await sweepSenders(serverMock.createAdminClient() as never, Date.now() + 110_000);
    expect(state.replies).toEqual(["Draft created: Banarasi Georgette Saree with Brocade Border. 8 photos used."]);
  });
});
