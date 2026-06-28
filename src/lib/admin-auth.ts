import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export function isEmailAllowed(email: string | null | undefined) {
  const allowedEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return !!email && allowedEmails.includes(email.trim().toLowerCase());
}

/**
 * Verify an authenticated admin session in a Server Component / Server Action.
 * Redirects to login when absent. Returns the service-role admin client for
 * privileged reads/writes (RLS-bypassing) once the session is confirmed.
 */
export async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  if (!isEmailAllowed(user.email)) {
    await supabase.auth.signOut();
    redirect("/admin/login");
  }

  return { user, admin: createAdminClient() };
}

/** Like requireAdmin but throws instead of redirecting — for use inside actions. */
export async function assertAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  if (!isEmailAllowed(user.email)) {
    await supabase.auth.signOut();
    throw new Error("Forbidden");
  }

  return { user, admin: createAdminClient() };
}
