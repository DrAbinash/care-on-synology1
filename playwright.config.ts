import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
      command: "pnpm dev:erp-local",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: "development",
        DATABASE_URL: process.env.DATABASE_URL || "postgresql://erp:erp@127.0.0.1:5432/diagnostic_erp",
        JWT_SECRET: process.env.JWT_SECRET || "local-e2e-jwt-secret-change-me",
        SESSION_SECRET: process.env.SESSION_SECRET || "local-e2e-session-secret-change-me",
        ENABLE_SCHEDULERS: "0",
      },
    },
});
