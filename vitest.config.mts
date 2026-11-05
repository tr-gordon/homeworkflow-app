import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // PGlite boots a WASM Postgres per test file; allow for slow first start.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
