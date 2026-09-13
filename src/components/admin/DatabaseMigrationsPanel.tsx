"use client";

import { useState, useTransition } from "react";
import { applyPendingMigrations, type PendingMigration } from "@/app/admin/db-migrations-actions";

interface Props {
  initialPending: PendingMigration[];
}

type Result =
  | { kind: "error"; message: string }
  | { kind: "applied"; applied: string[]; failed?: { file: string; error: string }; remaining: string[] };

/**
 * The only trigger for applyPendingMigrations() — no polling, no effect, no
 * auto-run on mount. A Server Action is request/response, not a stream, so a
 * multi-file run shows one spinner with no per-file progress until it all
 * finishes; acceptable since these are schema DDL files, typically fast.
 */
export function DatabaseMigrationsPanel({ initialPending }: Props) {
  const [pending, startTransition] = useTransition();
  const [files, setFiles] = useState(initialPending);
  const [result, setResult] = useState<Result | null>(null);

  function apply() {
    setResult(null);
    startTransition(async () => {
      const res = await applyPendingMigrations();
      if (!res.ok) {
        setResult({ kind: "error", message: res.error });
        return;
      }
      setResult({ kind: "applied", applied: res.applied, failed: res.failed, remaining: res.remaining });
      const succeeded = new Set(res.applied);
      setFiles((current) => current.filter((f) => !succeeded.has(f.file) && f.file !== res.failed?.file));
    });
  }

  return (
    <div className="mt-6 space-y-6">
      {files.length === 0 ? (
        <p className="rounded-sm border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Nothing pending — every migration in supabase/migrations/ is applied.
        </p>
      ) : (
        <>
          <div className="divide-y divide-border rounded-sm border border-border bg-card">
            {files.map((f) => (
              <details key={f.file} className="group px-4 py-3">
                <summary className="cursor-pointer list-none font-mono text-sm text-foreground">
                  <span className="mr-2 text-muted-foreground group-open:hidden">▸</span>
                  <span className="mr-2 hidden group-open:inline">▾</span>
                  {f.file}
                </summary>
                <pre className="mt-3 max-h-80 overflow-auto rounded-sm bg-secondary/40 p-3 text-xs">{f.sql}</pre>
              </details>
            ))}
          </div>

          <button
            type="button"
            onClick={apply}
            disabled={pending}
            className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {pending ? "Applying…" : `Apply ${files.length} pending migration${files.length === 1 ? "" : "s"}`}
          </button>
        </>
      )}

      {result?.kind === "error" && (
        <p className="rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {result.message}
        </p>
      )}

      {result?.kind === "applied" && (
        <div className="space-y-2 text-sm">
          {result.applied.map((file) => (
            <p key={file} className="rounded-sm border border-border bg-secondary/30 px-4 py-2 text-foreground">
              ✓ Applied — {file}
            </p>
          ))}
          {result.failed && (
            <div className="rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive">
              <p className="font-medium">✗ Failed — {result.failed.file}</p>
              <p className="mt-1 font-mono text-xs">{result.failed.error}</p>
              <p className="mt-1 text-xs">That migration&rsquo;s transaction was rolled back — nothing partial was left behind.</p>
            </div>
          )}
          {result.remaining.length > 0 && (
            <p className="rounded-sm border border-border bg-card px-4 py-2 text-muted-foreground">
              Not attempted (stopped after the failure above): {result.remaining.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
