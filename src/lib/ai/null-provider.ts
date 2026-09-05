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
    return true; // always "ready" — it just does nothing.
  },
  async suggestProductMetadata() {
    return null;
  },
  async classifyCollection() {
    return [];
  },
};
