"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markProductReviewed } from "@/app/admin/whatsapp-draft-actions";

/** Clears the "Needs review" flag once the admin has looked the draft over. Changes nothing else. */
export function MarkReviewedButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark() {
    setBusy(true);
    setError(null);
    const result = await markProductReviewed(productId);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={mark}>
        {busy ? "Saving…" : "Mark as reviewed"}
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </>
  );
}
