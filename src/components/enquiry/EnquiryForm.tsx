"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/lib/cart/CartContext";
import {
  EMPTY_PROFILE,
  hasAnyValue,
  useProfile,
  type Profile,
} from "@/lib/profile/useProfile";
import { getSource } from "@/lib/source-tracking";
import { analytics } from "@/lib/analytics";
import {
  buildEnquiryWhatsAppURL,
  WHATSAPP_CONFIGURED,
} from "@/lib/whatsapp";
import { formatINR } from "@/lib/catalog-format";
import { CONCIERGE_NOTE } from "@/lib/copy";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const SHOPPING_FOR = ["Individual", "Bridal", "Boutique", "Wholesale"] as const;
export const ENQUIRY_STORAGE_KEY = "wcs.enquiry.v1";

type Errors = Partial<Record<"name" | "phone" | "city", string>>;

function countDigits(s: string) {
  return (s.match(/\d/g) ?? []).length;
}

export function EnquiryForm() {
  const router = useRouter();
  const { items, knownSubtotal, hasUnpriced, hydrated } = useCart();
  const { profile, loading: profileLoading, signedIn, save: saveProfile } =
    useProfile();
  const [errors, setErrors] = useState<Errors>({});
  const submitting = useRef(false);
  const [submittingState, setSubmittingState] = useState(false);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  // Wait for both the cart and (if signed in) the saved profile before
  // rendering — the fields are uncontrolled, so their defaults must be
  // known at first mount.
  const ready = hydrated && (!signedIn || !profileLoading);
  const prefill: Profile = profile ?? EMPTY_PROFILE;
  const prefilled = signedIn && hasAnyValue(profile);

  if (!ready) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Loading your selection…
      </div>
    );
  }

  if (hydrated && items.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-foreground">
          Your selection is empty — add a saree or two first.
        </p>
        <Link
          href="/catalog"
          className="link-underline mt-4 inline-flex text-sm font-medium text-oxblood"
        >
          Browse the catalog
        </Link>
      </div>
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;

    const form = e.currentTarget;
    const fd = new FormData(form);
    if (String(fd.get("website") ?? "")) return; // honeypot

    const values = {
      name: String(fd.get("name") ?? "").trim(),
      phone: String(fd.get("phone") ?? "").trim(),
      whatsapp: String(fd.get("whatsapp") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim(),
      city: String(fd.get("city") ?? "").trim(),
      state: String(fd.get("state") ?? "").trim(),
      country: String(fd.get("country") ?? "").trim(),
      shoppingFor: String(fd.get("shopping_for") ?? "Individual"),
      note: String(fd.get("message") ?? "").trim(),
    };

    // ── Validation (lenient, not strict international phone rules) ──
    const nextErrors: Errors = {};
    if (values.name.length < 2) nextErrors.name = "Please enter your name.";
    if (countDigits(values.phone) < 7)
      nextErrors.phone = "Please enter a reachable phone or WhatsApp number.";
    if (values.city.length < 2)
      nextErrors.city = "Please tell us your city so we can advise on delivery.";

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const firstKey = (["name", "phone", "city"] as const).find(
        (k) => nextErrors[k],
      );
      if (firstKey) fieldRefs.current[firstKey]?.focus();
      return;
    }
    setErrors({});

    // ── Lock, build message, hand off WITHIN the user gesture ──
    submitting.current = true;
    setSubmittingState(true);

    const source = getSource();
    const customer = {
      name: values.name,
      city: values.city,
      state: values.state,
      country: values.country,
      shoppingFor: values.shoppingFor,
      message: values.note,
    };
    const waUrl = buildEnquiryWhatsAppURL(items, customer);

    // Open the tab NOW — still inside the click gesture, so popup blockers
    // don't intervene. (With rel=noopener the return value is always null, so
    // we don't try to detect success here — /enquiry/sent always offers a
    // real link to (re)open.)
    if (WHATSAPP_CONFIGURED) {
      window.open(waUrl, "_blank", "noopener,noreferrer");
    }

    // Persist a snapshot so the confirmation page can re-open WhatsApp and
    // the customer never has to rebuild their selection after a failed handoff.
    try {
      sessionStorage.setItem(
        ENQUIRY_STORAGE_KEY,
        JSON.stringify({
          waUrl,
          configured: WHATSAPP_CONFIGURED,
          items,
          customer: { ...customer, phone: values.phone, whatsapp: values.whatsapp, email: values.email },
          ts: Date.now(),
        }),
      );
    } catch {
      /* storage unavailable — the sent page falls back to a generic message */
    }

    // Fire-and-forget internal notification. The WhatsApp hand-off is the
    // real channel, so a failure here must not block or alarm the customer.
    const itemLines = items
      .map(
        (i) =>
          `- ${i.title} (${i.reference})${i.colour ? `, ${i.colour}` : ""} x${i.qty} — ${
            i.price == null ? "Price on enquiry" : formatINR(i.price)
          }`,
      )
      .join("\n");
    const composedMessage = [
      `Availability enquiry — shopping for: ${values.shoppingFor}`,
      values.whatsapp ? `WhatsApp: ${values.whatsapp}` : "",
      [values.city, values.state, values.country].filter(Boolean).length
        ? `Location: ${[values.city, values.state, values.country].filter(Boolean).join(", ")}`
        : "",
      "",
      "Selection:",
      itemLines,
      values.note ? `\nNote: ${values.note}` : "",
    ]
      .filter((l) => l !== "")
      .join("\n")
      .slice(0, 2000);
    const inquiryType =
      values.shoppingFor === "Boutique" || values.shoppingFor === "Wholesale"
        ? "wholesale"
        : "retail";

    fetch("/api/inquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        phone: values.phone,
        email: values.email,
        message: composedMessage,
        inquiry_type: inquiryType,
        product_name: items.map((i) => i.title).join(", ").slice(0, 200),
        website: "",
        source,
      }),
    }).catch(() => {
      /* recorded via sessionStorage; the customer continues on WhatsApp */
    });

    analytics.inquirySubmit({ inquiry_type: inquiryType, source });

    // Remember these details for next time — signed-in customers only.
    // Fire-and-forget; a failure here never blocks the WhatsApp hand-off.
    if (signedIn) {
      void saveProfile({
        full_name: values.name,
        phone: values.phone,
        whatsapp: values.whatsapp,
        email: values.email,
        city: values.city,
        state: values.state,
        country: values.country,
        shopping_for: values.shoppingFor,
      });
    }

    // Cart is intentionally NOT cleared here — it's cleared on the
    // confirmation page only once the customer confirms they've sent it.
    router.push("/enquiry/sent");
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_22rem] lg:gap-16">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <input type="text" name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />

        {prefilled && (
          <p className="text-xs text-muted-foreground">
            Filled in from your{" "}
            <Link href="/account" className="underline hover:text-oxblood">
              account details
            </Link>
            . Edit anything before sending.
          </p>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="name"
            label="Full Name"
            required
            error={errors.name}
            defaultValue={prefill.full_name}
            inputRef={(el) => (fieldRefs.current.name = el)}
            autoComplete="name"
          />
          <Field
            id="phone"
            label="Phone / WhatsApp contact"
            type="tel"
            required
            error={errors.phone}
            placeholder="+91 …"
            defaultValue={prefill.phone}
            inputRef={(el) => (fieldRefs.current.phone = el)}
            autoComplete="tel"
          />
          <Field id="whatsapp" label="WhatsApp Number" type="tel" placeholder="If different from above" defaultValue={prefill.whatsapp} autoComplete="tel" />
          <Field id="email" label="Email" type="email" defaultValue={prefill.email} autoComplete="email" />
          <Field
            id="city"
            label="City"
            required
            error={errors.city}
            defaultValue={prefill.city}
            inputRef={(el) => (fieldRefs.current.city = el)}
            autoComplete="address-level2"
          />
          <Field id="state" label="State" defaultValue={prefill.state} autoComplete="address-level1" />
          <Field id="country" label="Country" defaultValue={prefill.country} autoComplete="country-name" />
          <div className="space-y-1.5">
            <Label htmlFor="shopping_for">I am shopping for</Label>
            <Select
              id="shopping_for"
              name="shopping_for"
              defaultValue={
                (SHOPPING_FOR as readonly string[]).includes(prefill.shopping_for)
                  ? prefill.shopping_for
                  : "Individual"
              }
            >
              {SHOPPING_FOR.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="message">Message / requirements (optional)</Label>
          <Textarea id="message" name="message" placeholder="Anything specific — occasion, date, colours, budget…" />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {CONCIERGE_NOTE} Sending this shares your selection with us and opens
          WhatsApp so we can continue there. See our{" "}
          <Link href="/privacy" className="underline hover:text-oxblood">privacy policy</Link>.
        </p>

        <button
          type="submit"
          disabled={submittingState}
          className="arrow-shift-host inline-flex h-12 items-center justify-center gap-2 bg-oxblood px-8 text-[0.78rem] font-medium uppercase tracking-[0.22em] text-primary-foreground hover:bg-oxblood-soft disabled:opacity-60"
        >
          {submittingState
            ? "Continuing…"
            : WHATSAPP_CONFIGURED
              ? "Continue on WhatsApp"
              : "Send Enquiry"}
          <span className="arrow-shift">→</span>
        </button>
      </form>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <h2 className="eyebrow">Your selection</h2>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {items.map((i) => (
            <li key={i.slug} className="flex gap-3 py-4">
              <div className="relative aspect-[4/5] w-14 shrink-0 overflow-hidden bg-warm-cream">
                <Image src={i.image} alt={i.title} fill sizes="56px" className="object-cover" />
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-serif leading-snug text-deep-brown">{i.title}</p>
                <p className="text-xs text-muted-foreground">
                  Ref. {i.reference} · Qty {i.qty}
                </p>
                <p className="text-xs text-deep-brown/80">
                  {i.price == null ? "Price on Enquiry" : formatINR(i.price * i.qty)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {knownSubtotal != null && (
          <p className="mt-3 flex justify-between text-sm">
            <span className="text-muted-foreground">
              {hasUnpriced ? "Priced items" : "Subtotal"}
            </span>
            <span className="text-deep-brown">{formatINR(knownSubtotal)}</span>
          </p>
        )}
        {hasUnpriced && (
          <p className="mt-1 text-xs text-muted-foreground">
            Remaining pieces are priced on enquiry — price to be confirmed.
          </p>
        )}
      </aside>
    </div>
  );
}

function Field({
  id,
  label,
  type = "text",
  required,
  placeholder,
  error,
  defaultValue,
  inputRef,
  autoComplete,
}: {
  id: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  error?: string;
  defaultValue?: string;
  inputRef?: (el: HTMLInputElement | null) => void;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}{" "}
        {required && (
          <span className="text-oxblood" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      <Input
        id={id}
        name={id}
        type={type}
        ref={inputRef}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(error && "border-destructive focus-visible:ring-destructive")}
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
