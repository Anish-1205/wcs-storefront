"use client";

import { useState } from "react";
import { getSource } from "@/lib/source-tracking";
import { subscriberSchema } from "@/lib/validation";
import { analytics } from "@/lib/analytics";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  source?: string; // placement label, e.g. "footer" | "home" | "collection"
  compact?: boolean;
}

/**
 * Captures name + phone and inserts directly into whatsapp_subscribers via the
 * Supabase browser client (RLS permits public INSERT). No API route needed.
 */
export function WhatsAppSubscribeForm({ source = "unknown", compact }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const leadSource = getSource();
    const parsed = subscriberSchema.safeParse({ name, phone, source: leadSource });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Please check your details.");
      return;
    }

    setStatus("loading");

    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: parsed.data.phone, name: parsed.data.name, source: parsed.data.source }),
    });

    if (!res.ok) {
      setStatus("error");
      setError("Something went wrong. Please try again.");
      return;
    }

    analytics.subscriberOptIn({ source: leadSource });
    setStatus("done");
    setName("");
    setPhone("");
  }

  if (status === "done") {
    return (
      <p className="rounded-sm bg-gold/10 px-4 py-3 text-sm text-gold-dark">
        🎉 You&apos;re on the list! We&apos;ll message you on WhatsApp with new arrivals.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Your name"
        required
        className={compact ? "h-10" : ""}
      />
      <Input
        type="tel"
        placeholder="WhatsApp number"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        aria-label="WhatsApp number"
        required
        className={compact ? "h-10" : ""}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        type="submit"
        variant="gold"
        disabled={status === "loading"}
        className="w-full"
        size={compact ? "sm" : "default"}
      >
        {status === "loading" ? "Subscribing…" : "Notify me on WhatsApp"}
      </Button>
    </form>
  );
}
