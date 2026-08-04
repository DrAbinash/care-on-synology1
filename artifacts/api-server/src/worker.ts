import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

process.env.TZ = "Asia/Kolkata";

const rootEnv = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.env",
);
dotenv.config({ path: rootEnv });

import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { startCronScheduler } from "./cron";
import { startIntegrationScheduler } from "./services/integration/scheduler";

async function main() {
  await pool.query("SELECT 1");
  startCronScheduler();
  startIntegrationScheduler();
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
