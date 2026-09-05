import type { Metadata } from "next";
import { CartView } from "@/components/cart/CartView";

export const metadata: Metadata = {
  title: "Your Selection",
  robots: { index: false, follow: false },
};

export default function CartPage() {
  return (
    <div className="container-px mx-auto max-w-[80rem] py-12 lg:py-16">
      <header className="mb-10">
        <p className="eyebrow">Your selection</p>
        <h1 className="display-sm mt-3 text-oxblood">Your Cart</h1>
      </header>
      <CartView />
    </div>
  );
}
