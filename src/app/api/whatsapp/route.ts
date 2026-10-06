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

function extractMessages(payload: WhatsAppWebhookPayload): InboxMessage[] {
  const messages: InboxMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        const sender = message.from?.trim();
        if (!sender || !isAllowedWhatsAppAdmin(sender)) continue;
        const kind = messageMediaKind(message);
        const caption = normalizeCaption(message);
        if (!kind && !caption) continue;
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
  return messages;
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
    console.warn("whatsapp webhook: rejected invalid signature");
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
    const messages = extractMessages(payload);
    if (!messages.length) return NextResponse.json({ ok: true });
    const supabase = createAdminClient();
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
