"use client";

import { useState } from "react";
import { getSource } from "@/lib/source-tracking";
import { analytics } from "@/lib/analytics";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { InquiryType } from "@/lib/supabase/types";

interface Props {
  defaultType?: InquiryType;
  lockType?: boolean;
  productId?: string | null;
  variantId?: string | null;
  productName?: string | null;
  heading?: string;
}

/**
 * Shared inquiry form. Posts to /api/inquiries which validates, stores, and
 * emails the admin. Includes a hidden honeypot field for spam protection.
 */
export function InquiryForm({
  defaultType = "general",
  lockType = false,
  productId = null,
  variantId = null,
  productName = null,
  heading,
}: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setStatus("loading");

    const form = e.currentTarget;
    const fd = new FormData(form);
    const source = getSource();

    const payload = {
      name: String(fd.get("name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      email: String(fd.get("email") ?? ""),
      message: String(fd.get("message") ?? ""),
      inquiry_type: String(fd.get("inquiry_type") ?? defaultType),
      website: String(fd.get("website") ?? ""), // honeypot
      product_id: productId,
      variant_id: variantId,
      product_name: productName,
      source,
    };

    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("request failed");
      analytics.inquirySubmit({ inquiry_type: payload.inquiry_type, source });
      setStatus("done");
      form.reset();
    } catch {
      setStatus("error");
      setError("Could not send your enquiry. Please try WhatsApp instead.");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-sm border border-gold/30 bg-gold/10 p-6 text-center">
        <p className="font-serif text-lg text-burgundy">Thank you!</p>
        <p className="mt-2 text-sm text-muted-foreground">
          We&apos;ve received your enquiry and will reach out on WhatsApp shortly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {heading && (
        <h3 className="font-serif text-xl text-burgundy">{heading}</h3>
      )}

      {/* Honeypot — hidden from humans, tempting to bots */}
      <input
        type="text"
        name="website"
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name *</Label>
          <Input id="name" name="name" required placeholder="Your full name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone / WhatsApp *</Label>
          <Input id="phone" name="phone" type="tel" required placeholder="+91 …" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email (optional)</Label>
        <Input id="email" name="email" type="email" placeholder="you@example.com" />
      </div>

      {!lockType && (
        <div className="space-y-1.5">
          <Label htmlFor="inquiry_type">Enquiry type</Label>
          <Select id="inquiry_type" name="inquiry_type" defaultValue={defaultType}>
            <option value="retail">Retail (personal purchase)</option>
            <option value="wholesale">Wholesale / bulk</option>
            <option value="general">General question</option>
          </Select>
        </div>
      )}
      {lockType && <input type="hidden" name="inquiry_type" value={defaultType} />}

      <div className="space-y-1.5">
        <Label htmlFor="message">Message</Label>
        <Textarea
          id="message"
          name="message"
          placeholder={
            productName
              ? `I'm interested in ${productName}. Please share price and availability.`
              : "Tell us what you're looking for…"
          }
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={status === "loading"} className="w-full sm:w-auto">
        {status === "loading" ? "Sending…" : "Send Enquiry"}
      </Button>
    </form>
  );
}
