import { requireAdmin } from "@/lib/admin-auth";
import { SubscriberTable } from "@/components/admin/SubscriberTable";
import type { WhatsAppSubscriber } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function AdminSubscribersPage() {
  const { admin } = await requireAdmin();

  const { data } = await admin
    .from("whatsapp_subscribers")
    .select("*")
    .order("opted_in_at", { ascending: false });

  return (
    <div>
      <h1 className="mb-6 font-serif text-3xl text-burgundy">
        WhatsApp Subscribers
      </h1>
      <SubscriberTable subscribers={(data ?? []) as WhatsAppSubscriber[]} />
    </div>
  );
}
