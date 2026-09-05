import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Create an account",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return (
    <section className="container-px mx-auto max-w-6xl py-16 sm:py-24">
      <Suspense fallback={<div className="min-h-[24rem]" />}>
        <AuthForm mode="signup" />
      </Suspense>
    </section>
  );
}
