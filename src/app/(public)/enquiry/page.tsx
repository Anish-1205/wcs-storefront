import type { Metadata } from "next";
import { EnquiryForm } from "@/components/enquiry/EnquiryForm";

export const metadata: Metadata = {
  title: "One Final Step",
  description:
    "Tell us where we can reach you. We personally verify the availability of your selected sarees and continue with you on WhatsApp.",
  robots: { index: false, follow: false },
};

export default function EnquiryPage() {
  return (
    <div className="container-px mx-auto max-w-[80rem] py-12 lg:py-16">
      <header className="mb-10 max-w-2xl">
        <p className="eyebrow">Your selection</p>
        <h1 className="display mt-4 text-oxblood">One final step.</h1>
        <p className="mt-6 text-[0.98rem] leading-relaxed text-muted-foreground">
          Tell us where we can reach you. We&apos;ll personally verify the
          availability of your selected sarees and continue with you on WhatsApp.
        </p>
      </header>
      <EnquiryForm />
    </div>
  );
}
