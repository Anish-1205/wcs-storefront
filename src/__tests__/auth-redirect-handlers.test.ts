import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ target: "", push: vi.fn(), index: 0 }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useRef: (v: unknown) => ({ current: v }), useState: (v: unknown) => [["test@example.invalid", "password123"][mocks.index++] ?? v, vi.fn()] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }), useSearchParams: () => ({ get: (key: string) => key === "error" ? null : mocks.target }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithPassword: async () => ({ error: null }) } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { exchangeCodeForSession: async () => ({ error: null }) } }) }));
import AdminLoginPage from "@/app/admin/login/page";
import { AuthForm } from "@/components/auth/AuthForm";
import { GET } from "@/app/auth/callback/route";
function form(element: ReactElement<any>): ReactElement<any> | undefined {
  if (element.type === "form") return element;
  // Admin's private LoginForm is inside its Suspense wrapper.
  if (typeof element.type === "function" && element.type.name === "LoginForm") return form((element.type as any)());
  for (const child of [element.props.children].flat(Infinity)) {
    if (child && typeof child === "object" && "props" in child) { const found = form(child); if (found) return found; }
  }
}
beforeEach(() => { vi.clearAllMocks(); mocks.index = 0; });
it.each(["javascript:alert(1)", "//evil.invalid", "/\\evil.invalid", "/%5cevil.invalid", "https://evil.invalid"])("F24 blocks %j in admin, customer and callback handlers", async (target) => {
  mocks.target = target;
  await form(AdminLoginPage())!.props.onSubmit({ preventDefault() {} });
  expect(mocks.push).toHaveBeenLastCalledWith("/admin");
  mocks.index = 0;
  await form(AuthForm({ mode: "signin" }))!.props.onSubmit({ preventDefault() {} });
  expect(mocks.push).toHaveBeenLastCalledWith("/account");
  const response = await GET(new NextRequest(`https://store.invalid/auth/callback?code=test&next=${encodeURIComponent(target)}`));
  expect(response.headers.get("location")).toBe("https://store.invalid/account");
});
