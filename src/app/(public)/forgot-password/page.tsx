
import { ContentRegion } from "@/components/content/ContentRegion";
import type { Metadata } from "next";
import { PasswordResetForm } from "@/components/auth/PasswordResetForm";

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <ContentRegion region="page"><section className="container-px mx-auto max-w-6xl py-16 sm:py-24">
      <PasswordResetForm mode="request" />
    </section></ContentRegion>
  );
}
