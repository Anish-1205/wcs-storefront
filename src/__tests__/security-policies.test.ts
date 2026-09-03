import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
