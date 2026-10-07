"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MediaThumb } from "./MediaThumb";
import { restoreHiddenMedia } from "@/app/admin/whatsapp-draft-actions";

export type HiddenMediaItem = {
  id: string;
  image_url: string;
  media_type: "image" | "video";
  reason: string;
};

const REASONS: Record<string, string> = {
  duplicate: "Same photo sent twice",
  near_duplicate: "Near-identical copy",
  over_limit: "Extra, over the photo limit",
  unmatched_colour: "Colour not matched",
};

/**
 * Photos/videos a WhatsApp listing left out (migration 031). Nothing here is
 * shown to customers; "Restore" moves one back to the end of its variant.
 */
export function HiddenMediaTray({ items }: { items: HiddenMediaItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!items.length) return null;

  async function restore(id: string) {
    setBusy(id);
    setError(null);
    const result = await restoreHiddenMedia(id);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    router.refresh();
  }

  return (
    <details className="rounded-sm border border-border bg-card p-4" data-testid="hidden-media-tray">
      <summary className="cursor-pointer font-serif text-lg text-primary">Hidden images ({items.length})</summary>
      <p className="mt-2 text-sm text-muted-foreground">
        Sent on WhatsApp but left out of this listing. Customers never see them. Restoring one adds it to the end of
        its colour; save any other changes on this page first.
      </p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => (
          <li key={item.id} className="space-y-2">
            <div className="relative aspect-[3/4] overflow-hidden rounded-sm border border-border bg-muted">
              <MediaThumb url={item.image_url} alt="Hidden image" isVideo={item.media_type === "video"} sizes="160px" />
            </div>
            <p className="text-xs text-muted-foreground">{REASONS[item.reason] ?? "Hidden"}</p>
            <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => restore(item.id)}>
              {busy === item.id ? "Restoring…" : "Restore"}
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
