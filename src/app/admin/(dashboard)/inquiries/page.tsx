import { requireAdmin } from "@/lib/admin-auth";
import { InquiryTable } from "@/components/admin/InquiryTable";
import type { Inquiry } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function AdminInquiriesPage() {
  const { admin } = await requireAdmin();

  const { data } = await admin
    .from("inquiries")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="mb-6 font-serif text-3xl text-burgundy">Inquiries</h1>
      <InquiryTable inquiries={(data ?? []) as Inquiry[]} />
    </div>
  );
}
