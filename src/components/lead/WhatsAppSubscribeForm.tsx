"use client";

import { ContentRegion } from "@/components/content/ContentRegion";

import { useState } from "react";
import { getSource } from "@/lib/source-tracking";
import { subscriberSchema } from "@/lib/validation";
import { analytics } from "@/lib/analytics";
import { describeSubmitFailure } from "@/lib/submit-errors";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { AnimatePresence, m } from "motion/react";
import { BellRing } from "lucide-react";
import { Motion } from "@/components/ui/motion";

interface Props {
  source?: string; // placement label, e.g. "footer" | "home" | "collection"
  compact?: boolean;
}

/**
 * Captures name + phone and posts to /api/subscribe, which validates, applies
 * the rate limit and writes server-side. The browser has no direct write path
 * to whatsapp_subscribers — that table is service-role only under RLS.
 */
export function WhatsAppSubscribeForm({ source = "unknown", compact }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Read before the first await — currentTarget is nulled once React
    // returns from the synchronous part of the handler.
    const honeypot = String(new FormData(e.currentTarget).get("website") ?? "");

    const leadSource = getSource();
    const parsed = subscriberSchema.safeParse({ name, phone, source: leadSource });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check your details.");
      return;
    }

    setStatus("loading");

    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: parsed.data.phone,
        name: parsed.data.name,
        source: parsed.data.source,
        website: honeypot,
      }),
    });

    if (!res.ok) {
      setStatus("error");
      setError(describeSubmitFailure(res)?.message ?? "Something went wrong. Please try again.");
      return;
    }

    analytics.subscriberOptIn({ source: leadSource });
    setStatus("done");
    setName("");
    setPhone("");
  }

  if (status === "done") {
    return (
      <p className="rounded-sm bg-gold/10 px-4 py-3 text-base text-gold-dark">
        🎉 You&apos;re on the list! We&apos;ll message you on WhatsApp with new arrivals.
      </p>
    );
  }

  // The compact (footer) placement starts as one button that opens into the form.
  return (
    <ContentRegion region="WhatsAppSubscribeForm" global><Motion><AnimatePresence mode="wait" initial={false}>
    {!open ? (
      <m.div key="cta" exit={{ opacity: 0, scale: 0.96, filter: "blur(4px)" }} transition={{ duration: 0.15 }}>
        <Button type="button" variant="gold" className="w-full" size="sm" onClick={() => setOpen(true)} aria-expanded={false}>
          <BellRing className="h-4 w-4" aria-hidden="true" />
          Notify me on WhatsApp
        </Button>
      </m.div>
    ) : (
    <m.form
      key="form"
      onSubmit={handleSubmit}
      className="space-y-2 overflow-hidden"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ type: "spring", stiffness: 240, damping: 24 }}
    >
      {/* Honeypot — hidden from humans, tempting to bots */}
      <input
        type="text"
        name="website"
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <Input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Your name"
        autoFocus={compact}
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
      {error && <p className="text-base text-destructive">{error}</p>}
      <label className="flex items-start gap-2 text-base leading-relaxed text-muted-foreground">
        <input type="checkbox" required className="mt-0.5 h-4 w-4 shrink-0 accent-[#B8860B]" />
        <span>
          I agree to receive new-arrival and offer messages on WhatsApp. I can
          opt out at any time. See our{" "}
          <Link href="/privacy" className="underline hover:text-burgundy">
            privacy policy
          </Link>.
        </span>
      </label>
      <Button
        type="submit"
        variant="gold"
        disabled={status === "loading"}
        className="w-full"
        size={compact ? "sm" : "default"}
      >
        {status === "loading" ? "Subscribing…" : "Notify me on WhatsApp"}
      </Button>
    </m.form>
    )}
    </AnimatePresence></Motion></ContentRegion>
  );
}
