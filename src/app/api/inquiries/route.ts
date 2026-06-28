import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { inquirySchema } from "@/lib/validation";
import { SITE } from "@/lib/site";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/inquiries
 * Validate → honeypot check → DB insert (public RLS) → Resend email to admin.
 */
export async function POST(req: Request) {
  const rateLimit = await checkRateLimit(req);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = inquirySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // Honeypot: a filled "website" field means a bot. Pretend success, store nothing.
  if (data.website) {
    return NextResponse.json({ ok: true });
  }

  // Insert into DB (RLS permits public INSERT).
  const supabase = createClient();
  const { error: dbError } = await supabase.from("inquiries").insert({
    name: data.name,
    phone: data.phone,
    email: data.email || null,
    message: data.message || null,
    inquiry_type: data.inquiry_type,
    product_id: data.product_id ?? null,
    variant_id: data.variant_id ?? null,
    product_name: data.product_name ?? null,
    source: data.source,
  });

  if (dbError) {
    console.error("inquiry insert failed:", dbError.message);
    return NextResponse.json({ error: "Could not save inquiry" }, { status: 500 });
  }

  // Fire-and-forget admin email notification (non-blocking on failure).
  await sendNotification(data).catch((e) =>
    console.error("Resend notification failed:", e),
  );

  return NextResponse.json({ ok: true });
}

async function sendNotification(data: {
  name: string;
  phone: string;
  email?: string;
  message?: string;
  inquiry_type: string;
  product_name?: string | null;
  source: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.INQUIRY_NOTIFICATION_EMAIL;
  if (!apiKey || !to) return; // notifications optional in dev

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  await resend.emails.send({
    from: `${SITE.name} <${from}>`,
    to,
    subject: `New ${data.inquiry_type} enquiry from ${data.name}`,
    html: `
      <h2>New ${data.inquiry_type} enquiry</h2>
      <p><strong>Name:</strong> ${escapeHtml(data.name)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(data.phone)}</p>
      ${data.email ? `<p><strong>Email:</strong> ${escapeHtml(data.email)}</p>` : ""}
      ${data.product_name ? `<p><strong>Product:</strong> ${escapeHtml(data.product_name)}</p>` : ""}
      <p><strong>Source:</strong> ${escapeHtml(data.source)}</p>
      ${data.message ? `<p><strong>Message:</strong><br/>${escapeHtml(data.message)}</p>` : ""}
    `,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
