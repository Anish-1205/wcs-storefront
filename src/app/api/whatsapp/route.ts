import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  isAllowedWhatsAppAdmin,
  MAX_WEBHOOK_BYTES,
  verifyWhatsAppSignature,
} from "@/lib/webhook-security";
import { reportError } from "@/lib/report-error";
import {
  deliverReplies,
  drainSender,
  DRAIN_BUDGET_MS,
  DRAIN_POLL_MS,
  getWhatsAppVerifyToken,
  isSettled,
  lingerSender,
  MAX_DRAIN_POLLS,
  rpc,
  type InboxMessage,
  type MediaKind,
} from "@/lib/whatsapp-pipeline";
import { logger, requestIdFrom } from "@/lib/logger";

export const runtime = "nodejs";
// Explicit so the limit is a decision, not a plan default. Meta is answered
// within DRAIN_BUDGET_MS; the rest is for lingerSender, which fires the 45s
// quiet-period close of a description-first listing (migration 029) from
// inside this invocation. No message is started in the last 25s, so the
// 2-minute inbox lease (migration 028) still outlives any claim made here.
export const maxDuration = 120;
const LINGER_MS = 115_000;

type WhatsAppProfile = {
  name?: string;
};

type WhatsAppContact = {
  profile?: WhatsAppProfile;
  wa_id?: string;
};

type WhatsAppMedia = {
  id?: string;
  mime_type?: string;
  caption?: string;
  sha256?: string;
};

type WhatsAppText = {
  body?: string;
};

type WhatsAppMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  image?: WhatsAppMedia;
  video?: WhatsAppMedia;
  text?: WhatsAppText;
};

type WhatsAppChangeValue = {
  metadata?: {
    phone_number_id?: string;
    display_phone_number?: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: unknown[];
};

type WhatsAppChange = {
  value?: WhatsAppChangeValue;
};

type WhatsAppEntry = {
  changes?: WhatsAppChange[];
};

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: WhatsAppEntry[];
};

function messageMediaKind(message: WhatsAppMessage): MediaKind | null {
  if (message.image?.id) return "image";
  if (message.video?.id) return "video";
  return null;
}

function messageMediaId(message: WhatsAppMessage): string | undefined {
  return (message.image?.id ?? message.video?.id)?.trim();
}

function normalizeCaption(message: WhatsAppMessage): string {
  return (message.image?.caption ?? message.video?.caption ?? message.text?.body ?? "").trim();
}

function parseMessageTimestamp(timestamp?: string): string {
  if (!timestamp) return new Date().toISOString();
  const numeric = Number(timestamp);
  if (Number.isNaN(numeric)) return new Date().toISOString();
  return new Date(numeric * 1000).toISOString();
}

/** What we tell an admin who sends something a listing cannot be made from. Stickers and reactions get no reply. */
const UNSUPPORTED_REPLIES: Record<string, string> = {
  audio: "I can't listen to voice notes or audio yet, so that one wasn't used. Please type the description as a text message.",
  document: "I can't open documents or files. If it was a photo or video, please send it as a normal photo/video, not as a file.",
  contacts: "I can't use contact cards, so that one was ignored. To add a listing, send the photos/videos and a description.",
  location: "I can't use locations, so that one was ignored. To add a listing, send the photos/videos and a description.",
};
type UnsupportedNotice = { sender: string; key: string; body: string };

function extractMessages(payload: WhatsAppWebhookPayload): { messages: InboxMessage[]; unsupported: UnsupportedNotice[] } {
  const messages: InboxMessage[] = [];
  const unsupported: UnsupportedNotice[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        const sender = message.from?.trim();
        if (!sender || !isAllowedWhatsAppAdmin(sender)) continue;
        const kind = messageMediaKind(message);
        const caption = normalizeCaption(message);
        if (!kind && !caption) {
          // Never queued, so it can never hold up a listing. One friendly reply per type per minute,
          // keyed by the message's own time so a redelivery does not repeat it.
          const body = UNSUPPORTED_REPLIES[message.type ?? ""];
          const minute = Math.floor(Number(message.timestamp ?? 0) / 60);
          if (body) unsupported.push({ sender, body, key: `unsupported:${sender}:${message.type}:${minute}` });
          continue;
        }
        if (!message.id) throw new Error("Handled WhatsApp message is missing its ID");
        messages.push({
          message_id: message.id, sender_phone: sender,
          contact_name: change.value?.contacts?.find((c) => c.wa_id === sender)?.profile?.name ?? null,
          message_timestamp: parseMessageTimestamp(message.timestamp), caption,
          media_id: messageMediaId(message) ?? null, kind,
          mode: kind && /^\d+$/.test(caption) ? "numbered" : caption ? "finalize" : "media",
          public_id: `whatsapp/inbox/${createHash("sha256").update(message.id).digest("hex")}`,
          raw_message: message,
        });
      }
    }
  }
  return { messages, unsupported };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === getWhatsAppVerifyToken()) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return NextResponse.json({ error: "Webhook verification failed" }, { status: 403 });
}

export async function POST(req: Request) {
  let payload: WhatsAppWebhookPayload;

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Could not read payload" }, { status: 400 });
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  if (!verifyWhatsAppSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    logger.warn("whatsapp", "whatsapp webhook: rejected invalid signature", { requestId: requestIdFrom(req) });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch (error) {
    // Past the signature check, so this is Meta sending something unexpected
    // rather than a spoof — worth surfacing, not just dropping.
    reportError(error, { scope: "whatsapp-invalid-json" });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.object !== "whatsapp_business_account") return NextResponse.json({ ok: true });
  try {
    const { messages, unsupported } = extractMessages(payload);
    if (!messages.length && !unsupported.length) return NextResponse.json({ ok: true });
    const supabase = createAdminClient();
    // Best effort and never a reason to fail the webhook: the notice is durable once written, and is
    // delivered with the same lease, retries and 24-hour window as every other reply.
    for (const notice of unsupported) {
      await rpc(supabase, "whatsapp_notify", { p_sender: notice.sender, p_kind: "unsupported", p_key: notice.key, p_body: notice.body })
        .catch((error) => reportError(error, { scope: "whatsapp-unsupported" }));
    }
    if (!messages.length) {
      for (const sender of new Set(unsupported.map((notice) => notice.sender))) await deliverReplies(supabase, sender);
      return NextResponse.json({ ok: true });
    }
    await rpc(supabase, "enqueue_whatsapp_messages", { p_messages: messages });
    // The messages are durable from here on. Everything below is best-effort
    // progress: a 503 only asks Meta to redeliver as a backup driver.
    const startedAt = Date.now();
    const deadline = startedAt + DRAIN_BUDGET_MS;
    const messageIds = messages.map((message) => message.message_id);
    const senders = [...new Set(messages.map((message) => message.sender_phone))];
    // The enqueue contains a grouping failure rather than lose a message.
    // Regroup once more in the open so such a failure is reported, not silent.
    for (const sender of senders) {
      await rpc(supabase, "whatsapp_sweep", { p_sender_phone: sender }).catch((error) => reportError(error, { scope: "whatsapp-regroup" }));
    }
    let settled = false;
    for (let polls = 0; ; polls++) {
      let inFlight = false;
      for (const sender of senders) {
        inFlight = (await drainSender(supabase, sender, deadline)) || inFlight;
        await deliverReplies(supabase, sender);
      }
      settled = await isSettled(supabase, messageIds);
      // Only wait when another invocation is mid-message for this sender (a
      // finalize text arriving while its photos are still uploading); a queue
      // parked on a retry backoff is left to the next delivery.
      if (settled || !inFlight || polls >= MAX_DRAIN_POLLS || Date.now() + DRAIN_POLL_MS >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
    }
    // Outside a request scope (unit tests) there is nothing to keep alive.
    try {
      after(async () => { for (const sender of senders) await lingerSender(supabase, sender, startedAt + LINGER_MS); });
    } catch { /* no request scope */ }
    return NextResponse.json(settled ? { ok: true } : { error: "Messages retained for retry" }, { status: settled ? 200 : 503 });
  } catch (error) {
    reportError(error, { scope: "whatsapp-receipt" });
    return NextResponse.json({ error: "Could not accept messages" }, { status: 503 });
  }
}
