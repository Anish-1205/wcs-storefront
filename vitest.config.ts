import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    // A few import-pipeline tests take seconds on a loaded machine, more under
    // coverage instrumentation; the 5 s default made them flake.
    testTimeout: 20_000,
    // T6.6: a ratchet on src/lib, 2-3 points under the baseline measured on
    // 2026-10-20 (statements 80.5, branches 75.2, functions 80.0, lines 81.5).
    // Raise it as coverage grows; never set it above what is measured.
    coverage: {
      include: ["src/lib/**"],
      thresholds: { statements: 78, branches: 72, functions: 77, lines: 79 },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
