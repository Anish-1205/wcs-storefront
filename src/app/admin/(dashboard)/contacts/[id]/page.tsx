import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { ContactForm, type ContactFormInitial } from "@/components/admin/ContactForm";
import type { Contact } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function EditContactPage({ params }: { params: { id: string } }) {
  const { admin } = await requireAdmin();
  const { data: contact } = await admin.from("contacts").select("*").eq("id", params.id).maybeSingle();
  if (!contact) notFound();

  const initial: ContactFormInitial = {
    ...(contact as Contact),
  };

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 font-serif text-3xl text-burgundy">Edit Contact</h1>
      <ContactForm initial={initial} />
    </div>
  );
}
