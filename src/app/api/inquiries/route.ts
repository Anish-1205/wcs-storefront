import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/server";
import { inquirySchema } from "@/lib/validation";
import { SITE } from "@/lib/site";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { reportError } from "@/lib/report-error";

export const runtime = "nodejs";

/**
 * POST /api/inquiries
 * Validate → honeypot check → DB insert (public RLS) → Resend email to admin.
 */
export async function POST(req: Request) {
  // Fails open: with the limiter unavailable this still validates, still
  // checks the honeypot, and still records the lead. Losing an enquiry is a
  // worse outcome than accepting spam for the length of an outage.
  const limited = rateLimitResponse(await checkRateLimit(req, { failure: "open" }));
  if (limited) return limited;

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

  // Write server-side so anonymous clients cannot bypass validation/rate limits.
  const supabase = createAdminClient();
  const { error: dbError, duplicate } = await saveInquiry(supabase, data);

  if (dbError) {
    // A lost enquiry is a lost lead — this is the highest-value failure on the
    // site, so it must page rather than sit in a log line.
    reportError(dbError, { scope: "inquiry-insert", inquiry_type: data.inquiry_type, source: data.source });
    return NextResponse.json({ error: "Could not save inquiry" }, { status: 500 });
  }

  // A retry of an enquiry already saved: same answer, no second e-mail.
  if (duplicate) return NextResponse.json({ ok: true });

  // The inquiry is saved even if its optional notification fails.
  await sendNotification(data).catch((e) =>
    reportError(e, { scope: "inquiry-notification" }),
  );

  return NextResponse.json({ ok: true });
}

type InquiryData = ReturnType<typeof inquirySchema.parse>;

/**
 * Insert once per client_request_id (T4.9). A database from before migration
 * 037 has no such column: then the enquiry is saved without it rather than
 * lost, whatever order the code and the migration are deployed in.
 */
async function saveInquiry(
  supabase: ReturnType<typeof createAdminClient>,
  data: InquiryData,
): Promise<{ error: { message: string; code?: string } | null; duplicate: boolean }> {
  const row = {
    name: data.name,
    phone: data.phone,
    email: data.email || null,
    message: data.message || null,
    inquiry_type: data.inquiry_type,
    product_id: data.product_id ?? null,
    variant_id: data.variant_id ?? null,
    product_name: data.product_name ?? null,
    source: data.source,
  };
  if (!data.client_request_id) {
    const { error } = await supabase.from("inquiries").insert(row);
    return { error, duplicate: false };
  }
  const { data: inserted, error } = await supabase
    .from("inquiries")
    .upsert({ ...row, client_request_id: data.client_request_id }, { onConflict: "client_request_id", ignoreDuplicates: true })
    .select("id");
  if (error && (error.code === "PGRST204" || error.code === "42P10" || /client_request_id/.test(error.message))) {
    const { error: plainError } = await supabase.from("inquiries").insert(row);
    return { error: plainError, duplicate: false };
  }
  return { error, duplicate: !error && (inserted ?? []).length === 0 };
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

  const { error } = await resend.emails.send({
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
  if (error) throw new Error(`Resend notification failed: ${error.message}`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
