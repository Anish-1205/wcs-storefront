import type { createAdminClient } from "@/lib/supabase/server";
import type { AdminInquiriesQueryShape } from "@/lib/validation";

/** Columns the admin list and export read (no `select *`, T4.7 / T6.11). */
export const INQUIRY_COLUMNS =
  "id, created_at, name, phone, email, inquiry_type, source, product_name, message, status, status_changed_at, admin_notes, follow_up_on";
/** What a database without migration 037 still has. */
export const INQUIRY_COLUMNS_PRE_037 = "id, created_at, name, phone, email, inquiry_type, source, product_name, message";

/** Today in India, as YYYY-MM-DD: "due" means a follow-up on or before this date. */
export function todayInIndia(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** The filtered inquiries query shared by the list page and the CSV export. */
export function inquiryQueryBuilder(
  admin: ReturnType<typeof createAdminClient>,
  query: AdminInquiriesQueryShape,
  { count = true, columns = INQUIRY_COLUMNS }: { count?: boolean; columns?: string } = {},
) {
  let builder = admin.from("inquiries").select(columns, count ? { count: "exact" } : undefined);
  if (query.type) builder = builder.eq("inquiry_type", query.type);
  if (query.source) builder = builder.eq("source", query.source);
  if (columns === INQUIRY_COLUMNS) {
    if (query.status) builder = builder.eq("status", query.status);
    if (query.due) builder = builder.lte("follow_up_on", todayInIndia()).in("status", ["new", "contacted"]);
  }
  return builder;
}
