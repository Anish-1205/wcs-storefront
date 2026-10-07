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
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
