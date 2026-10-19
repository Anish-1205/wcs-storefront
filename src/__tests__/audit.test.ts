import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ from: () => ({ insert }) }) }));
const reportError = vi.fn();
vi.mock("@/lib/report-error", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

import { cleanAuditMeta, recordAudit } from "@/lib/audit";

beforeEach(() => {
  insert.mockReset().mockResolvedValue({ error: null });
  reportError.mockReset();
});

describe("admin audit log helper (T3.1)", () => {
  it("keeps ids, counts, enums and field names; drops personal data, secrets and odd keys", () => {
    expect(cleanAuditMeta({
      fields: ["name", "base_price_min"],
      count: 3,
      status: "published",
      slug: "red-saree",
      ship: true,
      phone: "919876543210",
      email: "a@b.co",
      contact_name: "Asha",
      message: "hello",
      api_key: "sk",
      password: "x",
      ip: "1.2.3.4",
      "Bad Key": 1,
      nested: { a: 1 },
      long: "x".repeat(500),
    })).toEqual({
      fields: ["name", "base_price_min"],
      count: 3,
      status: "published",
      slug: "red-saree",
      ship: true,
      long: "x".repeat(120),
    });
  });

  it("writes one row with the actor id, never throwing on failure", async () => {
    await recordAudit({ action: "product.delete", actorId: "u-1", entity: "product", entityId: "p-1", requestId: "r-1", meta: { slug: "x" } });
    expect(insert).toHaveBeenCalledWith({
      action: "product.delete", actor_id: "u-1", entity: "product", entity_id: "p-1", request_id: "r-1", meta: { slug: "x" },
    });
    insert.mockResolvedValue({ error: { message: "permission denied" } });
    await expect(recordAudit({ action: "product.delete" })).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), { scope: "admin-audit", action: "product.delete" });
    insert.mockRejectedValue(new Error("network"));
    await expect(recordAudit({ action: "product.delete" })).resolves.toBeUndefined();
  });
});
