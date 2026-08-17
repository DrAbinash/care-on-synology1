import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Overnight AI drain reachability.
//
// HTTP enqueue (queue-selected / night batch / DICOM arrival) can fill
// dicom_retry_queue even when the minute consumer never claims. Diagnostics
// used to report worker:"healthy" from ENABLE_SCHEDULERS + staleRunning===0.
// This pins: the consumer starts outside that gate, a CRON_SECRET trigger
// exists, and compose still plumbs ENABLE_SCHEDULERS.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..");

const indexSrc = readFileSync(join(__dirname, "index.ts"), "utf8");
const cronSrc = readFileSync(join(__dirname, "cron.ts"), "utf8");
const internalCronSrc = readFileSync(join(__dirname, "routes", "internal-cron.ts"), "utf8");
const compose = readFileSync(join(REPO, "docker-compose.yml"), "utf8");

describe("overnight AI consumer is reachable without ENABLE_SCHEDULERS", () => {
  test("index.ts starts the consumer after the ENABLE_SCHEDULERS else-branch", () => {
    const gate = indexSrc.indexOf('process.env["ENABLE_SCHEDULERS"]');
    const consumer = indexSrc.indexOf("startRadiologyJobConsumer()");
    expect(gate).toBeGreaterThan(-1);
    expect(consumer).toBeGreaterThan(gate);
    const elseLog = indexSrc.indexOf("Cron schedulers disabled");
    expect(elseLog).toBeGreaterThan(gate);
    expect(consumer).toBeGreaterThan(elseLog);
  });

  test("cron.ts exports the drain and registers it idempotently", () => {
    expect(cronSrc).toContain("export function startRadiologyJobConsumer");
    expect(cronSrc).toContain("export async function fireRadiologyJobTick");
    expect(cronSrc).toContain("if (radiologyJobConsumerStarted) return");
    expect(cronSrc).toContain("markRadiologyJobConsumerRegistered");
  });

  test("internal-cron exposes POST /radiology-jobs behind CRON_SECRET", () => {
    const guardAt = internalCronSrc.indexOf("router.use(requireCronSecret)");
    expect(guardAt).toBeGreaterThan(-1);
    const routeAt = internalCronSrc.indexOf('router.post("/radiology-jobs"');
    expect(routeAt).toBeGreaterThan(guardAt);
    expect(internalCronSrc).toContain("fireRadiologyJobTick");
  });

  test("compose still injects ENABLE_SCHEDULERS into care-api", () => {
    expect(compose).toContain("ENABLE_SCHEDULERS: ${ENABLE_SCHEDULERS:-}");
  });
});
