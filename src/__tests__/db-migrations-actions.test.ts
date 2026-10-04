import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), connect: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ assertAdmin: mocks.admin }));
vi.mock("pg", () => ({ Client: mocks.connect }));
vi.mock("@/app/admin/actions", () => ({ toResult: async (fn: () => Promise<unknown>) => { try { return { ok: true, ...await fn() as object }; } catch (error) { return { ok: false, error: (error as Error).message }; } } }));
import { applyPendingMigrations } from "@/app/admin/db-migrations-actions";
it("F01 disables one-click apply before opening any database connection", async () => {
  mocks.admin.mockResolvedValue({});
  expect(await applyPendingMigrations()).toMatchObject({ ok: false, error: expect.stringContaining("disabled") });
  expect(mocks.admin).toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
});
