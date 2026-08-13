import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "artifacts/diagnostic-erp/src"),
    },
  },
  test: {
    include: [
      "artifacts/*/src/**/*.test.ts",
      "bridge-service/src/**/*.test.js",
      "lib/**/*.test.ts",
      "scripts/**/*.test.cjs",
      "scripts/**/*.test.mjs",
    ],
    environment: "node",
  },
});
