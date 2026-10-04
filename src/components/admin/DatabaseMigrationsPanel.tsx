"use client";

import type { PendingMigration } from "@/app/admin/db-migrations-actions";

/** Read-only migration preview. Applying DDL is deliberately disabled here. */
export function DatabaseMigrationsPanel({ initialPending: files }: { initialPending: PendingMigration[] }) {
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
            disabled
            className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            Apply disabled
          </button>
          <p className="text-sm text-muted-foreground">One-click apply is disabled. Review the numeric migration ledger and deployed policies before using the CLI migration process.</p>
        </>
      )}

    </div>
  );
}
