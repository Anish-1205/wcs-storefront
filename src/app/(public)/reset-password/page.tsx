import type { Metadata } from "next";
import { PasswordResetForm } from "@/components/auth/PasswordResetForm";

export const metadata: Metadata = {
  title: "Set a new password",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <section className="container-px mx-auto max-w-6xl py-16 sm:py-24">
      <PasswordResetForm mode="update" />
    </section>
  );
}
