"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { toResult, type ActionResult } from "@/app/admin/actions";

/** Turns every AI call off (or back on). Turning it on can also clear a spend-limit pause. */
export async function setAiKillSwitch(on: boolean, clearPause = false): Promise<ActionResult> {
  return toResult(async () => {
    const { admin } = await assertAdmin();
    if (typeof on !== "boolean" || typeof clearPause !== "boolean") throw new Error("Invalid request.");
    const { error } = await admin.rpc("ai_set_kill_switch", { p_on: on, p_clear_pause: clearPause });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/ai-usage");
    return {};
  });
}
