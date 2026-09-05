import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / email-confirmation / password-reset landing.
 *
 * Supabase redirects here with `?code=...` (PKCE). We exchange it for a
 * session (sets the auth cookies) and forward the visitor on. `next` is
 * validated to a same-origin path so it can't be turned into an open
 * redirect.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/account";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//")
    ? rawNext
    : "/account";

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/signin?error=${encodeURIComponent("Sign-in link was invalid or expired.")}`,
  );
}
