import { requireAdmin } from "@/lib/admin-auth";
import { getPendingMigrations } from "@/app/admin/db-migrations-actions";
import { DatabaseMigrationsPanel } from "@/components/admin/DatabaseMigrationsPanel";

// Must always reflect live database state — never cached/ISR'd.
export const dynamic = "force-dynamic";

export default async function DatabasePage() {
  await requireAdmin();
  const result = await getPendingMigrations();

  return (
    <div>
      <h1 className="font-serif text-3xl text-primary">Database migrations</h1>
      <p className="mb-6 mt-2 max-w-2xl text-sm text-muted-foreground">
        Detects supabase/migrations/*.sql files not yet recorded in this
        database&rsquo;s supabase_migrations.schema_migrations table — the
        same tracking table the Supabase CLI uses — and applies them in
        order, one at a time.
      </p>

      {!result.ok ? (
        <p className="rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {result.error}
        </p>
      ) : !result.configured ? (
        <p className="max-w-2xl rounded-sm border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <code className="font-mono text-foreground">DATABASE_URL</code> isn&rsquo;t configured, so this can&rsquo;t
          connect to the database directly. Apply new migrations the usual way — paste each new file from{" "}
          <code className="font-mono text-foreground">supabase/migrations/</code> into the Supabase SQL Editor, in
          filename order. See <code className="font-mono text-foreground">docs/deployment.md</code> to set this up.
        </p>
      ) : (
        <DatabaseMigrationsPanel initialPending={result.pending} />
      )}
    </div>
  );
}
