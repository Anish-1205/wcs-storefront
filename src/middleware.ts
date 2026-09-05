import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Builds the CSP. script-src allows 'unsafe-inline' rather than nonces: the
 * only inline scripts anywhere in the app are the 3 fixed, developer-authored
 * analytics bootstraps in Analytics.tsx (no user input ever reaches a
 * <script> tag) — nonces would need next/headers in that component, which
 * is rendered by the root layout on every page, forcing the whole site out
 * of static/ISR rendering. The real script-src protection here is the host
 * allowlist: no *other* remote script can be loaded even with unsafe-inline.
 * Dev additionally needs 'unsafe-eval' for HMR/React Refresh.
 */
function buildCsp(isProd: boolean) {
  const scriptSrc = isProd
    ? `'self' 'unsafe-inline' https://www.googletagmanager.com https://www.clarity.ms https://s.pinimg.com`
    : `'self' 'unsafe-eval' 'unsafe-inline'`;
  // Dev only: the local Supabase CLI serves plain http on 127.0.0.1, and
  // Next's dev server needs a same-origin websocket for HMR — neither
  // applies in production (real Supabase is always https://*.supabase.co).
  const connectSrc = isProd
    ? `'self' https://*.supabase.co https://api.cloudinary.com https://www.google-analytics.com https://*.google-analytics.com https://*.clarity.ms https://*.pinterest.com`
    : `'self' https://*.supabase.co http://127.0.0.1:* ws://127.0.0.1:* ws://localhost:*`;

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://res.cloudinary.com https://images.unsplash.com`,
    `font-src 'self'`,
    `connect-src ${connectSrc}`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    isProd ? `upgrade-insecure-requests` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Edge auth guard for /admin/* routes, plus a site-wide CSP.
 * Refreshes the Supabase session cookie and redirects unauthenticated users
 * to the login page. layout.tsx provides a secondary defence-in-depth check.
 * The Supabase session lookup only runs for /admin paths — public pages get
 * the CSP header without paying for an auth round-trip.
 */
export async function middleware(req: NextRequest) {
  const csp = buildCsp(process.env.NODE_ENV === "production");
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/admin")) {
    const res = NextResponse.next({ request: req });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            req.cookies.set(name, value),
          );
          res = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLogin = pathname === "/admin/login";

  if (!user && !isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("redirect", pathname);
    const redirectRes = NextResponse.redirect(url);
    redirectRes.headers.set("Content-Security-Policy", csp);
    return redirectRes;
  }

  // Already signed in but visiting the login page → send to dashboard.
  if (user && isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    const redirectRes = NextResponse.redirect(url);
    redirectRes.headers.set("Content-Security-Policy", csp);
    return redirectRes;
  }

  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
