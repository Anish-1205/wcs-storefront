import { describe, expect, it, vi } from "vitest";
import { analyticsAllowed, CONSENT_KEY, consentRequired, readConsent, shouldAskForConsent, writeConsent } from "@/lib/consent";

describe("analytics consent (T4.2)", () => {
  it("is off unless NEXT_PUBLIC_CONSENT_REQUIRED=1, and then analytics waits for 'granted'", () => {
    expect(consentRequired(undefined)).toBe(false);
    expect(consentRequired("1")).toBe(true);
    expect(analyticsAllowed(false, null)).toBe(true); // today's behaviour
    expect(analyticsAllowed(true, null)).toBe(false);
    expect(analyticsAllowed(true, "denied")).toBe(false);
    expect(analyticsAllowed(true, "granted")).toBe(true);
  });

  it("asks only when required and undecided", () => {
    expect(shouldAskForConsent(true, null)).toBe(true);
    expect(shouldAskForConsent(true, "denied")).toBe(false);
    expect(shouldAskForConsent(false, null)).toBe(false);
  });

  it("reads and writes the choice, surviving storage that throws", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readConsent(storage)).toBeNull();
    writeConsent("granted", storage);
    expect(store.get(CONSENT_KEY)).toBe("granted");
    expect(readConsent(storage)).toBe("granted");
    store.set(CONSENT_KEY, "maybe");
    expect(readConsent(storage)).toBeNull();
    const throwing = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } };
    expect(readConsent(throwing)).toBeNull();
    expect(() => writeConsent("denied", throwing)).not.toThrow();
  });

  it("announces the change so the loader can react", () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    try {
      writeConsent("granted", { setItem: () => {} });
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect((dispatch.mock.calls[0][0] as CustomEvent).detail).toBe("granted");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
