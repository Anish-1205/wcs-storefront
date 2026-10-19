import { requireAdmin } from "@/lib/admin-auth";
import { InquiryTable } from "@/components/admin/InquiryTable";
import { adminInquiriesQuerySchema } from "@/lib/validation";
import { INQUIRY_COLUMNS_PRE_037, inquiryQueryBuilder } from "@/lib/inquiry-queries";
import type { Inquiry } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminInquiriesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const { admin } = await requireAdmin();

  // Filters and paging live in the URL and run in Postgres (T4.7): one page of
  // rows and an exact count, never the whole table.
  const query = adminInquiriesQuerySchema.parse({
    type: first(searchParams.type) ?? "",
    source: first(searchParams.source) ?? "",
    status: first(searchParams.status) ?? "",
    due: first(searchParams.due) ?? "",
    page: first(searchParams.page) ?? 1,
    per: first(searchParams.per) ?? undefined,
  });
  const from = (query.page - 1) * query.per;

  let workflow = true;
  let result = await inquiryQueryBuilder(admin, query)
    .order("created_at", { ascending: false })
    .range(from, from + query.per - 1);
  if (result.error && /status|admin_notes|follow_up_on/.test(result.error.message)) {
    // Migration 037 not applied yet: the list still works, without the workflow.
    workflow = false;
    result = await inquiryQueryBuilder(admin, query, { columns: INQUIRY_COLUMNS_PRE_037 })
      .order("created_at", { ascending: false })
      .range(from, from + query.per - 1);
  }

  return (
    <div>
      <h1 className="mb-6 font-serif text-3xl text-primary">Inquiries</h1>
      {!workflow && (
        <p className="mb-4 rounded-sm border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Statuses, notes and follow-ups appear once database migration 037 is applied.
        </p>
      )}
      {result.error && (
        <p className="mb-4 rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Could not load enquiries: {result.error.message}
        </p>
      )}
      <InquiryTable
        inquiries={(result.data ?? []) as unknown as Inquiry[]}
        total={result.count ?? 0}
        query={query}
        workflow={workflow}
      />
    </div>
  );
}
