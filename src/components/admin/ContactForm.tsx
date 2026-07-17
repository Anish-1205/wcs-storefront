"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { saveContact } from "@/app/admin/actions";
import type { Contact } from "@/lib/supabase/types";
import {
  formatContactDateTimeValueForInput,
  formatContactDateValueForInput,
  parseContactDateTimeValue,
  parseContactDateValue,
  type ContactInputShape,
} from "@/lib/validation";

export type ContactFormInitial = Partial<ContactInputShape>;

interface Props {
  initial?: ContactFormInitial;
}

const roleOptions: ContactInputShape["role"][] = ["customer", "reseller", "supplier", "weaver", "other"];
const statusOptions: ContactInputShape["status_tag"][] = [
  "regular",
  "priority",
  "good_payer",
  "delayed_payer",
  "quality_consistent",
  "quality_inconsistent",
  "blocked",
];
const sourceOptions: ContactInputShape["source"][] = ["manual", "import", "inquiry", "subscriber"];

export function ContactForm({ initial }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [role, setRole] = useState<ContactInputShape["role"]>(initial?.role ?? "customer");
  const [statusTag, setStatusTag] = useState<ContactInputShape["status_tag"]>(initial?.status_tag ?? "regular");
  const [city, setCity] = useState(initial?.city ?? "");
  const [source, setSource] = useState<ContactInputShape["source"]>(initial?.source ?? "manual");
  const [whatsappOptIn, setWhatsappOptIn] = useState(initial?.whatsapp_opt_in ?? false);
  const [rating, setRating] = useState<string>(initial?.rating != null ? String(initial.rating) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lastContactedAt, setLastContactedAt] = useState(formatContactDateTimeValueForInput(initial?.last_contacted_at));
  const [nextFollowUpOn, setNextFollowUpOn] = useState(formatContactDateValueForInput(initial?.next_follow_up_on));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Name is required.");
    if (!phone.trim()) return setError("Phone is required.");

    setSaving(true);
    try {
      await saveContact({
        id: initial?.id,
        name: name.trim(),
        phone: phone.trim(),
        role,
        status_tag: statusTag,
        city: city.trim() || null,
        source,
        whatsapp_opt_in: whatsappOptIn,
        rating: rating ? Number(rating) : null,
        notes: notes.trim() || null,
        last_contacted_at: parseContactDateTimeValue(lastContactedAt),
        next_follow_up_on: parseContactDateValue(nextFollowUpOn),
      });
      router.push("/admin/contacts");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save contact.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section className="rounded-sm border border-border bg-white p-6">
        <h2 className="mb-4 font-serif text-lg text-burgundy">Contact details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone *</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <Select id="role" value={role} onChange={(e) => setRole(e.target.value as ContactInputShape["role"])}>
              {roleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">Status tag</Label>
            <Select id="status" value={statusTag} onChange={(e) => setStatusTag(e.target.value as ContactInputShape["status_tag"])}>
              {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source">Source</Label>
            <Select id="source" value={source} onChange={(e) => setSource(e.target.value as ContactInputShape["source"])}>
              {sourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rating">Rating</Label>
            <Input id="rating" type="number" min="1" max="5" value={rating} onChange={(e) => setRating(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[140px]" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="last_contacted_at">Last contacted at</Label>
            <Input id="last_contacted_at" type="datetime-local" value={lastContactedAt} onChange={(e) => setLastContactedAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="next_follow_up_on">Next follow-up on</Label>
            <Input id="next_follow_up_on" type="date" value={nextFollowUpOn} onChange={(e) => setNextFollowUpOn(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={whatsappOptIn}
              onChange={(e) => setWhatsappOptIn(e.target.checked)}
              className="h-4 w-4 accent-[#B8860B]"
            />
            WhatsApp opt-in
          </label>
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save contact"}</Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/admin/contacts")}>Cancel</Button>
      </div>
    </form>
  );
}
