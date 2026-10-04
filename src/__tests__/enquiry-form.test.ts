import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const mocks = vi.hoisted(() => ({ push: vi.fn(), states: [] as unknown[], analytics: vi.fn(), storage: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useRef: (v: unknown) => ({ current: v }), useState: (v: unknown) => [v, (next: unknown) => mocks.states.push(next)] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ items: [{ slug: "silk", title: "Silk", reference: "WCS-01", qty: 1, price: 1000, image: "/silk.jpg" }], hydrated: true, knownSubtotal: 1000 }) }));
vi.mock("@/lib/profile/useProfile", () => ({ EMPTY_PROFILE: {}, hasAnyValue: () => false, useProfile: () => ({ signedIn: false }) }));
vi.mock("@/lib/source-tracking", () => ({ getSource: () => "direct" }));
vi.mock("@/lib/analytics", () => ({ analytics: { inquirySubmit: mocks.analytics } }));
vi.mock("@/lib/whatsapp", () => ({ buildEnquiryWhatsAppURL: () => "https://wa.me/123", WHATSAPP_CONFIGURED: false }));
import { EnquiryForm } from "@/components/enquiry/EnquiryForm";
function findForm(element: ReactElement<any>): ReactElement<any> | undefined {
  if (element.type === "form") return element;
  for (const child of [element.props.children].flat(Infinity)) {
    if (child && typeof child === "object" && "props" in child) { const found = findForm(child); if (found) return found; }
  }
}
function submit() {
  const form = findForm(EnquiryForm())!;
  return form.props.onSubmit({ preventDefault() {}, currentTarget: {} });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.states.length = 0;
  vi.stubGlobal("sessionStorage", { setItem: mocks.storage });
  vi.stubGlobal("FormData", class { get(key: string) { return ({ name: "Asha", phone: "9876543210", city: "Delhi" } as Record<string,string>)[key] ?? ""; } });
});
afterEach(() => vi.unstubAllGlobals());
it.each([500, 429, 400])("F19 stays on the form after HTTP %i, preserves inputs and unlocks retry", async (status) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
  await submit();
  expect(mocks.push).not.toHaveBeenCalled(); expect(mocks.storage).not.toHaveBeenCalled();
  expect(mocks.analytics).not.toHaveBeenCalled();
  expect(mocks.states).toContainEqual(expect.stringContaining("could not confirm"));
  expect(mocks.states.at(-1)).toBe(false);
});
it("waits for confirmed persistence before storing success or navigating", async () => {
  let resolve!: (r: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
  const pending = submit();
  expect(mocks.push).not.toHaveBeenCalled(); expect(mocks.storage).not.toHaveBeenCalled();
  resolve(new Response(JSON.stringify({ ok: true })));
  await pending;
  expect(mocks.push).toHaveBeenCalledWith("/enquiry/sent"); expect(mocks.storage).toHaveBeenCalledOnce();
});
it("handles network failures and malformed success responses", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(new Response("not JSON")));
  await submit(); await submit();
  expect(mocks.push).not.toHaveBeenCalled();
});
