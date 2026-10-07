/**
 * Replays a fixture stream through the shipped code path:
 *   signed webhook POST -> route.extractMessages -> enqueue_whatsapp_messages ->
 *   whatsapp_regroup -> claim_next -> runClaimed (mocked Meta/Cloudinary/AI) ->
 *   complete_whatsapp_message -> replies
 * against real PostgreSQL, with a virtual clock instead of sleeping.
 *
 * Scheduler model: an IDEAL scheduler. Whenever the database reports something
 * coming due (quiet period, timeout, retry, delayed acknowledgement) the replay
 * jumps to that moment and runs the sweep. Production only gets this from the
 * 115s linger of each webhook and one daily cron, so this is the best case.
 */
import { createHash, createHmac } from "node:crypto";
import { POST } from "@/app/api/whatsapp/route";
import { sweepSenders } from "@/lib/whatsapp-pipeline";
import { dbNowSeconds, shiftTime, type RunDb } from "./db";
import { mediaId, messageId, publicIdHash, serverMock, setEnv, state, type FixtureEvent, type Truth } from "./mocks";

export const SENDER = "15550100001";

export type Expectation = {
  key: string; description: string; price: number | null; price_any_of?: number[] | null;
  colours: string[]; name_require?: string[]; name_forbid?: string[];
  /** The text names nothing: the right result is the generic "Saree" and no description. */
  generic?: boolean;
};
export type Stream = {
  name: string; description: string; events: FixtureEvent[];
  expect: { listings: Expectation[]; clear?: boolean; ambiguous?: boolean };
};
export type ReplayOptions = {
  ai: "off" | "oracle";
  /** Arrival order; defaults to (arrive, id). Events keep their own `arrive` second. */
  order?: FixtureEvent[];
  /** Virtual seconds to keep running the scheduler after the last event. */
  horizonSeconds?: number;
  /** Deliver every event twice: back to back, or the whole stream again afterwards. */
  redeliver?: "adjacent" | "after";
};

export type SnapImage = { event: string | null; kind: string; primary: boolean; order: number };
export type SnapProduct = {
  name: string; slug: string; status: string; description: string | null; fabric: string | null;
  priceMin: number | null; priceMax: number | null; highlights: string[]; categoryId: string | null;
  descriptionEvent: string | null; unassigned: boolean;
  variants: { color: string | null; order: number; images: SnapImage[] }[];
};
export type Snapshot = {
  products: SnapProduct[];
  inbox: Record<string, number>;
  dead: { event: string; error: string | null }[];
  replies: string[];
  questions: string[];
  errors: { scope?: string; message: string }[];
  /** Virtual seconds after the last event at which the last product appeared. */
  lastProductAfter: number | null;
  rows: number;
};

const eventIdOf = (message: string) => message.replace(/^wamid\./, "");

function envelope(event: FixtureEvent, timestamp: number) {
  const message: Record<string, unknown> = { from: SENDER, id: messageId(event.id), timestamp: String(timestamp), type: event.type };
  if (event.type === "text") message.text = { body: event.text };
  else message[event.type] = { id: mediaId(event.id), mime_type: event.type === "video" ? "video/mp4" : "image/jpeg", sha256: event.sha256 };
  return { object: "whatsapp_business_account", entry: [{ changes: [{ value: { contacts: [{ wa_id: SENDER, profile: { name: "Test Admin" } }], messages: [message] } }] }] };
}

function signed(payload: unknown) {
  const body = JSON.stringify(payload);
  return new Request("http://localhost/api/whatsapp", {
    method: "POST", body,
    headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}` },
  });
}

export async function replay(db: RunDb, stream: Stream, options: ReplayOptions): Promise<Snapshot> {
  const { pg } = db;
  setEnv(SENDER);
  state.pg = pg;
  state.ai = options.ai;
  state.replies = [];
  state.errors = [];
  state.failMedia.clear();
  state.truthByMedia.clear();
  for (const event of stream.events) if (event.type !== "text") state.truthByMedia.set(mediaId(event.id), event.truth);

  const client = serverMock.createAdminClient();
  const rpc = async <T,>(name: string, args: Record<string, unknown>) => (await client.rpc(name, args)).data as T;
  let now = 0; // virtual seconds since the first event
  const productCount = async () => Number((await pg.query("select count(*) from products")).rows[0].count);
  let products = 0;
  let lastChange = 0;
  const noteChange = async () => {
    const count = await productCount();
    if (count !== products) { products = count; lastChange = now; }
  };
  const advance = async (seconds: number) => { if (seconds > 0) { await shiftTime(pg, SENDER, seconds); now += seconds; } };
  const sweep = async () => { await sweepSenders(client as never, Date.now() + 110_000); await noteChange(); };

  /** Runs everything that comes due on its own until `target`, then lands exactly on it. */
  async function runUntil(target: number) {
    let overdue = 0;
    for (let guard = 0; guard < 600 && now < target; guard++) {
      const wake = await rpc<number | null>("whatsapp_next_wake", { p_sender_phone: SENDER });
      if (wake === null) break;
      overdue = wake <= 0 ? overdue + 1 : 0;
      if (overdue > 2) break; // nothing a sweep can move
      const step = Math.max(1, Math.ceil(wake) + 1);
      if (now + step > target) break;
      await advance(step);
      await sweep();
    }
    await advance(target - now);
  }

  async function post(event: FixtureEvent) {
    const timestamp = Math.floor(await dbNowSeconds(pg)) - (now - event.sent);
    await POST(signed(envelope(event, timestamp)));
    await noteChange();
  }

  const order = options.order ?? [...stream.events].sort((a, b) => a.arrive - b.arrive || a.id.localeCompare(b.id));
  for (const event of order) {
    await runUntil(Math.max(now, event.arrive));
    await post(event);
    if (options.redeliver === "adjacent") await post(event);
  }
  const lastArrival = now;
  await runUntil(now + (options.horizonSeconds ?? 3600));
  if (options.redeliver === "after") {
    for (const event of order) await post(event);
    await runUntil(now + 600);
  }
  return snapshot(db, stream, lastChange === 0 ? null : lastChange - lastArrival);
}

export async function snapshot(db: RunDb, stream: Stream, lastProductAfter: number | null = null): Promise<Snapshot> {
  const { pg } = db;
  const eventByHash = new Map(stream.events.map((event) => [publicIdHash(event.id), event.id]));
  const eventOfUrl = (url: string) => {
    const match = /whatsapp\/inbox\/([0-9a-f]{64})/.exec(url);
    return (match && eventByHash.get(match[1])) ?? null;
  };
  const products = (await pg.query(
    `select p.id, p.name, p.slug, p.status, p.description, p.fabric_type, p.base_price_min, p.base_price_max, p.highlights,
            p.category_id, b.description_id, b.status as batch_status
       from products p left join whatsapp_batches b on b.product_id=p.id order by p.created_at, p.id`)).rows;
  const media = (await pg.query(
    `select v.product_id, v.id as variant_id, v.color, v.display_order as vorder, i.image_url, i.media_type, i.is_primary, i.display_order as iorder
       from product_variants v left join variant_images i on i.variant_id=v.id order by v.display_order, i.display_order, i.id`)).rows;
  const inbox = Object.fromEntries((await pg.query("select state, count(*)::int as n from whatsapp_inbox group by state")).rows.map((r) => [r.state, r.n]));
  const dead = (await pg.query("select message_id, last_error from whatsapp_inbox where state='dead' order by sequence")).rows
    .map((r) => ({ event: eventIdOf(r.message_id), error: r.last_error as string | null }));
  const questions = (await pg.query("select body from whatsapp_notices where kind='question' order by sequence")).rows.map((r) => r.body as string);
  const rows = Number((await pg.query("select count(*) from whatsapp_inbox")).rows[0].count);

  return {
    products: products.map((p) => {
      const variants = new Map<string, SnapProduct["variants"][number]>();
      for (const m of media.filter((row) => row.product_id === p.id)) {
        const variant = variants.get(m.variant_id) ?? { color: m.color, order: m.vorder, images: [] as SnapImage[] };
        variants.set(m.variant_id, variant);
        if (m.image_url) variant.images.push({ event: eventOfUrl(m.image_url), kind: m.media_type, primary: !!m.is_primary, order: m.iorder });
      }
      return {
        name: p.name, slug: p.slug, status: p.status, description: p.description, fabric: p.fabric_type,
        priceMin: p.base_price_min, priceMax: p.base_price_max, highlights: p.highlights ?? [], categoryId: p.category_id,
        descriptionEvent: p.description_id ? eventIdOf(p.description_id) : null,
        unassigned: p.batch_status === "unassigned" || p.name === "Unassigned WhatsApp media",
        variants: [...variants.values()],
      };
    }),
    inbox, dead, questions, rows,
    replies: [...state.replies],
    errors: [...state.errors],
    lastProductAfter,
  };
}

/** Grouping only: which descriptions own which media. Independent of names, slugs and display order. */
export function signature(snap: Snapshot): string {
  const lines = snap.products.map((p) => {
    const media = p.variants.flatMap((v) => v.images.map((i) => i.event)).filter(Boolean).sort();
    return `${p.unassigned ? "UNASSIGNED" : (p.descriptionEvent ?? "-")} <- ${media.join(",")}`;
  });
  return lines.sort().join("\n");
}

export function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Arrival order for one shuffle: events sent in the same second swap arrival
 * seconds among themselves (a text can overtake photos it was sent alongside),
 * then everything is processed in arrival order.
 */
export function shuffleSameSecond(events: FixtureEvent[], random: () => number): FixtureEvent[] {
  const bySecond = new Map<number, FixtureEvent[]>();
  for (const event of events) bySecond.set(event.sent, [...(bySecond.get(event.sent) ?? []), event]);
  const moved: FixtureEvent[] = [];
  for (const group of bySecond.values()) {
    const arrivals = group.map((event) => event.arrive).sort((a, b) => a - b);
    const shuffled = [...group];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffled.forEach((event, index) => moved.push({ ...event, arrive: arrivals[index] }));
  }
  // Same arrival second: the order of delivery within it is itself random.
  const tie = new Map(moved.map((event) => [event.id, random()]));
  return moved.sort((a, b) => a.arrive - b.arrive || (tie.get(a.id)! - tie.get(b.id)!));
}

export type { Truth };
