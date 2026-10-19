"use client";

import { useState, useTransition } from "react";
import { setAiKillSwitch } from "@/app/admin/ai-usage-actions";

export function AiKillSwitch({ on, paused }: { on: boolean; paused: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (next: boolean, clearPause: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await setAiKillSwitch(next, clearPause);
      if (!result.ok) setError(result.error);
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      {on ? (
        <button type="button" disabled={pending} onClick={() => run(false, false)}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          Turn AI back on
        </button>
      ) : (
        <button type="button" disabled={pending} onClick={() => run(true, false)}
          className="rounded-sm border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive disabled:opacity-60">
          Turn all AI calls off
        </button>
      )}
      {paused && (
        <button type="button" disabled={pending} onClick={() => run(on, true)}
          className="rounded-sm border border-border px-4 py-2 text-sm font-medium text-foreground disabled:opacity-60">
          Clear the spend-limit pause
        </button>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
