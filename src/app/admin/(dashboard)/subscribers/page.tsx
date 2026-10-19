import { requireAdmin } from "@/lib/admin-auth";
import { SubscriberTable } from "@/components/admin/SubscriberTable";
import { adminSubscribersQuerySchema } from "@/lib/validation";
import type { WhatsAppSubscriber } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminSubscribersPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const { admin } = await requireAdmin();
  // One page and an exact count from Postgres (T4.7); the export reads the full filtered set.
  const query = adminSubscribersQuerySchema.parse({
    source: first(searchParams.source) ?? "",
    page: first(searchParams.page) ?? 1,
    per: first(searchParams.per) ?? undefined,
  });
  const from = (query.page - 1) * query.per;
  let builder = admin.from("whatsapp_subscribers").select("id, name, phone, source, opted_in_at", { count: "exact" });
  if (query.source) builder = builder.eq("source", query.source);
  const { data, count, error } = await builder.order("opted_in_at", { ascending: false }).range(from, from + query.per - 1);

  return (
    <div>
      <h1 className="mb-6 font-serif text-3xl text-primary">WhatsApp Subscribers</h1>
      {error && (
        <p className="mb-4 rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Could not load subscribers: {error.message}
        </p>
      )}
      <SubscriberTable subscribers={(data ?? []) as WhatsAppSubscriber[]} total={count ?? 0} query={query} />
    </div>
  );
}
