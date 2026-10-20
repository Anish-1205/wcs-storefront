import { defineConfig } from "vitest/config";
import path from "node:path";

// Real-PostgreSQL ingestion replay (needs the local disposable cluster, see
// ingest-eval/README.md). Kept out of the default `npm test` on purpose.
export default defineConfig({
  test: {
    include: ["ingest-eval/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 1_800_000,
    hookTimeout: 300_000,
    // Near-duplicate hashing stops at INGEST_HASH_TIMEOUT_MS and keeps whatever
    // it finished (src/lib/whatsapp-visual.ts): right in production, but on a
    // loaded CI runner two replays of one stream could then curate differently.
    // The maximum budget keeps the replay's outcome independent of machine load.
    env: { INGEST_HASH_TIMEOUT_MS: "15000" },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
