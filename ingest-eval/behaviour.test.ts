/**
 * Part of `npm run test:ingest`: behaviour of the WhatsApp ingestion that needs
 * the real SQL to prove. Questions and answers, admin-only data, settings.
 * Needs the local disposable cluster (ingest-eval/README.md).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", async () => (await import("./lib/mocks")).serverMock);
vi.mock("@/lib/ai", async () => (await import("./lib/mocks")).aiMock);
vi.mock("@/lib/report-error", async () => (await import("./lib/mocks")).reportMock);

import { createRunDb, ensureTemplate, type RunDb } from "./lib/db";
import { installFetch } from "./lib/mocks";
import { replay, type Snapshot, type Stream } from "./lib/replay";
import { loadStreams } from "./lib/streams";

let db: RunDb;
beforeAll(async () => {
  vi.stubGlobal("fetch", installFetch());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  db = await createRunDb(await ensureTemplate());
});
afterAll(async () => { await db?.close(); });

const run = async (stream: Stream, options: Parameters<typeof replay>[2]) => {
  await db.reset();
  return replay(db, stream, options);
};
const all = loadStreams();
const stream = (name: string) => all.find((s) => s.name === name)!;

/** The stream plus the admin's replies, each sent `after` seconds past the last message. */
function withReplies(base: Stream, replies: [text: string, after: number][]): Stream {
  const last = Math.max(...base.events.map((e) => e.sent));
  return {
    ...base,
    events: [...base.events, ...replies.map(([text, after], i) => ({
      id: `${base.name}-R${i + 1}`, type: "text" as const, sent: last + after, arrive: last + after + 1, text,
      truth: { listing: "-", role: "answer" },
    }))],
  };
}
/** Events in the draft made for a description (null: in an Unassigned draft). */
const mediaOf = (snap: Snapshot, description: string | null) =>
  snap.products.filter((p) => (description === null ? p.unassigned : p.descriptionEvent === description))
    .flatMap((p) => p.variants.flatMap((v) => v.images.map((i) => i.event)));

describe("only the sender can settle what the timing cannot", () => {
  it("F1 with no AI: a proposal, and YES applies it photo by photo", async () => {
    const snap = await run(withReplies(stream("F1"), [["Yes", 40]]), { ai: "off" });
    expect(snap.questions).toHaveLength(1);
    expect(snap.questions[0]).toContain("I think the first 7 photos are for Banarasi Patola Paithani Bandhej Saree");
    expect(snap.questions[0]).toContain("Reply YES to confirm or NO to decide.");
    expect(mediaOf(snap, "F1-001")).toHaveLength(7);
    expect(mediaOf(snap, "F1-023")).toHaveLength(14);
    expect(mediaOf(snap, null)).toHaveLength(0);
    expect(snap.dead).toEqual([]);
  });

  it("F1 with no AI: NO opens the 1/2/3 choice, and 2 gives everything to the second description", async () => {
    const snap = await run(withReplies(stream("F1"), [["no", 40], ["2", 60]]), { ai: "off" });
    expect(snap.questions).toHaveLength(2);
    expect(snap.questions[1]).toContain("Reply with 1, 2 or 3.");
    expect(mediaOf(snap, "F1-023")).toHaveLength(21);
    expect(mediaOf(snap, "F1-001")).toHaveLength(0);
    expect(snap.replies.some((r) => r.includes("No listing was created for"))).toBe(true);
  });

  it("F1 with no AI and no reply: nothing is merged, everything is kept aside", async () => {
    const snap = await run(stream("F1"), { ai: "off" });
    expect(mediaOf(snap, null)).toHaveLength(21);
    expect(snap.products.filter((p) => !p.unassigned)).toHaveLength(0);
  });

  it("F1 with an AI that can tell: split with no question", async () => {
    const snap = await run(stream("F1"), { ai: "oracle" });
    expect(snap.questions).toEqual([]);
    expect(mediaOf(snap, "F1-001")).toHaveLength(7);
    expect(mediaOf(snap, "F1-023")).toHaveLength(14);
  });

  it("two descriptions around one burst with nothing to go on: 1 gives it to the first", async () => {
    const snap = await run(withReplies(stream("DF_ambiguous"), [["1", 40]]), { ai: "off" });
    expect(snap.questions[0]).toContain("Reply with 1, 2 or 3.");
    expect(mediaOf(snap, "DF_ambiguous-001")).toHaveLength(5);
    expect(mediaOf(snap, "DF_ambiguous-007")).toHaveLength(5);
    expect(mediaOf(snap, null)).toHaveLength(0);
  });

  it("an older burst is never merged on age: asked, and kept aside without a reply", async () => {
    const snap = await run(stream("F3F4"), { ai: "off" });
    expect(snap.questions).toHaveLength(1);
    expect(snap.questions[0]).toContain("You sent 6 photos, then 8 more a little later");
    expect(mediaOf(snap, null)).toHaveLength(6);
    expect(mediaOf(snap, "F3F4-015")).toHaveLength(8);
  });

  it("...merged only when the sender says so (NO = they all belong)", async () => {
    const snap = await run(withReplies(stream("F3F4"), [["NO", 40]]), { ai: "off" });
    expect(mediaOf(snap, "F3F4-015")).toHaveLength(14);
    expect(mediaOf(snap, null)).toHaveLength(0);
  });

  it("...and set aside at once on YES", async () => {
    const snap = await run(withReplies(stream("F3F4"), [["yes", 40]]), { ai: "off", horizonSeconds: 120 });
    expect(mediaOf(snap, null)).toHaveLength(6);
    expect(mediaOf(snap, "F3F4-015")).toHaveLength(8);
  });

  it("a yes with no question waiting is answered, never turned into a listing", async () => {
    const snap = await run(withReplies(stream("PF1"), [["yes", 40]]), { ai: "off" });
    expect(snap.products).toHaveLength(1);
    expect(snap.replies.some((r) => r.includes("There is no question waiting"))).toBe(true);
  });
});

describe("the raw WhatsApp text is admin-only", () => {
  it("is stored for the admin and unreadable with the public key, even once the product is published", async () => {
    const snap = await run(stream("TXT07"), { ai: "off" }); // "… whatsapp 9876543210"
    expect(snap.products).toHaveLength(1);
    const { pg } = db;
    const stored = (await pg.query("select source_text from product_source_texts")).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].source_text).toContain("9876543210");
    await pg.query("update products set status='published'");
    for (const role of ["anon", "authenticated"]) {
      await pg.query(`set role ${role}`);
      try {
        await expect(pg.query("select * from product_source_texts")).rejects.toThrow(/permission denied/);
        // What the storefront reads: products with "*", variants and images.
        const visible = (await pg.query("select * from products")).rows;
        expect(visible, `${role} sees the published product`).toHaveLength(1);
        const everything = JSON.stringify([
          visible,
          (await pg.query("select * from product_variants")).rows,
          (await pg.query("select * from variant_images")).rows,
        ]);
        expect(everything).not.toContain("9876543210");
        expect(everything).not.toContain("source_text");
        for (const table of ["whatsapp_inbox", "whatsapp_batches", "whatsapp_notices", "whatsapp_settings", "whatsapp_listing_audit"]) {
          await expect(pg.query(`select * from ${table}`), `${role} can read ${table}`).rejects.toThrow(/permission denied/);
        }
      } finally {
        await pg.query("reset role");
      }
    }
  });
});

describe("thresholds are settings, not constants", () => {
  it("falls back to the default for a missing or malformed value", async () => {
    const { pg } = db;
    const seconds = async (key: string, fallback: number) =>
      Number((await pg.query("select extract(epoch from whatsapp_setting($1,$2)) as s", [key, fallback])).rows[0].s);
    expect(await seconds("skew_seconds", 99)).toBe(6);
    expect(await seconds("no_such_setting", 7)).toBe(7);
    await pg.query("update whatsapp_settings set value='banana' where key='skew_seconds'");
    try {
      expect(await seconds("skew_seconds", 6)).toBe(6);
    } finally {
      await pg.query("update whatsapp_settings set value='6' where key='skew_seconds'");
    }
  });

  it("a wider tight window turns a late description into a confident one", async () => {
    const { pg } = db;
    const reasons = async () =>
      (await pg.query("select distinct assignment_reason from whatsapp_inbox where mode='media'")).rows.map((r) => r.assignment_reason);
    await run(stream("PF_late"), { ai: "off" });
    expect(await reasons()).toEqual(["late_description"]);
    await pg.query("update whatsapp_settings set value='30' where key='tight_seconds'");
    try {
      await run(stream("PF_late"), { ai: "off" });
      expect(await reasons()).toEqual(["before_description"]);
    } finally {
      await pg.query("update whatsapp_settings set value='15' where key='tight_seconds'");
    }
  });
});

describe("what the admin panel reads about a WhatsApp draft", () => {
  it("why grouped: the audit view gives the signals and confidence for each listing", async () => {
    const { explainGrouping } = await import("@/lib/whatsapp-draft");
    await run(stream("SKEW"), { ai: "off" });
    const { pg } = db;
    // Exactly the query the product page runs.
    const audit = async (name: string) => (await pg.query(
      `select mode, kind, assignment_reason, confidence, decided_by, seconds_before_description, close_reason, summary
         from whatsapp_listing_audit where product_name = $1`, [name])).rows;
    expect(explainGrouping(await audit("Venkatagiri Cotton Saree with Zari Border"))).toEqual({
      headline: "Photos and description arrived as one forward.",
      signals: [{ signal: "Sent together with the description", count: 6, confidence: "High", timing: expect.stringMatching(/^\d+-\d+s after the description$/) }],
    });
    const late = explainGrouping(await audit("Narayanpet Cotton Saree with Contrast Border"))!;
    expect(late.headline).toBe("Photos first, then the description.");
    expect(late.signals).toEqual([{ signal: "Sent earlier; the description came late", count: 5, confidence: "Medium", timing: expect.stringMatching(/s before the description$/) }]);
    // And the stored flag the badge is drawn from.
    const flagged = (await pg.query("select name, needs_review, needs_review_reasons from products where needs_review order by name")).rows;
    expect(flagged).toEqual([{ name: "Narayanpet Cotton Saree with Contrast Border", needs_review: true, needs_review_reasons: ["late_description"] }]);
  });

  it("the collage label and the hidden tray rows are there for the page to read", async () => {
    await run(stream("F5"), { ai: "oracle" });
    const { pg } = db;
    const labels = (await pg.query("select label, count(*)::int as n from product_media_labels group by label")).rows;
    expect(labels).toEqual([{ label: "all_colours", n: 1 }]);
    const tray = (await pg.query("select reason, count(*)::int as n from variant_hidden_media group by reason order by reason")).rows;
    expect(tray).toEqual([{ reason: "duplicate", n: 3 }, { reason: "near_duplicate", n: 3 }, { reason: "over_limit", n: 2 }]);
  });
});
