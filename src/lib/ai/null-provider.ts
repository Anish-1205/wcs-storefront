import type { AiProvider } from "./types";

/**
 * No-op provider used whenever no AI vendor is configured. Every import
 * pipeline call site is written to work correctly against this provider so
 * "AI unavailable" never blocks manual review — it only means the AI draft
 * panel stays empty and collection classification skips straight to whatever
 * deterministic evidence (if any) is available.
 */
export const nullAiProvider: AiProvider = {
  name: "none",
  isConfigured() {
    // Not configured, so callers take their deterministic path instead of an AI path that cannot answer
    // (WhatsApp naming used to compose a generic name from an empty AI answer). Its methods still return
    // null/[] so a caller that skips the check keeps working.
    return false;
  },
  async suggestProductMetadata() {
    return null;
  },
  async classifyCollection() {
    return [];
  },
  async suggestColorVariants() {
    return null;
  },
};
