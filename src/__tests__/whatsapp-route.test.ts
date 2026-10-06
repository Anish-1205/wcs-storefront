import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), sign: vi.fn(), ai: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: mocks.client }));
vi.mock("@/lib/cloudinary", async (original) => ({ ...(await original<typeof import("@/lib/cloudinary")>()), signUpload: mocks.sign }));
vi.mock("@/lib/ai", () => ({ getAiProvider: mocks.ai }));
vi.mock("@/lib/report-error", () => ({ reportError: mocks.report }));
import { POST } from "@/app/api/whatsapp/route";
import { GET as SWEEP } from "@/app/api/whatsapp/sweep/route";
import { cld, cldVideoThumbnail } from "@/lib/cloudinary";
import { lingerSender } from "@/lib/whatsapp-pipeline";

const phone = "919876543210";
// Each call gets a later timestamp than the last, like real WhatsApp sends —
// grouping keys off message_timestamp, not call/arrival order.
let nextTimestamp = 1700000000;
/** Let WhatsApp time pass between sends (a pause in the conversation). */
const pause = (seconds: number) => { nextTimestamp += seconds; };
function message(id: string, caption = "", kind = "image", timestamp = String(nextTimestamp++), extra: Record<string, unknown> = {}) {
  return { id, from: phone, timestamp, type: kind, ...extra,
    ...(kind === "text" ? { text: { body: caption } } : { [kind]: { id: `media-${id}`, caption } }) };
}
const text = (id: string, body: string, extra: Record<string, unknown> = {}) => message(id, body, "text", String(nextTimestamp++), extra);
const album = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => message(`${prefix}${i + 1}`, "", i % 4 === 3 ? "video" : "image"));
function envelope(messages: unknown[]) {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages } }] }] };
}
function request(payload: unknown) {
  const body = JSON.stringify(payload);
  return new Request("http://localhost/api/whatsapp", { method: "POST", body,
    headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}` } });
}
const send = async (...messages: unknown[]) => (await POST(request(envelope(messages)))).status;
/** Only Date is faked (the route's poll still uses a real timer), so this is how leases, backoffs and quiet periods elapse. */
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);
/** What the scheduler does: the sweep endpoint with the cron secret. */
const sweep = async () => (await SWEEP(new Request("http://localhost/api/whatsapp/sweep", { headers: { authorization: "Bearer cron" } }))).status;

const MAX_ATTEMPTS = 5;
const TERMINAL = ["done", "dead"];
const BURST = 8_000, TIGHT = 15_000, QUIET = 45_000, HARD = 600_000, STALE = 1_800_000;
// Stateful transport double mirroring migrations 028 + 029 rule for rule;
// actual SQL locking/rollback is tested separately on PostgreSQL (scripts/verify-p0.mjs).
function database() {
  const jobs = new Map<string, any>(); // insertion order is whatsapp_inbox.sequence
  const batches: any[] = [];
  const notices: any[] = [];
  const plans: any[] = [];
  const unassigned: string[][] = []; // media of each "Unassigned WhatsApp media" draft
  let token = 0, sequence = 0;
  const failures = new Map<string, number>();
  const all = () => [...jobs.values()];
  const of = (sender: string) => all().filter((j) => j.sender === sender);
  const batchOf = (job: any) => batches[job.batch - 1];
  const live = (job: any) => batchOf(job).frozen_at === null;
  const bySent = (x: any, y: any) => x.ts - y.ts || x.seq - y.seq;
  const label = (value: string) => { const t = (value ?? "").replace(/\s+/g, " ").trim(); return t.length > 40 ? `${t.slice(0, 39)}…` : t; };
  const newBatch = (sender: string, fields: Record<string, unknown> = {}) => {
    const b = { id: batches.length + 1, sender, sealed: true, product: false, status: null, frozen_at: null, claim_from: null, claim_to: null,
      description: null, close_reason: null, summary: null, asked_at: null, ...fields };
    batches.push(b); return b;
  };
  const pool = (sender: string) => batches.find((b) => b.sender === sender && !b.sealed) ?? newBatch(sender, { sealed: false, status: "pool" });
  const notify = (sender: string, kind: string, key: string, body: string, delay = 0) => {
    const existing = notices.find((n) => n.key === key);
    if (existing) { if (!existing.sent && existing.attempts === 0) existing.body = body; }
    else notices.push({ id: `n${notices.length + 1}`, seq: notices.length + 1, sender, kind, key, body,
      not_before: Date.now() + delay, attempts: 0, lease_until: null, sent: false, created_at: Date.now() });
  };
  const dropAck = (id: string) => { const i = notices.findIndex((n) => n.key === `ack:${id}` && !n.sent && n.attempts === 0); if (i >= 0) notices.splice(i, 1); };
  const liveMedia = (sender: string) => of(sender).filter((j) => j.mode === "media" && live(j));
  const descriptions = (sender: string) => of(sender).filter((j) => j.mode === "finalize");
  const burstRows = (sender: string, bursts: number[]) => liveMedia(sender).filter((j) => bursts.includes(j.burst));
  const assign = (sender: string, bursts: number[], batch: any, reason: string, confidence: string) => {
    for (const j of burstRows(sender, bursts)) Object.assign(j, { batch: batch.id, reason, confidence });
  };
  const burstsOf = (sender: string, keep: (j: any) => boolean = () => true) => {
    const groups = new Map<number, any>();
    for (const j of liveMedia(sender).filter(keep)) {
      const g = groups.get(j.burst) ?? { id: j.burst, lo: j.ts, hi: j.ts, seq: j.seq };
      groups.set(j.burst, { id: j.burst, lo: Math.min(g.lo, j.ts), hi: Math.max(g.hi, j.ts), seq: Math.min(g.seq, j.seq) });
    }
    return [...groups.values()];
  };

  function freeze(batch: any, reason: string) {
    if (batch.frozen_at !== null) return;
    const d = jobs.get(batch.description);
    const media = all().filter((j) => j.batch === batch.id && j.mode === "media");
    for (const j of media) if (j.confidence === "provisional") j.confidence = "high";
    const count = (keep: (j: any) => boolean) => media.filter(keep).length;
    const nBefore = count((j) => j.reason === "before_description"), nAfter = count((j) => j.reason === "after_description");
    const nConfirmed = count((j) => j.reason?.startsWith("confirmed")), nExplicit = count((j) => j.confidence === "explicit");
    const groups = new Set(media.map((j) => j.burst)).size;
    const descriptionFirst = media.some((j) => ["after_description", "confirmed_first"].includes(j.reason));
    const hi = media.length ? Math.max(...media.map((j) => j.ts)) : null;
    const claimed = media.filter((j) => j.confidence === "explicit").map((j) => j.ts);
    const own = Boolean(d.payload.kind);
    const prior = descriptions(batch.sender).filter((f) => f !== d && f.ts < d.ts).map((f) => batchOf(f).claim_to ?? f.ts);
    const floor = prior.length ? Math.max(...prior) : null;
    let from = descriptionFirst ? d.ts : Math.max(d.ts - STALE, floor ?? d.ts - STALE);
    let to = descriptionFirst ? hi! + BURST : d.ts;
    if (own || nExplicit > 0) {
      if (own) claimed.push(d.ts);
      from = Math.max(floor ?? -Infinity, Math.min(...claimed) - BURST); to = Math.max(...claimed) + BURST;
    }
    const parts = [own && "1 sent with this caption", nExplicit > 0 && `${nExplicit} from the album you captioned or replied to`,
      nBefore > 0 && `${nBefore} sent before your description`, nAfter > 0 && `${nAfter} sent after your description`,
      nConfirmed > 0 && `${nConfirmed} you confirmed`].filter(Boolean);
    Object.assign(batch, { frozen_at: Date.now(), status: "ready", close_reason: reason, claim_from: from, claim_to: to,
      summary: (parts.join(", ") + (groups > 1 ? `, in ${groups} groups` : "")) || null });
    dropAck(d.message_id);
  }
  function closeEmpty(id: string, reason: string, reply: string) {
    const job = jobs.get(id);
    if (TERMINAL.includes(job.state)) return;
    Object.assign(job, { state: "done", token: null, lease_until: null, completed_at: Date.now(), reply });
    const batch = batchOf(job);
    Object.assign(batch, { frozen_at: batch.frozen_at ?? Date.now(), status: "closed_empty", close_reason: reason, claim_from: null, claim_to: null });
    dropAck(id);
  }
  function setAside(sender: string, bursts: number[], summary: string) {
    const rows = burstRows(sender, bursts);
    if (!rows.length) return;
    const batch = newBatch(sender, { status: "unassigned", frozen_at: Date.now(), close_reason: "set_aside", summary });
    for (const j of rows) Object.assign(j, { batch: batch.id, reason: "unassigned", confidence: "none" });
  }
  function finishUnassigned(sender: string) {
    for (const b of batches.filter((x) => x.sender === sender && x.status === "unassigned" && !x.product)) {
      const rows = all().filter((j) => j.batch === b.id);
      if (rows.some((j) => !TERMINAL.includes(j.state))) continue;
      const saved = rows.filter((j) => j.state === "done" && j.asset).sort(bySent);
      if (!saved.length) { Object.assign(b, { status: "closed_empty", close_reason: "set_aside_without_media" }); continue; }
      b.product = true; unassigned.push(saved.map((j) => j.message_id));
      notify(sender, "unassigned", `unassigned:${b.id}`, `${saved.length} photo(s)/video(s) were saved as the draft "Unassigned WhatsApp media" instead of being added to a listing. ${b.summary ? `${b.summary} ` : ""}Open it in the admin panel to sort them.`);
    }
  }
  function placeStragglers(sender: string) {
    for (const j of liveMedia(sender).sort((x, y) => x.seq - y.seq)) {
      const target = batches.filter((b) => b.sender === sender && b.frozen_at !== null && b.claim_from !== null && j.ts >= b.claim_from && j.ts <= b.claim_to
        && (b.product || all().some((f) => f.batch === b.id && f.mode === "finalize" && !TERMINAL.includes(f.state)))
        // ...and never across another description.
        && !descriptions(sender).some((o) => { const dts = jobs.get(b.description).ts; return o.message_id !== b.description && o.ts > Math.min(dts, j.ts) && o.ts < Math.max(dts, j.ts); }))
        .sort((x, y) => x.claim_to - y.claim_to || x.id - y.id)[0];
      if (!target) continue;
      Object.assign(j, { batch: target.id, reason: "straggler", confidence: "high" });
      if (j.state === "done" && j.asset && target.product) { j.appended = true; notify(sender, "late", `late:${j.message_id}`, "A late photo/video was added to your last listing."); }
    }
  }
  function regroup(sender: string) {
    placeStragglers(sender);
    const waiting = pool(sender);
    // 1. Bursts.
    let prevTs: number | null = null, cur: number | null = null;
    for (const j of liveMedia(sender).sort(bySent)) {
      if (prevTs === null || j.ts - prevTs > BURST || descriptions(sender).some((f) => f.ts > prevTs! && f.ts < j.ts)) cur = j.seq;
      j.burst = cur; prevTs = j.ts;
    }
    const open = descriptions(sender).filter((f) => live(f) && !TERMINAL.includes(f.state)).sort(bySent);
    // 2. Explicit signals.
    for (const j of liveMedia(sender)) if (j.confidence === "explicit") j.confidence = null;
    for (const d of open) {
      const repliedTo = d.payload.raw_message?.context?.id;
      assign(sender, [...new Set(liveMedia(sender).filter((j) => j.message_id === repliedTo).map((j) => j.burst))], batchOf(d), "reply_to_media", "explicit");
      if (d.payload.kind) {
        const others = descriptions(sender).filter((o) => o !== d);
        assign(sender, burstsOf(sender).filter((g) => g.hi >= d.ts - BURST && g.lo <= d.ts + BURST
          && !others.some((o) => (o.ts > g.hi && o.ts < d.ts) || (o.ts > d.ts && o.ts < g.lo))).map((g) => g.id), batchOf(d), "caption_album", "explicit");
      }
    }
    // 3. Walk bursts and open descriptions in send order.
    const tokens = [...open.map((f) => ({ kind: "D", id: f.message_id, burst: 0, ts: f.ts, rnk: 1, seq: f.seq })),
      ...burstsOf(sender, (j) => j.confidence !== "explicit").map((g) => ({ kind: "B", id: "", burst: g.id, ts: g.lo, rnk: g.hi > g.lo ? 2 : 1, seq: g.seq }))]
      .sort((x, y) => x.ts - y.ts || x.rnk - y.rnk || x.seq - y.seq);
    const endOf = (burst: number) => Math.max(...burstRows(sender, [burst]).map((j) => j.ts));
    const seen = (burst: number) => burstRows(sender, [burst]).map((j) => Math.max(j.created_at, j.ts));
    let prev: any = null, acc: number[] = [];
    for (const tok of tokens) {
      if (tok.kind === "B") { acc.push(tok.burst); continue; }
      const d = jobs.get(tok.id), dLabel = label(d.payload.caption);
      const explicit = Boolean(d.payload.kind) || all().some((j) => j.batch === d.batch && j.mode === "media" && j.confidence === "explicit");
      if (prev) {
        const prevLabel = label(prev.payload.caption), k = acc.length;
        if (k === 0) {
          closeEmpty(prev.message_id, "superseded", `No photos or videos arrived for "${prevLabel}" before your next description, so no listing was created for it.`);
        } else if (explicit) {
          assign(sender, acc, batchOf(prev), "after_description", "high"); freeze(batchOf(prev), "next_description"); acc = [];
        } else {
          const last = acc.slice(k - 1), rest = acc.slice(0, k - 1);
          const nLast = burstRows(sender, last).length, nRest = burstRows(sender, rest).length;
          const tight = d.ts - endOf(acc[k - 1]) <= TIGHT;
          const contested = (k === 1) === tight;
          let res = d.resolution;
          if (contested && !res) {
            const asked = batchOf(d).asked_at;
            if (asked !== null && asked + HARD <= Date.now()) res = d.resolution = "aside";
            else {
              assign(sender, rest, batchOf(prev), "after_description", "high");
              assign(sender, last, waiting, "ambiguous", "none");
              batchOf(prev).status = batchOf(d).status = "awaiting_confirmation";
              batchOf(d).asked_at ??= Date.now();
              dropAck(prev.message_id); dropAck(d.message_id);
              notify(sender, "question", `question:${d.message_id}`,
                `I am not sure which description these belong to, so nothing was created yet.\nYou sent description 1 ("${prevLabel}"), then `
                + (k === 1 ? `${nLast} photo(s)/video(s)` : `${nRest} photo(s)/video(s), a pause, ${nLast} more`)
                + `, then description 2 ("${dLabel}").\nReply with one number:\n`
                + (k === 1 ? "1 = they belong to description 1\n2 = they belong to description 2\n3 = keep them aside"
                  : `1 = all ${nRest + nLast} belong to description 1\n2 = the first ${nRest} to description 1, the last ${nLast} to description 2\n3 = keep the last ${nLast} aside`)
                + "\nNo reply in 10 minutes means 3.", 4_000);
              finishUnassigned(sender);
              return;
            }
          }
          let give: number[], keep: number[];
          if (contested) {
            give = rest; keep = res === "second" ? last : [];
            if (res === "first") assign(sender, last, batchOf(prev), "confirmed_first", "confirmed");
            else if (res === "aside") setAside(sender, last, `They were sent between "${prevLabel}" and "${dLabel}" and it was not clear which one they belong to.`);
          } else if (k >= 2) { give = rest; keep = last; } else { give = acc; keep = []; }
          assign(sender, keep, waiting, "awaiting_description", "provisional");
          assign(sender, give, batchOf(prev), "after_description", "high");
          if (all().some((j) => j.batch === prev.batch && j.mode === "media")) freeze(batchOf(prev), "next_description");
          else closeEmpty(prev.message_id, "superseded", `No listing was created for "${prevLabel}": no photos or videos were matched to it.`);
          acc = keep;
        }
        prev = null;
      }
      const stale = acc.filter((b) => endOf(b) < d.ts - STALE);
      if (stale.length) { setAside(sender, stale, "No description arrived within 30 minutes of them."); acc = acc.filter((b) => !stale.includes(b)); }
      // One draft never spans another description.
      acc = acc.filter((b) => !descriptions(sender).some((o) => o !== d && o.ts < d.ts && o.ts > endOf(b)));
      if (explicit) {
        assign(sender, acc, waiting, "awaiting_description", "provisional"); freeze(batchOf(d), "explicit");
      } else if (acc.length) {
        const confirmed = d.resolution === "second";
        assign(sender, acc, batchOf(d), confirmed ? "confirmed_second" : "before_description", confirmed ? "confirmed" : "high");
        freeze(batchOf(d), "photos_first");
      } else { batchOf(d).status = "awaiting_media"; prev = d; }
      acc = [];
    }
    // 4. Whatever follows the last description.
    if (prev) {
      const prevLabel = label(prev.payload.caption);
      // The listing takes bursts until 45s pass with nothing arriving.
      const give: number[] = []; let lastSeen: number | null = null;
      for (const b of acc) {
        if (lastSeen !== null && Math.min(...seen(b)) >= lastSeen + QUIET) break;
        give.push(b); lastSeen = Math.max(lastSeen ?? 0, ...seen(b));
      }
      acc = acc.slice(give.length);
      if (give.length) {
        assign(sender, acc, waiting, "awaiting_description", "provisional");
        assign(sender, give, batchOf(prev), "after_description", "provisional");
        dropAck(prev.message_id);
        if (acc.length || lastSeen! + QUIET <= Date.now()) freeze(batchOf(prev), "quiet");
      } else if (prev.created_at + HARD <= Date.now()) {
        closeEmpty(prev.message_id, "timeout", `No photos or videos arrived for "${prevLabel}" within 10 minutes, so no listing was created. Please send the photos/videos and the description again.`);
      } else notify(sender, "ack", `ack:${prev.message_id}`, `Got your description for "${prevLabel}". Send the photos/videos now.`, 4_000);
    }
    if (acc.length) {
      assign(sender, acc, waiting, "awaiting_description", "provisional");
      setAside(sender, acc.filter((b) => Math.max(...seen(b)) + STALE <= Date.now()), "No description arrived within 30 minutes of them.");
    }
    placeStragglers(sender);
    finishUnassigned(sender);
  }

  function enqueue(messages: any[]) {
    for (const m of messages) {
      if (jobs.has(m.message_id)) continue;
      const sender = m.sender_phone, caption = (m.caption ?? "").trim();
      const row = (batch: any, mode: string, extra: Record<string, unknown> = {}) => jobs.set(m.message_id, { message_id: m.message_id, sender, payload: m, mode,
        batch: batch.id, seq: ++sequence, ts: Date.parse(m.message_timestamp), created_at: Date.now(), state: "pending", attempts: 0, asset: null,
        token: null, lease_until: null, last_error: null, reply: null, reply_sent: false, reply_attempts: 0, reply_lease_until: null, completed_at: null,
        burst: null, reason: null, confidence: null, resolution: null, ...extra });
      if (m.mode === "numbered") {
        // The latest closed listing, including one closed by this very envelope.
        regroup(sender);
        row(batches.filter((b) => b.sender === sender && b.sealed && b.frozen_at !== null && b.status !== "unassigned").at(-1)
          ?? newBatch(sender, { status: "legacy", frozen_at: Date.now() }), "numbered");
      } else if (m.mode === "finalize" && !m.kind && /^[1-3]$/.test(caption)) {
        // A bare 1/2/3 answers the oldest open question.
        const question = batches.find((b) => b.sender === sender && b.status === "awaiting_confirmation" && b.frozen_at === null
          && b.asked_at !== null && !jobs.get(b.description).resolution);
        if (question) {
          jobs.get(question.description).resolution = caption === "1" ? "first" : caption === "2" ? "second" : "aside";
          row(question, "answer", { state: "done", completed_at: Date.now(), reason: "answer" });
        } else row(pool(sender), "answer", { state: "done", completed_at: Date.now(),
          reply: "There is no question waiting for an answer. To add a listing, send the photos/videos and a description." });
      } else if (m.mode === "finalize") row(newBatch(sender, { status: "awaiting_media", description: m.message_id }), "finalize");
      else row(pool(sender), "media");
    }
    for (const sender of new Set(messages.map((m) => m.sender_phone))) regroup(sender);
  }
  function blocked(job: any) {
    const siblings = all().filter((s) => s.batch === job.batch && s !== job && !TERMINAL.includes(s.state));
    if (job.mode === "finalize") return (batchOf(job).frozen_at === null && batchOf(job).status !== null) || siblings.some((s) => s.mode === "media");
    if (job.mode === "numbered") return siblings.some((s) => s.mode === "finalize");
    return job.mode === "answer";
  }
  function bury(job: any, error: string) {
    if (TERMINAL.includes(job.state)) return;
    Object.assign(job, { state: "dead", token: null, lease_until: null, completed_at: Date.now(), last_error: error,
      reply: job.mode === "finalize" ? "Something went wrong creating your listing, so it was not saved. Please resend the photos/videos and then the description."
        : job.mode === "numbered" ? `Photo ${job.payload.caption} could not be added after several tries. Please resend it.`
        : "One photo/video could not be saved after several tries and was left out. Please resend it, or add it in the admin panel." });
  }
  function take(job: any) {
    Object.assign(job, { state: "processing", token: `token-${++token}`, lease_until: Date.now() + 120_000, attempts: job.attempts + 1, last_error: null });
    return { ...job, grouping: batchOf(job).summary,
      pending_media: all().filter((j) => j !== job && j.batch === job.batch && j.mode !== "numbered" && j.state !== "dead" && j.asset).sort(bySent).map((j) => j.asset) };
  }
  function claimNext(sender: string) {
    for (;;) {
      const job = of(sender).find((j) => ["pending", "failed", "processing"].includes(j.state)
        && (j.state === "pending" || j.lease_until === null || j.lease_until <= Date.now()) && !blocked(j));
      if (!job) {
        finishUnassigned(sender);
        return { idle: true, in_flight: of(sender).some((j) => j.state === "processing" && j.lease_until > Date.now()) };
      }
      if (job.attempts >= MAX_ATTEMPTS) { bury(job, `${job.last_error ?? "Worker lease expired"} (retry limit reached)`); continue; }
      return take(job);
    }
  }
  function complete(job: any, plan: any) {
    const batch = batchOf(job);
    const planned = new Set((plan.variants ?? []).flatMap((v: any) => (v.media ?? []).map((m: any) => m.url)));
    // The batch gained media the plan does not cover: hand the finalize back, attempt refunded.
    if (job.mode === "finalize" && all().some((s) => s.batch === job.batch && s.mode === "media" && s !== job && s.state !== "dead"
      && (s.state !== "done" || (s.asset && !planned.has(s.asset.url))))) {
      Object.assign(job, { state: "pending", token: null, lease_until: null, attempts: Math.max(job.attempts - 1, 0) });
      return { requeued: true };
    }
    let reply = plan.reply ?? null;
    if (job.mode === "finalize" && plan.variants?.length) batch.product = true;
    else if (job.mode === "numbered" && !batch.product) reply = `Photo ${job.payload.caption} was not added: there is no listing to add it to. Forward the photos/videos, then send a description.`;
    else if (job.mode === "numbered" && !job.asset) throw new Error("Missing media checkpoint");
    else if (job.mode === "media" && job.asset && batch.product) { job.appended = true; reply ??= "A late photo/video was added to your last listing."; }
    Object.assign(job, { state: "done", completed_at: Date.now(), lease_until: null, reply });
    plans.push(plan);
    return {};
  }
  function claimReplies(sender: string) {
    const now = Date.now();
    const due = of(sender).filter((j) => TERMINAL.includes(j.state) && j.reply && !j.reply_sent && j.reply_attempts < 5
      && (j.reply_lease_until === null || j.reply_lease_until <= now) && j.completed_at > now - 86_400_000);
    for (const j of due) { j.reply_attempts++; j.reply_lease_until = now + 60_000; }
    const dueNotices = notices.filter((n) => n.sender === sender && !n.sent && n.attempts < 5 && n.not_before <= now
      && (n.lease_until === null || n.lease_until <= now) && n.created_at > now - 86_400_000);
    for (const n of dueNotices) { n.attempts++; n.lease_until = now + 60_000; }
    return [...due.map((j) => ({ message_id: j.message_id, sender_phone: j.sender, reply: j.reply, state: j.state, last_error: j.last_error, at: j.completed_at, seq: j.seq })),
      ...dueNotices.map((n) => ({ message_id: `notice:${n.id}`, sender_phone: n.sender, reply: n.body, state: "notice", last_error: null, at: n.not_before, seq: n.seq }))]
      .sort((x, y) => x.at - y.at || x.seq - y.seq).map(({ at: _at, seq: _seq, ...item }) => item);
  }
  function sweepSenders(only: string | null) {
    const now = Date.now();
    const senders = [...new Set([
      ...all().filter((j) => !TERMINAL.includes(j.state)).map((j) => j.sender),
      ...batches.filter((b) => b.frozen_at === null && all().some((j) => j.batch === b.id && ["media", "finalize"].includes(j.mode))).map((b) => b.sender),
      ...batches.filter((b) => b.status === "unassigned" && !b.product).map((b) => b.sender),
      ...all().filter((j) => j.reply && !j.reply_sent && j.reply_attempts < 5 && j.completed_at > now - 86_400_000).map((j) => j.sender),
      ...notices.filter((n) => !n.sent && n.attempts < 5 && n.created_at > now - 86_400_000).map((n) => n.sender),
    ])].filter((s) => only === null || s === only).sort();
    senders.forEach(regroup);
    return senders;
  }
  function nextWake(sender: string) {
    const now = Date.now();
    const pooled = of(sender).filter((j) => j.mode === "media" && !batchOf(j).sealed);
    const times = [
      ...notices.filter((n) => n.sender === sender && !n.sent && n.attempts < 5).map((n) => Math.max(n.not_before, n.lease_until ?? n.not_before)),
      ...batches.filter((b) => b.sender === sender && b.frozen_at === null && b.status === "awaiting_media").map((b) => {
        const media = all().filter((j) => j.batch === b.id && j.mode === "media");
        return media.length ? Math.max(...media.map((j) => Math.max(j.created_at, j.ts))) + QUIET : jobs.get(b.description).created_at + HARD;
      }),
      ...batches.filter((b) => b.sender === sender && b.frozen_at === null && b.status === "awaiting_confirmation" && b.asked_at !== null).map((b) => b.asked_at + HARD),
      ...(pooled.length ? [Math.max(...pooled.map((j) => Math.max(j.created_at, j.ts))) + STALE] : []),
      ...of(sender).filter((j) => j.state === "failed" && j.lease_until !== null).map((j) => j.lease_until),
      ...of(sender).filter((j) => TERMINAL.includes(j.state) && j.reply && !j.reply_sent && j.reply_attempts < 5 && j.completed_at > now - 86_400_000).map((j) => j.reply_lease_until ?? now),
    ];
    return times.length ? (Math.min(...times) - now) / 1000 : null;
  }
  const settled = (ids: string[]) => ids.filter((id) => jobs.has(id)).map((id) => jobs.get(id)).every((j) =>
    (TERMINAL.includes(j.state) && (!j.reply || j.reply_sent || j.reply_attempts >= 5))
    || (j.state === "pending" && j.mode === "finalize" && batchOf(j).frozen_at === null && batchOf(j).status !== null));

  const rpc = vi.fn(async (name: string, args: any) => {
    if ((failures.get(name) ?? 0) > 0) { failures.set(name, failures.get(name)! - 1); return { error: { message: "injected failure" }, data: null }; }
    if (name === "enqueue_whatsapp_messages") { enqueue(args.p_messages); return { data: null, error: null }; }
    if (name === "claim_next_whatsapp_message") return { data: claimNext(args.p_sender_phone), error: null };
    if (name === "claim_whatsapp_replies") return { data: claimReplies(args.p_sender_phone), error: null };
    if (name === "whatsapp_sweep") return { data: sweepSenders(args.p_sender_phone), error: null };
    if (name === "whatsapp_next_wake") return { data: nextWake(args.p_sender_phone), error: null };
    if (name === "whatsapp_settled") return { data: settled(args.p_message_ids), error: null };
    if (name === "finish_whatsapp_reply" && args.p_message_id.startsWith("notice:")) {
      const n = notices.find((x) => `notice:${x.id}` === args.p_message_id);
      if (!n.sent) { n.sent = args.p_sent; n.lease_until = args.p_sent ? null : Date.now() + n.attempts * 5_000; }
      return { data: null, error: null };
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
    const chain = { select: () => chain,
      then: (resolve: any) => resolve({ error: null, data: table === "categories" ? [{ id: "cat", name: "Silk", slug: "silk" }] : [{ id: "collection", name: "Bridal", description: null }] }) };
    return chain;
  }
  return { rpc, from, jobs, plans, failures, batches, notices, unassigned };
}
let db: ReturnType<typeof database>;
let uploads: number;
let replies: string[];
const products = () => db.plans.filter((p) => p.variants?.length);
const mediaOf = (plan: any) => plan.variants.flatMap((v: any) => v.media.map((m: any) => m.message_id));
const ids = (messages: { id: string }[]) => messages.map((m) => m.id);
const statusOf = (id: string) => db.batches[db.jobs.get(id).batch - 1].status;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  nextTimestamp = 1700000000;
  vi.stubEnv("WHATSAPP_APP_SECRET", "secret"); vi.stubEnv("WHATSAPP_ADMIN_NUMBERS", phone); vi.stubEnv("CRON_SECRET", "cron");
  for (const key of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME"]) vi.stubEnv(key, "test");
  db = database(); mocks.client.mockReturnValue(db);
  mocks.ai.mockReturnValue({ isConfigured: () => false });
  mocks.sign.mockResolvedValue({ signature: "signed", uploadUrl: "https://upload.invalid" });
  uploads = 0; replies = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://upload.invalid") {
      // What Cloudinary answers: the delivery URL of the resource type uploaded.
      uploads++; const form = init?.body as FormData; const id = form.get("public_id"); const video = (form.get("file") as File).name.endsWith(".mp4");
      return new Response(JSON.stringify({ secure_url: `https://res.cloudinary.com/test/${video ? "video" : "image"}/upload/v1791277068/${id}.${video ? "mp4" : "jpg"}`, public_id: id }));
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
      if (url.includes("/resources/")) return new Response(JSON.stringify({ secure_url: "https://res.cloudinary.com/test/image/upload/v1/recovered.jpg" }));
      if (url.includes("media-a")) throw new Error("Meta media expired");
      return original(...args);
    }));
    advance(6_000);
    expect((await POST(request(payload))).status).toBe(200);
    expect(uploads).toBe(1);
    expect(db.jobs.get("a").asset.url).toBe("https://res.cloudinary.com/test/image/upload/v1/recovered.jpg");
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
  it("answers a numbered photo that has no listing, without consuming the description that is still waiting", async () => {
    expect(await send(text("a", "Silk"), message("b", "2"))).toBe(200);
    expect(db.jobs.get("a").state).toBe("pending");
    expect(db.jobs.get("b")).toMatchObject({ state: "done", reply: expect.stringContaining("no listing to add it to") });
    expect(replies).toEqual([expect.stringContaining("Photo 2 was not added")]);
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

describe("every stored media URL is renderable (broken admin thumbnails)", () => {
  it("writes Cloudinary delivery URLs of the matching resource type, with a photo as the primary", async () => {
    expect(await send(message("v", "", "video"), message("a"), message("b"), message("close", "Silk | 1200", "text"))).toBe(200);
    const media = products()[0].variants[0].media;
    // The exact shape production stores: res.cloudinary.com/<cloud>/<image|video>/upload/v<version>/whatsapp/inbox/<sha256 of the message id>.<ext>
    expect(media.map((m: any) => m.url)).toEqual([
      expect.stringMatching(/^https:\/\/res\.cloudinary\.com\/test\/video\/upload\/v\d+\/whatsapp\/inbox\/[0-9a-f]{64}\.mp4$/),
      expect.stringMatching(/^https:\/\/res\.cloudinary\.com\/test\/image\/upload\/v\d+\/whatsapp\/inbox\/[0-9a-f]{64}\.jpg$/),
      expect.stringMatching(/^https:\/\/res\.cloudinary\.com\/test\/image\/upload\/v\d+\/whatsapp\/inbox\/[0-9a-f]{64}\.jpg$/),
    ]);
    expect(media.map((m: any) => [m.kind, m.is_primary])).toEqual([["video", false], ["image", true], ["image", false]]);
    // What the admin requests for each row is always an image: the photo itself, or the video's poster frame.
    expect(cld(media[1].url, "thumbnail")).toMatch(/\/image\/upload\/c_fill,w_400,h_500,q_auto:best,f_auto\/v\d+\/whatsapp\/inbox\/[0-9a-f]{64}\.jpg$/);
    expect(cldVideoThumbnail(media[0].url)).toMatch(/\/video\/upload\/so_0,c_fill,w_400,h_500,q_auto\/v\d+\/whatsapp\/inbox\/[0-9a-f]{64}\.jpg$/);
    expect(cld(media[0].url, "thumbnail")).toBe(cldVideoThumbnail(media[0].url)); // the list thumbnail of a video-only product
  });
  it("refuses to store a URL the site could not render, and retries instead", async () => {
    const original = global.fetch;
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => String(args[0]) === "https://upload.invalid"
      ? new Response(JSON.stringify({ secure_url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1" })) : original(...args)));
    expect(await send(message("a"))).toBe(503);
    expect(db.jobs.get("a")).toMatchObject({ state: "failed", asset: null, last_error: expect.stringContaining("cannot be rendered as image") });
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
    expect(db.jobs.get("late")).toMatchObject({ batch: db.jobs.get("a").batch, appended: true, reason: "straggler" });
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

// The same conversations delivered the two ways Meta delivers them. Grouping
// keys off message_timestamp, so both must end in the same drafts.
const deliveries: [string, (messages: any[]) => Promise<void>][] = [
  ["one webhook at a time", async (messages) => { for (const m of messages) expect(await send(m)).toBe(200); }],
  ["concurrent webhooks, each album arriving back to front", async (messages) => {
    // Media reaches the server in the reverse of the order it was sent, and
    // every delivery is in flight at once.
    const scrambled: any[] = []; let run: any[] = [];
    for (const m of messages) { if (m.type === "text") { scrambled.push(...run.reverse(), m); run = []; } else run.push(m); }
    scrambled.push(...run.reverse());
    const statuses = await Promise.all(scrambled.map((m) => POST(request(envelope([m])))));
    expect(statuses.map((r) => r.status)).toEqual(scrambled.map(() => 200));
  }],
];
describe.each(deliveries)("grouping by description (%s)", (_name, deliver) => {
  /** Let the quiet period pass and run the scheduler. */
  const settle = async (ms = 46_000) => { advance(ms); expect(await sweep()).toBe(200); };

  it("photos and videos first, then the description: one draft, immediately", async () => {
    const a = album("a", 5);
    await deliver([...a, text("d", "Silk saree | 1200")]);
    expect(products()).toHaveLength(1);
    expect(mediaOf(products()[0])).toEqual(ids(a));
    expect(replies).toEqual([expect.stringContaining("with 5 photo(s)/video(s) (5 sent before your description)")]);
  });
  it("description first, then the photos and videos: parked, then one draft after the quiet period", async () => {
    const d = text("d", "Silk saree | 1200"), a = album("a", 5);
    await deliver([d, ...a]);
    expect(products()).toHaveLength(0);
    expect(db.jobs.get("d").state).toBe("pending");
    expect(statusOf("d")).toBe("awaiting_media");
    expect(replies.some((r) => r.includes("No photos"))).toBe(false);
    advance(30_000); expect(await sweep()).toBe(200);
    expect(products()).toHaveLength(0); // still inside the quiet period
    await settle(16_000);
    expect(products()).toHaveLength(1);
    expect(mediaOf(products()[0])).toEqual(ids(a));
    expect(replies).toEqual([expect.stringContaining("(5 sent after your description)")]);
    expect(db.jobs.get("a1")).toMatchObject({ reason: "after_description", confidence: "high" });
  });
  it("D1 A, pause, D2 B: each description-first listing gets only its own media", async () => {
    const d1 = text("d1", "Silk | 1200"), a = album("a", 4);
    pause(60);
    const d2 = text("d2", "Cotton | 900"), b = album("b", 3);
    await deliver([d1, ...a, d2, ...b]);
    expect(products().map(mediaOf)).toEqual([ids(a)]); // closed by the next description
    await settle();
    expect(products().map(mediaOf)).toEqual([ids(a), ids(b)]);
    expect(products().map((p) => p.price)).toEqual([1200, 900]);
  });
  it("A D1, pause, B D2: each photos-first listing gets only its own media", async () => {
    const a = album("a", 4), d1 = text("d1", "Silk | 1200");
    pause(60);
    const b = album("b", 3), d2 = text("d2", "Cotton | 900");
    await deliver([...a, d1, ...b, d2]);
    expect(products().map(mediaOf)).toEqual([ids(a), ids(b)]);
    expect(products().map((p) => p.price)).toEqual([1200, 900]);
  });
  it("the production incident with a pause between the albums: D1+A and B+D2, never a merged draft", async () => {
    const d1 = text("d1", "Benarsi patola paithani bandhej sarees 7"), a = album("a", 6);
    pause(13);
    const b = album("b", 6);
    pause(6);
    const d2 = text("d2", "Benarsi patola paithani bandhej sarees 7");
    await deliver([d1, ...a, ...b, d2]);
    expect(products().map(mediaOf)).toEqual([ids(a), ids(b)]);
    expect(replies.some((r) => r.includes("No photos"))).toBe(false);
    expect(replies).toEqual(expect.arrayContaining([
      expect.stringContaining("with 6 photo(s)/video(s) (6 sent after your description)"),
      expect.stringContaining("with 6 photo(s)/video(s) (6 sent before your description)"),
    ]));
  });
  it("the production incident with no pause between the albums: asks, and creates nothing until answered", async () => {
    const d1 = text("d1", "Benarsi patola paithani bandhej sarees 7"), ab = album("m", 12), d2 = text("d2", "Second description");
    await deliver([d1, ...ab, d2]);
    expect(products()).toHaveLength(0);
    expect([statusOf("d1"), statusOf("d2")]).toEqual(["awaiting_confirmation", "awaiting_confirmation"]);
    expect(db.jobs.get("m1")).toMatchObject({ reason: "ambiguous", confidence: "none" });
    advance(5_000); expect(await sweep()).toBe(200); // the question is held a moment so it counts the whole album
    expect(replies.filter((r) => r.includes("I am not sure which description"))).toHaveLength(1);
    expect(replies.at(-1)).toContain("then 12 photo(s)/video(s), then description 2");
    await settle(); // a quiet period does not resolve a question
    expect(products()).toHaveLength(0);
    // "2": they belong to the second description.
    expect(await send(text("answer", "2"))).toBe(200);
    expect(products().map(mediaOf)).toEqual([ids(ab)]);
    expect(products()[0].description).toContain("Second description");
    expect(db.jobs.get("m1")).toMatchObject({ reason: "confirmed_second", confidence: "confirmed" });
    expect(db.jobs.get("d1")).toMatchObject({ state: "done", reply: expect.stringContaining("No listing was created") });
    expect(replies.at(-1)).toContain("(12 you confirmed)");
  });
  it("answer 1 gives the contested media to the first description and leaves the second waiting for its own", async () => {
    const d1 = text("d1", "First | 1200"), m = album("m", 4), d2 = text("d2", "Second | 900");
    await deliver([d1, ...m, d2]);
    expect(await send(text("answer", "1"))).toBe(200);
    expect(products().map(mediaOf)).toEqual([ids(m)]);
    expect(products()[0].price).toBe(1200);
    expect(statusOf("d2")).toBe("awaiting_media");
    const b = album("b", 2); // sent after the second description: its own
    await deliver(b);
    await settle();
    expect(products().map(mediaOf)).toEqual([ids(m), ids(b)]);
  });
  it("answer 3, or no answer for 10 minutes, sets the contested media aside and mixes nothing", async () => {
    const d1 = text("d1", "First | 1200"), m = album("m", 4), d2 = text("d2", "Second | 900");
    await deliver([d1, ...m, d2]);
    await settle(601_000);
    expect(products()).toHaveLength(0);
    expect(db.unassigned).toEqual([ids(m)]);
    expect(db.jobs.get("m1")).toMatchObject({ reason: "unassigned" });
    expect(replies).toEqual(expect.arrayContaining([expect.stringContaining('saved as the draft "Unassigned WhatsApp media"')]));
    expect(db.jobs.get("d1").state).toBe("done"); // told that nothing was created for it
  });
  it("a pause, then a second description that arrives late: asks whether the last group is its own", async () => {
    const d1 = text("d1", "First | 1200"), a = album("a", 6);
    pause(13);
    const b = album("b", 6);
    pause(25); // more than the 15s a description normally trails its photos by
    const d2 = text("d2", "Second | 900");
    await deliver([d1, ...a, ...b, d2]);
    expect(products()).toHaveLength(0);
    advance(5_000); expect(await sweep()).toBe(200);
    expect(replies.at(-1)).toContain("6 photo(s)/video(s), a pause, 6 more");
    expect(await send(text("answer", "2"))).toBe(200);
    expect(products().map(mediaOf).sort()).toEqual([ids(a), ids(b)].sort());
  });
  it("photos and videos interleaved, arriving in a different order than they were sent", async () => {
    const sent = [message("p1"), message("v1", "", "video"), message("p2"), message("v2", "", "video"), message("p3")];
    const d = text("d", "Silk | 1200");
    // The description overtakes two of its own photos, which then land as stragglers.
    await deliver([sent[3], sent[0], sent[4], d, sent[2], sent[1]]);
    expect(products()).toHaveLength(1);
    // All five end up in the one listing: built into it, or appended if they landed after it was created.
    const listed = [...mediaOf(products()[0]), ...ids(sent).filter((id) => db.jobs.get(id).appended)];
    expect(listed.sort()).toEqual(ids(sent).sort());
    expect(new Set(ids(sent).map((id) => db.jobs.get(id).batch)).size).toBe(1);
    expect(mediaOf(products()[0])).toEqual(ids(sent).filter((id) => mediaOf(products()[0]).includes(id))); // in the order they were sent
    expect(products()[0].variants[0].media.find((x: any) => x.is_primary).kind).toBe("image"); // a photo, never a video
    expect(uploads).toBe(5);
  });
  it("a description sent as a reply to a photo owns that photo's album and nothing else", async () => {
    const a = album("a", 3);
    pause(20);
    const b = album("b", 3);
    pause(5);
    const d = text("d", "Silk | 1200", { context: { id: "a2" } });
    await deliver([...a, ...b, d]);
    expect(products().map(mediaOf)).toEqual([ids(a)]);
    expect(db.jobs.get("a1")).toMatchObject({ reason: "reply_to_media", confidence: "explicit" });
    expect(db.jobs.get("b1").reason).toBe("awaiting_description"); // still waiting for its own description
    expect(db.jobs.get("b1").batch).not.toBe(db.jobs.get("a1").batch);
  });
  it("a caption on one photo owns the album it was sent in, even with a description waiting before it", async () => {
    const d1 = text("d1", "Unrelated | 500");
    const album1 = [message("c1"), message("c2", "Silk | 1200"), message("c3"), message("c4", "", "video")];
    await deliver([d1, ...album1]);
    expect(products()).toHaveLength(1);
    expect(products()[0].price).toBe(1200);
    // The whole album is in the captioned listing (built in, or appended as it arrived); the earlier description got none of it.
    expect(new Set(ids(album1).map((id) => db.jobs.get(id).batch)).size).toBe(1);
    expect([...mediaOf(products()[0]), ...ids(album1).filter((id) => db.jobs.get(id).appended)].sort()).toEqual(["c1", "c2", "c3", "c4"]);
    expect(db.jobs.get("d1")).toMatchObject({ state: "done", reply: expect.stringContaining("No photos or videos arrived") });
  });
  it("same-second timestamps: a description never loses, or steals, photos stamped in its own second", async () => {
    const second = String(nextTimestamp++);
    // Description-first: the photos carry the description's own second.
    await deliver([message("d", "Silk | 1200", "text", second), message("p1", "", "image", second), message("p2")]);
    await settle();
    expect(products().map(mediaOf)).toEqual([["p1", "p2"]]);
    // Photos-first: the last video carries the description's own second.
    pause(60);
    const tie = String(nextTimestamp + 1);
    await deliver([message("q1"), message("q2", "", "video", tie), message("e", "Cotton | 900", "text", tie)]);
    expect(products().map(mediaOf)).toEqual([["p1", "p2"], ["q1", "q2"]]);
  });
  it("a photo that belongs to a description-first listing still joins it when it arrives after the listing was created", async () => {
    const d = text("d", "Silk | 1200"), a = [message("a1"), message("a2"), message("a3")];
    await deliver([d, a[0], a[2]]);
    await settle();
    expect(mediaOf(products()[0])).toEqual(["a1", "a3"]);
    expect(await send(a[1])).toBe(200); // sent between a1 and a3, delivered a minute late
    expect(db.jobs.get("a2")).toMatchObject({ batch: db.jobs.get("a1").batch, appended: true });
    expect(products()).toHaveLength(1);
  });
  it("photos left without a description for 30 minutes are set aside, not merged into the next listing", async () => {
    const old = album("old", 3);
    await deliver(old);
    advance(31 * 60_000); pause(31 * 60);
    const fresh = album("new", 2);
    await deliver([...fresh, text("d", "Silk | 1200")]);
    expect(products().map(mediaOf)).toEqual([ids(fresh)]);
    expect(db.unassigned).toEqual([ids(old)]);
    expect(replies).toEqual(expect.arrayContaining([expect.stringContaining("No description arrived within 30 minutes")]));
  });
});

describe("description-first lifecycle and the scheduler", () => {
  it("acknowledges a description that has no photos yet, once, without creating anything", async () => {
    expect(await send(text("d", "Kanjivaram silk with temple border, rich zari pallu | 4500"))).toBe(200);
    expect(replies).toEqual([]); // held back: its photos may be a moment behind it
    await lingerSender(db as any, phone, Date.now() + 115_000, async (ms) => { advance(ms); });
    expect(replies).toEqual(['Got your description for "Kanjivaram silk with temple border, ric…". Send the photos/videos now.']);
    expect(await send(text("d", "Kanjivaram silk with temple border, rich zari pallu | 4500"))).toBe(200); // duplicate webhook
    advance(10_000); expect(await sweep()).toBe(200);
    expect(replies).toHaveLength(1);
    expect(products()).toHaveLength(0);
  });
  it("does not acknowledge a description whose photos were only a moment behind it", async () => {
    const d = text("d", "Silk | 1200");
    const before = message("p", "", "image", String(Number(d.timestamp) - 1));
    expect(await send(d)).toBe(200); // the description's webhook wins the race
    expect(await send(before)).toBe(200);
    await lingerSender(db as any, phone, Date.now() + 115_000, async (ms) => { advance(ms); });
    expect(replies).toEqual([expect.stringContaining("Created")]);
  });
  it("closes a description-first listing from inside the invocation once its photos go quiet", async () => {
    expect(await send(text("d", "Silk | 1200"))).toBe(200);
    expect(await send(message("p1"), message("p2"))).toBe(200);
    const slept: number[] = [];
    await lingerSender(db as any, phone, Date.now() + 115_000, async (ms) => { slept.push(ms); advance(ms); });
    expect(slept[0]).toBeGreaterThan(44_000); expect(slept[0]).toBeLessThan(46_000);
    expect(products().map(mediaOf)).toEqual([["p1", "p2"]]);
    expect(replies).toEqual([expect.stringContaining("(2 sent after your description)")]);
  });
  it("does not wait inside the invocation for a deadline it cannot reach", async () => {
    expect(await send(text("d", "Silk | 1200"))).toBe(200);
    advance(5_000); expect(await sweep()).toBe(200); // ack sent; the next deadline is the 10-minute timeout
    const sleep = vi.fn(async () => {});
    await lingerSender(db as any, phone, Date.now() + 115_000, sleep);
    expect(sleep).not.toHaveBeenCalled();
  });
  it("times out a description that never gets photos and asks for a resend", async () => {
    expect(await send(text("d", "Silk | 1200"))).toBe(200);
    advance(601_000); expect(await sweep()).toBe(200);
    expect(db.jobs.get("d")).toMatchObject({ state: "done", reply_sent: true });
    expect(replies).toEqual([expect.stringContaining("within 10 minutes, so no listing was created")]);
    // Its photos turning up afterwards wait for a description of their own.
    expect(await send(message("p"))).toBe(200);
    expect(db.jobs.get("p").batch).not.toBe(db.jobs.get("d").batch);
  });
  it("closes an empty description when the next one arrives", async () => {
    expect(await send(text("d1", "Silk | 1200"))).toBe(200);
    pause(30);
    expect(await send(text("d2", "Cotton | 900"))).toBe(200);
    expect(db.jobs.get("d1")).toMatchObject({ state: "done", reply: expect.stringContaining('No photos or videos arrived for "Silk | 1200"') });
    expect(statusOf("d2")).toBe("awaiting_media");
  });
  it("the next message from the sender applies an overdue quiet period when no scheduler ran", async () => {
    expect(await send(text("d", "Silk | 1200"), message("p1"))).toBe(200);
    advance(5 * 60_000); pause(5 * 60);
    expect(await send(message("next"))).toBe(200);
    expect(products().map(mediaOf)).toEqual([["p1"]]);
    expect(db.jobs.get("next").batch).not.toBe(db.jobs.get("p1").batch);
  });
  it("tells the sender when a bare number answers nothing", async () => {
    expect(await send(text("n", "2"))).toBe(200);
    expect(replies).toEqual([expect.stringContaining("no question waiting")]);
    expect(products()).toHaveLength(0);
  });
  it("the sweep endpoint is closed without the cron secret", async () => {
    expect((await SWEEP(new Request("http://localhost/api/whatsapp/sweep"))).status).toBe(401);
    expect((await SWEEP(new Request("http://localhost/api/whatsapp/sweep", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await SWEEP(new Request("http://localhost/api/whatsapp/sweep", { headers: { authorization: "Bearer " } }))).status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("the sweep resumes work a killed invocation left behind, for a sender who sends nothing more", async () => {
    db.failures.set("complete_whatsapp_message", 1);
    expect(await send(message("a"))).toBe(503);
    advance(6_000);
    expect(await sweep()).toBe(200);
    expect(db.jobs.get("a")).toMatchObject({ state: "done", attempts: 2 });
  });
});

describe("the pipeline never goes silent", () => {
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
    expect(replies).toEqual([expect.stringContaining("could not be saved"), expect.stringContaining("No photos or videos could be saved for this description")]);
  });
  it("dead-letters a description that can never be saved and asks for a resend", async () => {
    db.failures.set("complete_whatsapp_message", 5);
    const payload = envelope([message("a", "Silk | 1200")]);
    for (let attempt = 1; attempt <= 5; attempt++) { await POST(request(payload)); advance(60_000); }
    expect(db.jobs.get("a")).toMatchObject({ state: "dead", reply_sent: true });
    expect(replies).toEqual([expect.stringContaining("Please resend the photos/videos and then the description")]);
    expect(products()).toHaveLength(0);
    // The resend forms a fresh, working batch.
    pause(600);
    expect(await send(message("b"), message("c", "Silk | 1200", "text"))).toBe(200);
    expect(mediaOf(products()[0])).toEqual(["b"]);
  });
  it("a reply that cannot be sent never fails the webhook's own processing", async () => {
    const original = global.fetch;
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => { if (String(args[0]).includes("/messages")) throw new Error("network down"); return original(...args); }));
    expect(await send(message("a", "Silk | 1200"))).toBe(503); // retained only so Meta redelivers and the reply is retried
    expect(db.jobs.get("a")).toMatchObject({ state: "done", reply_sent: false });
    vi.stubGlobal("fetch", original);
    advance(6_000); pause(60);
    expect(await send(message("b"))).toBe(200); // the next message flushes the reply that was owed
    expect(replies).toEqual([expect.stringContaining("Created")]);
  });
  it("a question that cannot be delivered is retried, then given up on, and still times out safely", async () => {
    const original = global.fetch;
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => String(args[0]).includes("/messages") ? new Response("failed", { status: 500 }) : original(...args)));
    expect(await send(text("d1", "First"), message("m"), text("d2", "Second"))).toBe(200); // parked: nothing for Meta to redeliver
    for (let i = 0; i < 5; i++) { advance(61_000); expect(await sweep()).toBe(200); }
    expect(db.notices.find((n) => n.kind === "question")).toMatchObject({ attempts: 5, sent: false });
    advance(600_000); expect(await sweep()).toBe(200);
    expect(db.unassigned).toEqual([["m"]]);
    expect(products()).toHaveLength(0);
  });
});
