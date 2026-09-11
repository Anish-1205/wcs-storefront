import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Replays every migration in order and returns the schema's *effective*
 * security state — the policies still standing after all the later drops,
 * which tables exist, and which have RLS switched on.
 *
 * Line comments are stripped before statements are split on ";" because
 * several migrations have prose containing semicolons above an ALTER, which
 * would otherwise hide that statement from the parser.
 */
function effectiveSecurityState() {
  const dir = resolve("supabase/migrations");
  const policies = new Map<string, string>();
  const rlsEnabled = new Set<string>();
  const tables = new Set<string>();
  const norm = (name: string) => name.replace(/^public\./i, "").toLowerCase();

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(resolve(dir, file), "utf8").replace(/^\s*--.*$/gm, "");

    for (const raw of sql.split(";")) {
      const statement = raw.trim();
      if (!statement) continue;

      const created = statement.match(/^create\s+policy\s+"([^"]+)"\s+on\s+([a-z_.]+)/i);
      if (created) {
        policies.set(`${norm(created[2])}::${created[1]}`, statement);
        continue;
      }

      const dropped = statement.match(/^drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+([a-z_.]+)/i);
      if (dropped) {
        policies.delete(`${norm(dropped[2])}::${dropped[1]}`);
        continue;
      }

      const table = statement.match(/^create\s+table\s+if\s+not\s+exists\s+([a-z_.]+)/i);
      if (table) {
        tables.add(norm(table[1]));
        continue;
      }

      const rls = statement.match(/^alter\s+table\s+([a-z_.]+)\s+enable\s+row\s+level\s+security/i);
      if (rls) rlsEnabled.add(norm(rls[1]));
    }
  }

  return { policies, rlsEnabled, tables };
}

describe("database security migration", () => {
  const migration = readFileSync(resolve("supabase/migrations/008_harden_public_policies.sql"), "utf8");

  it("removes anonymous lead writes and unrestricted upload-session access", () => {
    expect(migration).toContain('drop policy if exists "public insert inquiries"');
    expect(migration).toContain('drop policy if exists "public insert subscribers"');
    expect(migration).toContain('drop policy if exists "admin_upload_sessions_all_access"');
  });

  it("limits child records to published products", () => {
    expect(migration.match(/products\.status = 'published'/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("effective RLS state across all migrations", () => {
  const { policies, rlsEnabled, tables } = effectiveSecurityState();

  it("leaves no policy that grants access to any signed-in account", () => {
    // `auth.role() = 'authenticated'` means "has a session", not "is an admin".
    // Customer accounts are self-serve (/signup), so any such policy hands a
    // stranger whatever it protects. Admin access is service-role only.
    const offenders = [...policies.entries()]
      .filter(([, body]) => /auth\.role\(\)\s*=\s*'authenticated'/i.test(body))
      .map(([key]) => key);

    expect(offenders).toEqual([]);
  });

  it("enables row level security on every table", () => {
    const missing = [...tables].filter((table) => !rlsEnabled.has(table)).sort();
    expect(missing).toEqual([]);
  });

  it("keeps admin-only and lead data unreachable with the anon key", () => {
    const serverOnly = [
      "contacts",
      "inquiries",
      "whatsapp_subscribers",
      "whatsapp_ingest_events",
      "admin_upload_sessions",
      "import_batches",
      "import_product_groups",
      "import_assets",
      "collection_aliases",
      "import_collection_classifications",
      "import_processing_jobs",
      "storefront_page_content_versions",
    ];

    const reachable = serverOnly.filter((table) =>
      [...policies.keys()].some((key) => key.startsWith(`${table}::`)),
    );

    expect(reachable).toEqual([]);
  });

  it("keeps the storefront readable, select-only, for anon", () => {
    const publicReadable = [
      "products",
      "product_variants",
      "variant_images",
      "categories",
      "collections",
      "collection_products",
      "storefront_availability_overrides",
      "storefront_page_content",
    ];

    for (const table of publicReadable) {
      const surviving = [...policies.entries()].filter(([key]) => key.startsWith(`${table}::`));

      expect(surviving, `${table} lost its public read policy`).toHaveLength(1);
      expect(surviving[0][1].toLowerCase(), `${table} is writable by anon`).toContain("for select");
    }
  });

  it("scopes customer carts and profiles to their owner", () => {
    for (const table of ["carts", "profiles"]) {
      const surviving = [...policies.entries()].filter(([key]) => key.startsWith(`${table}::`));

      expect(surviving).toHaveLength(4);
      for (const [key, body] of surviving) {
        expect(body, `${key} is not owner-scoped`).toContain("auth.uid() = user_id");
      }
    }
  });
});
