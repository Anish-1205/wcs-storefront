import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lintMigration } from "../../scripts/check-migrations.mjs";

describe("migration lint (T6.3)", () => {
  it("flags non-additive statements", () => {
    expect(lintMigration("alter table products drop column name;")).toEqual(["DROP COLUMN"]);
    expect(lintMigration("drop table if exists contacts;")).toEqual(["DROP TABLE"]);
    expect(lintMigration("alter table a rename to b;")).toEqual(["RENAME"]);
    expect(lintMigration("alter table a alter column x type bigint;")).toEqual(["ALTER COLUMN … TYPE"]);
    expect(lintMigration("alter table a alter column x set not null;")).toEqual(["SET NOT NULL"]);
    expect(lintMigration("create table t(); delete from t;")).toEqual(["DELETE"]);
    expect(lintMigration("truncate inquiries;")).toEqual(["TRUNCATE"]);
  });

  it("ignores function bodies, comments, and the additive replace patterns", () => {
    expect(lintMigration("create function f() returns void language sql as $$ delete from t where at < now() $$;")).toEqual([]);
    expect(lintMigration("-- we never drop table x here\ncreate index if not exists i on t(c);")).toEqual([]);
    expect(lintMigration("alter table t drop constraint if exists c; alter table t add constraint c check (true); drop policy if exists p on t;")).toEqual([]);
  });

  it("an approved destructive migration says so explicitly", () => {
    expect(lintMigration("-- destructive-approved: owner sign-off 2026-11-01\ndrop table old_thing;")).toEqual([]);
  });

  it("every migration from 034 on passes", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f >= "034" && f.endsWith(".sql"));
    for (const file of files) expect(lintMigration(readFileSync(`supabase/migrations/${file}`, "utf8")), file).toEqual([]);
  });
});
