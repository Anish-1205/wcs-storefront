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
      // Raw WhatsApp text (may hold a phone number) and the ingestion's own tables.
      "product_source_texts",
      "variant_hidden_media",
      "product_media_labels",
      "whatsapp_settings",
      "whatsapp_inbox",
      "whatsapp_batches",
      "whatsapp_notices",
      // AI usage ledger and kill switch (035).
      "ai_usage_daily",
      "ai_settings",
      // Admin audit log (036).
      "admin_audit_log",
      // Inquiry status history (037).
      "inquiry_status_history",
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
      // One policy per command, and none of them naming a role: the same four
      // doors, open to a request only for its own `user_id` row.
      expect(surviving.map(([, body]) => body.match(/for\s+(select|insert|update|delete)/i)![1].toLowerCase()).sort())
        .toEqual(["delete", "insert", "select", "update"]);
      for (const [key, body] of surviving) {
        expect(body, `${key} is scoped to a role`).not.toMatch(/\bto\s+(anon|authenticated|public)\b/i);
        // 033 wrapped the call in a scalar subquery so the planner evaluates it
        // once per statement as an InitPlan instead of once per candidate row.
        // The comparison — and so who the policy lets in, including anon, for
        // whom auth.uid() is null and the row is filtered out either way — is
        // unchanged.
        expect(body, `${key} is not owner-scoped`).toContain("(select auth.uid()) = user_id");
      }
    }
  });
});

describe("the raw WhatsApp text stays admin-only", () => {
  const migration = readFileSync(resolve("supabase/migrations/030_whatsapp_ordering_review.sql"), "utf8");
  const storefront = [
    "src/lib/queries.ts",
    "src/lib/storefront-catalog.ts",
    "src/lib/storefront-media.ts",
    "src/lib/supabase/client.ts",
  ].map((file) => readFileSync(resolve(file), "utf8"));

  it("is not a column of products, which the public can read once published", () => {
    // The storefront selects products with "*": any column there is public for a published product.
    expect(migration).not.toMatch(/alter table (public\.)?products add column[^;]*source_text/i);
    expect(migration).toMatch(/create table if not exists public\.product_source_texts/);
  });

  it("has RLS on, no policy, and no grant to anon or authenticated", () => {
    expect(migration).toContain("alter table public.product_source_texts enable row level security");
    expect(migration).toContain("revoke all on public.product_source_texts from public, anon, authenticated");
    expect(migration).not.toMatch(/create policy[^;]*product_source_texts/i);
  });

  it("is not read by any storefront query", () => {
    for (const source of storefront) {
      expect(source).not.toContain("product_source_texts");
      expect(source).not.toContain("source_text");
    }
  });
});

/**
 * Replays every `grant`/`revoke` in the migrations and returns the privileges
 * each role is left holding on one object.
 *
 * `storefront_hidden_slugs` is an auto-updatable view that deliberately runs
 * as its owner rather than its invoker, so a write privilege on it is a write
 * to public.products with the products RLS policies bypassed (see migration
 * 032). Read-only is the whole contract, and only a replay can show it: 021
 * granted select and revoked "all ... from public", which left Supabase's
 * default grants to anon and authenticated in place.
 */
function effectiveGrants(object: string) {
  const dir = resolve("supabase/migrations");
  const held = new Map<string, Set<string>>();
  const ALL = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];
  const privsOf = (list: string) =>
    list.trim().toLowerCase() === "all" ? ALL : list.toLowerCase().split(",").map((p) => p.trim().replace(/\s*\(.*\)$/, ""));
  const rolesOf = (list: string) => list.toLowerCase().split(",").map((r) => r.trim());

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(resolve(dir, file), "utf8").replace(/^\s*--.*$/gm, "");

    for (const raw of sql.split(";")) {
      const statement = raw.trim().replace(/\s+/g, " ");
      if (!statement) continue;

      const granted = statement.match(/^grant\s+(.+?)\s+on\s+(?:table\s+)?public\.([a-z_]+)\s+to\s+(.+)$/i);
      if (granted && granted[2].toLowerCase() === object) {
        for (const role of rolesOf(granted[3])) {
          const set = held.get(role) ?? new Set<string>();
          for (const priv of privsOf(granted[1])) set.add(priv);
          held.set(role, set);
        }
        continue;
      }

      const revoked = statement.match(/^revoke\s+(.+?)\s+on\s+(?:table\s+)?public\.([a-z_]+)\s+from\s+(.+)$/i);
      if (revoked && revoked[2].toLowerCase() === object) {
        for (const role of rolesOf(revoked[3])) {
          const set = held.get(role);
          if (!set) continue;
          for (const priv of privsOf(revoked[1])) set.delete(priv);
        }
      }
    }
  }

  return held;
}

describe("the hidden-slugs view is readable and nothing more", () => {
  const grants = effectiveGrants("storefront_hidden_slugs");

  it("leaves anon and authenticated holding select only", () => {
    for (const role of ["anon", "authenticated"]) {
      expect([...(grants.get(role) ?? [])].sort(), `${role} can write through the view`).toEqual(["select"]);
    }
  });

  it("still lets the storefront read it — the view's whole purpose", () => {
    // src/lib/catalog-hidden-slugs.ts reads this with the anon key on every
    // catalogue render; without select the storefront cannot tell what is hidden.
    expect(grants.get("anon")).toContain("select");
    expect(readFileSync(resolve("src/lib/catalog-hidden-slugs.ts"), "utf8")).toContain("storefront_hidden_slugs");
  });

  it("keeps running as its owner, which is why the privileges have to be tight", () => {
    const creation = readFileSync(resolve("supabase/migrations/021_storefront_hidden_slugs.sql"), "utf8");

    expect(creation).toContain("security_invoker = off");
  });
});
