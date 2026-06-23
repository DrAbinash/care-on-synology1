import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "artifacts/*/src/**/*.test.ts",
      "bridge-service/src/**/*.test.js",
      "lib/**/*.test.ts",
    ],
    environment: "node",
  },
});
