"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  EMPTY_PROFILE,
  useProfile,
  type Profile,
} from "@/lib/profile/useProfile";

const SHOPPING_FOR = ["", "Individual", "Bridal", "Boutique", "Wholesale"] as const;

const FIELDS: {
  key: keyof Profile;
  label: string;
  type?: string;
  autoComplete?: string;
}[] = [
  { key: "full_name", label: "Full name", autoComplete: "name" },
  { key: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
  { key: "whatsapp", label: "WhatsApp number", type: "tel", autoComplete: "tel" },
  { key: "email", label: "Email", type: "email", autoComplete: "email" },
  { key: "city", label: "City", autoComplete: "address-level2" },
  { key: "state", label: "State", autoComplete: "address-level1" },
  { key: "country", label: "Country", autoComplete: "country-name" },
];

export function ProfileDetailsForm() {
  const { profile, loading, save } = useProfile();
  const [form, setForm] = useState<Profile>({ ...EMPTY_PROFILE });
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const seeded = useRef(false);

  // Seed the form once, when the saved profile first arrives.
  useEffect(() => {
    if (!seeded.current && profile) {
      setForm(profile);
      seeded.current = true;
    }
  }, [profile]);

  function set(key: keyof Profile, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setStatus("idle");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg(null);
    const trimmed = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v.trim()]),
    ) as Profile;
    const { error } = await save(trimmed);
    if (error) {
      setStatus("error");
      setErrorMsg(error);
      return;
    }
    setForm(trimmed);
    setStatus("saved");
  }

  if (loading) {
    return <div className="mt-12 min-h-[12rem]" aria-hidden="true" />;
  }

  return (
    <form onSubmit={handleSubmit} className="mt-12">
      <h2 className="eyebrow">Your details</h2>
      <p className="mt-2 text-xs text-muted-foreground">
        Saved to your account and used to pre-fill the enquiry form, so you
        don’t retype them each time. Optional — fill in only what you want
        remembered.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {FIELDS.map(({ key, label, type, autoComplete }) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`profile-${key}`}>{label}</Label>
            <Input
              id={`profile-${key}`}
              type={type ?? "text"}
              autoComplete={autoComplete}
              value={form[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </div>
        ))}
        <div className="space-y-1.5">
          <Label htmlFor="profile-shopping_for">Usually shopping for</Label>
          <Select
            id="profile-shopping_for"
            value={form.shopping_for}
            onChange={(e) => set("shopping_for", e.target.value)}
          >
            {SHOPPING_FOR.map((s) => (
              <option key={s || "none"} value={s}>
                {s || "—"}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <button
          type="submit"
          disabled={status === "saving"}
          className="flex h-11 items-center justify-center gap-2 bg-oxblood px-8 text-[0.78rem] font-medium uppercase tracking-[0.22em] text-primary-foreground hover:bg-oxblood-soft disabled:opacity-60"
        >
          {status === "saving" ? "Saving…" : "Save details"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-antique-gold" role="status">
            Saved.
          </span>
        )}
        {status === "error" && (
          <span className="text-sm text-destructive" role="alert">
            {errorMsg ?? "Could not save — try again."}
          </span>
        )}
      </div>
    </form>
  );
}
