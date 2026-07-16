import { requireAdmin } from "@/lib/admin-auth";
import { ContactForm } from "@/components/admin/ContactForm";

export const dynamic = "force-dynamic";

export default async function NewContactPage() {
  await requireAdmin();

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 font-serif text-3xl text-burgundy">Add Contact</h1>
      <ContactForm initial={{ role: "customer", status_tag: "regular", source: "manual", whatsapp_opt_in: false }} />
    </div>
  );
}
