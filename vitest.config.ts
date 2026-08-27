import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(repoRoot, "artifacts/diagnostic-erp/src"),
    },
  },
  test: {
    include: [
      "artifacts/*/src/**/*.test.ts",
      "bridge-service/src/**/*.test.js",
      "lib/**/*.test.ts",
      "scripts/**/*.test.cjs",
      "scripts/**/*.test.mjs",
      "scripts/src/**/*.test.ts",
    ],
    environment: "node",
  },
});
