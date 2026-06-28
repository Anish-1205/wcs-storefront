import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ivory px-5 text-center">
      <span className="gold-rule" />
      <h1 className="mt-6 font-serif text-5xl text-burgundy">404</h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        We couldn&apos;t find that page. It may have been moved, or the saree
        you&apos;re looking for is no longer available.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/">
          <Button>Back to home</Button>
        </Link>
        <Link href="/catalog">
          <Button variant="outline">Browse sarees</Button>
        </Link>
      </div>
    </div>
  );
}
