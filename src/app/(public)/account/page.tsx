import type { Metadata } from "next";
import { AccountView } from "@/components/auth/AccountView";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <section className="container-px mx-auto max-w-6xl py-16 sm:py-24">
      <AccountView />
    </section>
  );
}
