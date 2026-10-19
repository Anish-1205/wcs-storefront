import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ assertAdmin: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ assertAdmin: mocks.assertAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/admin/actions", () => ({
  toResult: async (fn: () => Promise<unknown>) => {
    try { return { ok: true, ...(await fn()) as object }; } catch (error) { return { ok: false, error: (error as Error).message }; }
  },
}));

import { setAiKillSwitch } from "@/app/admin/ai-usage-actions";

beforeEach(() => {
  mocks.assertAdmin.mockReset();
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
});

describe("setAiKillSwitch (T2.9)", () => {
  it("requires an admin before touching the database", async () => {
    mocks.assertAdmin.mockRejectedValue(new Error("Unauthorized"));
    expect(await setAiKillSwitch(true)).toEqual({ ok: false, error: "Unauthorized" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("flips the switch, and can clear a spend-limit pause", async () => {
    mocks.assertAdmin.mockResolvedValue({ admin: { rpc: mocks.rpc } });
    expect(await setAiKillSwitch(true)).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("ai_set_kill_switch", { p_on: true, p_clear_pause: false });
    await setAiKillSwitch(false, true);
    expect(mocks.rpc).toHaveBeenLastCalledWith("ai_set_kill_switch", { p_on: false, p_clear_pause: true });
  });

  it("rejects a non-boolean from a hand-made request", async () => {
    mocks.assertAdmin.mockResolvedValue({ admin: { rpc: mocks.rpc } });
    expect(await setAiKillSwitch("yes" as unknown as boolean)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
