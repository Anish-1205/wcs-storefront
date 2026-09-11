import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiProvider } from "@/lib/ai/types";

const mockAssertAdmin = vi.hoisted(() => vi.fn());
const mockGetAiProvider = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-auth", () => ({ assertAdmin: mockAssertAdmin }));
vi.mock("@/lib/ai", () => ({ getAiProvider: mockGetAiProvider }));

import { detectVariantColor } from "@/app/admin/variant-color-actions";

function fakeProvider(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    name: "fake",
    isConfigured: () => true,
    suggestProductMetadata: vi.fn().mockResolvedValue(null),
    classifyCollection: vi.fn().mockResolvedValue([]),
    suggestColorVariants: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("detectVariantColor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when the caller isn't an admin (assertAdmin rejects)", async () => {
    mockAssertAdmin.mockRejectedValue(new Error("Unauthorized"));
    await expect(detectVariantColor(["https://img/1.jpg"])).rejects.toThrow("Unauthorized");
  });

  it("returns null for an empty image list without calling the provider", async () => {
    mockAssertAdmin.mockResolvedValue({ user: {}, admin: {} });
    const provider = fakeProvider();
    mockGetAiProvider.mockReturnValue(provider);

    const result = await detectVariantColor([]);
    expect(result).toBeNull();
    expect(provider.suggestColorVariants).not.toHaveBeenCalled();
  });

  it("returns null when AI isn't configured", async () => {
    mockAssertAdmin.mockResolvedValue({ user: {}, admin: {} });
    mockGetAiProvider.mockReturnValue(fakeProvider({ isConfigured: () => false }));

    const result = await detectVariantColor(["https://img/1.jpg"]);
    expect(result).toBeNull();
  });

  it("returns the single cluster's colour when everything groups together", async () => {
    mockAssertAdmin.mockResolvedValue({ user: {}, admin: {} });
    mockGetAiProvider.mockReturnValue(
      fakeProvider({
        suggestColorVariants: vi.fn().mockResolvedValue([
          { color: "wine", color_hex: "#7b2b3a", asset_client_upload_ids: ["0", "1", "2"], confidence: 0.9, is_best_display: true },
        ]),
      }),
    );

    const result = await detectVariantColor(["u1", "u2", "u3"]);
    expect(result).toEqual({ color: "wine", color_hex: "#7b2b3a" });
  });

  it("picks the cluster covering the MOST images as the majority colour, not the highest confidence or is_best_display one", async () => {
    mockAssertAdmin.mockResolvedValue({ user: {}, admin: {} });
    mockGetAiProvider.mockReturnValue(
      fakeProvider({
        suggestColorVariants: vi.fn().mockResolvedValue([
          { color: "wine", color_hex: "#7b2b3a", asset_client_upload_ids: ["0"], confidence: 0.95, is_best_display: true },
          { color: "mustard", color_hex: "#c99a2e", asset_client_upload_ids: ["1", "2", "3"], confidence: 0.8, is_best_display: false },
        ]),
      }),
    );

    const result = await detectVariantColor(["u1", "u2", "u3", "u4"]);
    expect(result).toEqual({ color: "mustard", color_hex: "#c99a2e" });
  });

  it("degrades to null (never throws) when the provider errors", async () => {
    mockAssertAdmin.mockResolvedValue({ user: {}, admin: {} });
    mockGetAiProvider.mockReturnValue(
      fakeProvider({ suggestColorVariants: vi.fn().mockRejectedValue(new Error("timeout")) }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await detectVariantColor(["u1"]);
    expect(result).toBeNull();
    warn.mockRestore();
  });

  it("returns null when the provider can't tell any colour apart", async () => {
    mockAssertAdmin.mockResolvedValue({ user: {}, admin: {} });
    mockGetAiProvider.mockReturnValue(fakeProvider({ suggestColorVariants: vi.fn().mockResolvedValue([]) }));

    const result = await detectVariantColor(["u1"]);
    expect(result).toBeNull();
  });
});
