import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

process.env.TZ = "Asia/Kolkata";

const rootEnv = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.env",
);
dotenv.config({ path: rootEnv });

// Bind clinic Ollama resolver before cron can claim overnight AI jobs.
import "./bootstrapLocalAi";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { startCronScheduler } from "./cron";
import { startIntegrationScheduler } from "./services/integration/scheduler";
import { bootStep, initializeDevIsolation } from "./devIsolationBoot";

// CARE_DEV_ISOLATED — this entrypoint starts cron WITHOUT reading
// ENABLE_SCHEDULERS, so "don't set the flag" was never a way to stop the worker.
// Imports are hoisted above dotenv, but `main()` is what issues the first query and
// it has not run yet at this point, so the check lands before any DB or socket use.
initializeDevIsolation();

async function main() {
  await pool.query("SELECT 1");
  bootStep("cronScheduler", () => startCronScheduler());
  bootStep("integrationScheduler", () => startIntegrationScheduler());
  logger.info("CARE background worker started (cron + integration schedulers)");
}

main().catch((err) => {
  logger.error({ err }, "CARE background worker failed to start");
  process.exit(1);
});

process.on("SIGTERM", async () => {
  logger.info("CARE background worker received SIGTERM");
  await pool.end().catch(() => undefined);
  process.exit(0);
});
