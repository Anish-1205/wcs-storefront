import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The schema half of migration 033 (the Supabase Security Advisor findings).
 *
 * src/__tests__/security-policies.test.ts owns the table policies and table
 * grants; this file owns what 033 changed that those replays do not see — the
 * view's own definition and options, each function's search_path and execute
 * privileges, and which tables a browser client is allowed to touch.
 *
 * Everything here is a replay of supabase/migrations in order, so a later
 * migration that undoes one of these decisions fails the test rather than
 * passing because the fix is still in 033's file.
 */

const MIGRATIONS = resolve("supabase/migrations");

/** Every migration in order, with line comments stripped (several hold prose
 *  containing semicolons above a statement, which would otherwise swallow it). */
function statements(): { file: string; sql: string }[] {
  const all: { file: string; sql: string }[] = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8").replace(/^\s*--.*$/gm, "");
    for (const raw of sql.split(";")) {
      const statement = raw.trim();
      if (statement) all.push({ file, sql: statement });
    }
  }
  return all;
}

const ALL = statements();
const flat = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

// ── 1. storefront_hidden_slugs ────────────────────────────────────────

describe("the hidden-slugs view cannot start returning nothing", () => {
  /** The definition the database ends up with: the last `create or replace`. */
  const definition = ALL.filter(({ sql }) =>
    /^create\s+(or\s+replace\s+)?view\s+public\.storefront_hidden_slugs\b/i.test(sql),
  ).at(-1)!;

  /** Every `set (...)`/`reset (...)` on the view, in order. */
  const options = ALL.filter(({ sql }) => /^alter\s+view\s+public\.storefront_hidden_slugs\b/i.test(sql)).map(
    ({ sql }) => flat(sql),
  );

  it("is defined in 033 and still selects only the slug of an unpublished product", () => {
    expect(definition.file).toBe("033_security_advisor_findings.sql");
    expect(flat(definition.sql)).toContain("from public.products where status <> 'published'");
    // One column, and not one that PostgREST could follow to a draft's content:
    // a view exposing id or category_id gets a foreign-key relationship, and
    // with it `?select=slug,products(*)` embedding through an owner-run view.
    const projection = flat(definition.sql).match(/select\s+(?:distinct\s+)?(.+?)\s+from/)![1];
    expect(projection).toBe("slug");
  });

  it("never becomes security_invoker, which would make it return zero rows to anon", () => {
    // This is the whole reason the advisor's suggested fix is refused: under
    // the products "public read published" policy an invoker-run view sees no
    // unpublished row, so the storefront would read "nothing is hidden" and
    // put every product an admin has taken off the site back onto it.
    expect(options.filter((option) => /security_invoker\s*=\s*(on|true)/.test(option))).toEqual([]);
    expect(options.filter((option) => option.includes("security_invoker")).at(-1)).toContain("security_invoker = off");
  });

  it("is not auto-updatable, so no privilege can rewrite a write into one on products", () => {
    // `select distinct` (slug is unique on products, so the result is the same)
    // takes the view out of Postgres's auto-updatable class. Without it, only
    // the grants stand between the anon key and a DELETE on public.products
    // executed as the view's owner — the hole 032 closed by privilege alone.
    expect(flat(definition.sql)).toMatch(/^create\s+(or\s+replace\s+)?view\s+\S+\s+as\s+select\s+distinct\s/);
    expect(options.at(-1)).toContain("security_barrier = true");
  });

  it("keeps the select grant the storefront's anon reads depend on", () => {
    const grants = ALL.filter(({ sql }) => /on\s+public\.storefront_hidden_slugs\s+to\s/i.test(sql)).map(({ sql }) =>
      flat(sql),
    );

    expect(grants.at(-1)).toMatch(/^grant select on public\.storefront_hidden_slugs to/);
    // Both readers use the anon key, so revoking its select would turn every
    // hidden-slug read into a failure, not into a smaller answer.
    expect(readFileSync(resolve("src/lib/catalog-hidden-slugs.ts"), "utf8")).toContain("createPublicClient()");
    expect(readFileSync(resolve("src/lib/catalog-visibility-snapshot.mjs"), "utf8")).toContain("anonKey");
  });

  it("is never dropped, which would hand anon the write privileges back", () => {
    // `create or replace view` keeps grants; drop + create re-applies
    // Supabase's default privileges for anon and authenticated.
    expect(ALL.filter(({ sql }) => /^drop\s+view[^;]*storefront_hidden_slugs/i.test(sql))).toEqual([]);
  });
});

// ── 2. search_path on every function ──────────────────────────────────

/**
 * Which functions end up with a fixed search_path. A function is pinned by a
 * `set search_path` in its own definition or by a later `alter function`, and
 * unpinned by a later definition without one (a `create or replace` drops the
 * previous SET clauses) or by an explicit `reset`.
 */
function searchPathState(): Map<string, boolean> {
  const pinned = new Map<string, boolean>();
  for (const { sql } of ALL) {
    const created = sql.match(/^create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_]+)\s*\(([\s\S]*)$/i);
    if (created) {
      // Only the header counts: a `set search_path` inside the body would be a
      // different thing entirely.
      const header = created[2].split(/\$\$|\bas\s+\$/i)[0];
      pinned.set(created[1].toLowerCase(), /set\s+search_path/i.test(header));
      continue;
    }
    const altered = sql.match(/^alter\s+function\s+(?:public\.)?([a-z_]+)\s*\([^)]*\)\s*(set|reset)\s+search_path/i);
    if (altered) pinned.set(altered[1].toLowerCase(), altered[2].toLowerCase() === "set");
  }
  return pinned;
}

describe("every function has a fixed search_path", () => {
  const pinned = searchPathState();

  it("leaves none resolving unqualified names against the caller's path", () => {
    // An unpinned function resolves names against whatever path the caller
    // has, and the temporary schema is searched first unless it is listed, so
    // a caller able to create a temp table chooses which tables it touches.
    expect([...pinned].filter(([, ok]) => !ok).map(([name]) => name).sort()).toEqual([]);
  });

  it("pins the four the advisor named", () => {
    for (const fn of [
      "set_updated_at",
      "append_whatsapp_pending_media",
      "carts_touch_updated_at",
      "profiles_touch_updated_at",
    ]) {
      expect(pinned.get(fn), `${fn} has a mutable search_path`).toBe(true);
    }
  });

  it("qualifies the one table reference that an empty search_path would break", () => {
    const body = ALL.filter(({ sql }) =>
      /^create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?append_whatsapp_pending_media/i.test(sql),
    ).at(-1)!.sql;

    expect(flat(body)).toContain("search_path = ''");
    expect(body).toContain("public.admin_upload_sessions");
    // Still the single-statement upsert: two concurrent webhook deliveries for
    // the same sender must not lose an append to a read-modify-write race.
    expect(flat(body)).toContain("on conflict (admin_phone) do update");
  });

  it("does not touch the bodies of the three trigger functions", () => {
    // They reference nothing but `new` and now(), so `alter function` is
    // enough — and it keeps every trigger that uses them attached.
    for (const fn of ["set_updated_at", "carts_touch_updated_at", "profiles_touch_updated_at"]) {
      const definitions = ALL.filter(({ sql }) =>
        new RegExp(`^create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${fn}\\s*\\(`, "i").test(sql),
      );

      expect(definitions).toHaveLength(1);
      expect(definitions[0].file).not.toContain("033");
    }
  });
});

// ── 3. Function execute privileges ────────────────────────────────────

/** The privileges each role is left holding on one function. */
function executeGrants(fn: string): Map<string, Set<string>> {
  const held = new Map<string, Set<string>>();
  for (const { sql } of ALL) {
    const line = flat(sql);
    const match = line.match(/^(grant|revoke)\s+(.+?)\s+on\s+function\s+(.+?)\s+(?:to|from)\s+(.+)$/);
    if (!match || !match[3].includes(`public.${fn}(`)) continue;
    const privileges = match[2].trim() === "all" ? ["execute"] : match[2].split(",").map((p) => p.trim());
    for (const role of match[4].split(",").map((r) => r.trim())) {
      const set = held.get(role) ?? new Set<string>();
      for (const privilege of privileges) {
        if (match[1] === "grant") set.add(privilege);
        else set.delete(privilege);
      }
      held.set(role, set);
    }
  }
  return held;
}

describe("the availability trigger function is not callable by the public", () => {
  const grants = executeGrants("follow_product_availability");

  it("revokes the default public execute and names service_role instead", () => {
    // Postgres grants EXECUTE to PUBLIC on a new function; 022 never took it
    // back. Nothing calls this function directly — it exists for the
    // product_availability_lifecycle trigger on products — and nothing can:
    // it returns `trigger`, which Postgres refuses to call any other way.
    for (const role of ["public", "anon", "authenticated"]) {
      expect([...(grants.get(role) ?? [])], `${role} can still execute it`).toEqual([]);
    }
    expect(grants.get("service_role")).toContain("execute");
  });

  it("leaves the trigger in place", () => {
    // EXECUTE on a trigger function is checked when the trigger is created,
    // not when it fires, so the revoke above cannot break a product rename.
    const triggers = ALL.filter(({ sql }) => /^create\s+trigger\s+product_availability_lifecycle/i.test(sql));

    expect(triggers).toHaveLength(1);
    expect(ALL.filter(({ sql }) => /^drop\s+trigger[^;]*product_availability_lifecycle/i.test(sql))).toEqual([]);
  });

  it("keeps product_stock_signal callable, which PostgREST needs", () => {
    // The sibling function from 022 resolves the computed relationship behind
    // /admin/products' stock filter, so its default execute stays.
    expect([...executeGrants("product_stock_signal").keys()]).toEqual([]);
  });

  it("closes the unused RPC that append_whatsapp_pending_media exposed", () => {
    const grants = executeGrants("append_whatsapp_pending_media");

    for (const role of ["public", "anon", "authenticated"]) {
      expect([...(grants.get(role) ?? [])]).toEqual([]);
    }
    expect(grants.get("service_role")).toContain("execute");
  });
});

// ── 4. Tables with RLS on and no policy are server-only ───────────────

/** Source files that talk to Supabase from the browser, and the tables they
 *  name. Anything reachable with the anon key from a user's browser has to be
 *  a table whose policies were written for that. */
function browserTableReads(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== "__tests__") walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const source = readFileSync(path, "utf8");
      // The lazy loader (@/lib/supabase/browser) hands out the same anon client.
      if (!/from "@\/lib\/supabase\/(client|browser)"/.test(source)) continue;
      const tables = [...source.matchAll(/\.from\(\s*"([a-z_]+)"\s*\)/g)].map((m) => m[1]);
      if (tables.length > 0) found.set(path.replace(/\\/g, "/"), [...new Set(tables)]);
    }
  };
  walk(resolve("src"));
  return found;
}

describe("the deny-all tables are server-only", () => {
  it("is only carts and profiles that a browser client reads", () => {
    const reads = [...new Set([...browserTableReads().values()].flat())].sort();

    // Every other table either has no policy at all (service-role only) or a
    // policy written for the server's cookie-less anon reads. A new browser
    // read of one of those would silently return nothing under RLS — or, if
    // someone "fixed" that with a policy, hand it to every signed-in customer.
    expect(reads).toEqual(["carts", "profiles"]);
  });

  it("does not reach them through the browser client's rpc either", () => {
    const sources = [...browserTableReads().keys()].map((file) => readFileSync(file, "utf8"));

    for (const source of sources) expect(source).not.toMatch(/\.rpc\(/);
  });
});
