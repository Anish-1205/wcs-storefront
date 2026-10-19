"use server";

import { assertAdmin } from "@/lib/admin-auth";
import { toResult, type ActionResult } from "@/app/admin/actions";
import { auditAdminAction } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { adminSubscribersQuerySchema, type AdminSubscribersQueryShape } from "@/lib/validation";

const EXPORT_LIMIT = 10_000;

/** Every subscriber matching the filter (not just this page), as formula-safe CSV; audited by row count. */
export async function exportSubscribersCsv(query: Partial<AdminSubscribersQueryShape> = {}): Promise<ActionResult<{ csv: string }>> {
  return toResult(async () => {
    const { admin, user } = await assertAdmin();
    const parsed = adminSubscribersQuerySchema.parse(query);
    let builder = admin.from("whatsapp_subscribers").select("opted_in_at, name, phone, source");
    if (parsed.source) builder = builder.eq("source", parsed.source);
    const { data, error } = await builder.order("opted_in_at", { ascending: false }).range(0, EXPORT_LIMIT - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    await auditAdminAction(user, "subscriber.export", { entity: "subscriber", meta: { rows: rows.length } });
    return { csv: toCsv(["opted_in_at", "name", "phone", "source"], rows.map((r) => [r.opted_in_at, r.name, r.phone, r.source])) };
  });
}
