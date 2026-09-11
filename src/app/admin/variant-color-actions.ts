"use server";

import { assertAdmin } from "@/lib/admin-auth";
import { getAiProvider } from "@/lib/ai";

export interface DetectedVariantColor {
  color: string;
  color_hex: string | null;
}

/**
 * Detects the majority/dominant colour across a variant's current photos —
 * used by the admin product form's manual colour-variant correction
 * workflow (drag an image between variants -> re-detect that variant's
 * colour). Reuses the exact same AiProvider.suggestColorVariants call the
 * /admin/import pipeline already uses for colour-variant clustering (see
 * docs/import-pipeline.md), not a new detection system: if the photos split
 * into more than one cluster (some visual variance within the variant), the
 * cluster covering the MOST photos is taken as the majority colour.
 *
 * Returns null (never throws to the caller) when AI isn't configured, there
 * are no images, or the provider couldn't produce a confident result — the
 * form simply leaves the colour fields as they are in that case.
 */
export async function detectVariantColor(imageUrls: string[]): Promise<DetectedVariantColor | null> {
  await assertAdmin();

  if (imageUrls.length === 0) return null;

  const aiProvider = getAiProvider();
  if (!aiProvider.isConfigured()) return null;

  const suggestions = await aiProvider
    .suggestColorVariants({
      adminDescription: null,
      images: imageUrls.map((url, index) => ({ client_upload_id: String(index), url })),
    })
    .catch((error) => {
      console.warn("detectVariantColor: AI provider failed", error instanceof Error ? error.message : error);
      return null;
    });

  if (!suggestions || suggestions.length === 0) return null;

  const majority = [...suggestions].sort(
    (a, b) => b.asset_client_upload_ids.length - a.asset_client_upload_ids.length,
  )[0];

  return { color: majority.color, color_hex: majority.color_hex };
}
