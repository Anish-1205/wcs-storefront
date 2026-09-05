import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ivory px-6 text-center">
      <p className="eyebrow">404</p>
      <h1 className="display-sm mt-4 text-oxblood">This page has moved on.</h1>
      <p className="mt-5 max-w-md text-[0.95rem] leading-relaxed text-muted-foreground">
        We couldn&apos;t find that page. The piece you&apos;re after may simply be
        listed under a different reference — try the catalog, or ask us.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
        <Link
          href="/catalog"
          className="inline-flex h-11 items-center bg-oxblood px-7 text-[0.75rem] font-medium uppercase tracking-[0.2em] text-ivory hover:bg-oxblood-soft"
        >
          Browse the catalog
        </Link>
        <Link
          href="/"
          className="link-underline text-[0.8rem] uppercase tracking-[0.16em] text-deep-brown/70"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
