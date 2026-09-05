import type { AiProvider } from "./types";
import { nullAiProvider } from "./null-provider";
import { anthropicAiProvider } from "./anthropic-provider";

export * from "./types";

/**
 * Selects the active AI provider. Falls back to the null provider whenever
 * no vendor is configured — the import pipeline must remain fully usable
 * through manual review in that case, never blocked on AI availability.
 */
export function getAiProvider(): AiProvider {
  if (anthropicAiProvider.isConfigured()) return anthropicAiProvider;
  return nullAiProvider;
}
