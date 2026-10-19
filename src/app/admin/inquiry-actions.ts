"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { toResult, type ActionResult } from "@/app/admin/actions";
import { auditAdminAction } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { inquiryQueryBuilder } from "@/lib/inquiry-queries";
import {
  adminInquiriesQuerySchema,
  inquiryNotesSchema,
  inquiryStatusUpdateSchema,
  type AdminInquiriesQueryShape,
  type InquiryStatus,
} from "@/lib/validation";

/** Move an enquiry through new → contacted → won/lost; history is written in the same step (T4.4). */
export async function updateInquiryStatus(id: string, status: InquiryStatus): Promise<ActionResult> {
  return toResult(async () => {
    const { admin, user } = await assertAdmin();
    const input = inquiryStatusUpdateSchema.parse({ id, status });
    const { data: previous, error } = await admin.rpc("inquiry_set_status", {
      p_id: input.id,
      p_status: input.status,
      p_actor: user.id,
    });
    if (error) throw new Error(error.message);
    if (previous === null) throw new Error("That enquiry no longer exists.");
    await auditAdminAction(user, "inquiry.status", { entity: "inquiry", entityId: input.id, meta: { from: previous as string, to: input.status } });
    revalidatePath("/admin/inquiries");
    revalidatePath("/admin");
    return {};
  });
}

/** Admin notes and a follow-up date. The audit row records which fields changed, never the note text. */
export async function saveInquiryNotes(input: { id: string; admin_notes: string | null; follow_up_on: string | null }): Promise<ActionResult> {
  return toResult(async () => {
    const { admin, user } = await assertAdmin();
    const parsed = inquiryNotesSchema.parse(input);
    const { error } = await admin
      .from("inquiries")
      .update({ admin_notes: parsed.admin_notes, follow_up_on: parsed.follow_up_on })
      .eq("id", parsed.id);
    if (error) throw new Error(error.message);
    await auditAdminAction(user, "inquiry.notes", {
      entity: "inquiry",
      entityId: parsed.id,
      meta: { fields: ["admin_notes", "follow_up_on"], has_follow_up: parsed.follow_up_on !== null },
    });
    revalidatePath("/admin/inquiries");
    revalidatePath("/admin");
    return {};
  });
}

const EXPORT_LIMIT = 5000;

/** Every enquiry matching the current filters (not just this page), as CSV. */
export async function exportInquiriesCsv(query: Partial<AdminInquiriesQueryShape> = {}): Promise<ActionResult<{ csv: string; truncated: boolean }>> {
  return toResult(async () => {
    const { admin, user } = await assertAdmin();
    const parsed = adminInquiriesQuerySchema.parse(query);
    const { data, error } = await inquiryQueryBuilder(admin, parsed, { count: false })
      .order("created_at", { ascending: false })
      .range(0, EXPORT_LIMIT - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    await auditAdminAction(user, "inquiry.export", { entity: "inquiry", meta: { rows: rows.length } });
    const header = ["created_at", "name", "phone", "email", "inquiry_type", "source", "status", "product_name", "message", "admin_notes", "follow_up_on"];
    return { csv: toCsv(header, rows.map((row) => header.map((key) => row[key]))), truncated: rows.length === EXPORT_LIMIT };
  });
}
