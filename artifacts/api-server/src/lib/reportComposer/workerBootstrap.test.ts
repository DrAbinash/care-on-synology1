/**
 * Worker/cron production startup proof — ai_report_compose handler registration.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AI_REPORT_COMPOSE_JOB,
  RADIOLOGY_JOB_HANDLERS,
} from "../radiologyJobHandlers";
import {
  startAiReportComposeJobConsumer,
  startCronScheduler,
} from "../../cron";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../..");

function read(name: string): string {
  return readFileSync(join(SRC, name), "utf8");
}

describe("worker startup — ai_report_compose_handler registration", () => {
  it("RADIOLOGY_JOB_HANDLERS exports ai_report_compose handler", () => {
    expect(AI_REPORT_COMPOSE_JOB).toBe("ai_report_compose");
    expect(RADIOLOGY_JOB_HANDLERS[AI_REPORT_COMPOSE_JOB]).toBeTypeOf("function");
  });

  it("handler delegates to processComposeJob with composeJobId payload", () => {
    const handlers = read("lib/radiologyJobHandlers.ts");
    expect(handlers).toContain("[AI_REPORT_COMPOSE_JOB]");
    expect(handlers).toContain("processComposeJob(composeJobId)");
    expect(handlers).toContain("// Background text report composition — NEVER on overnight vision tick.");
  });

  it("worker.ts starts full cron scheduler (includes compose consumer)", () => {
    const worker = read("worker.ts");
    expect(worker).toContain('import { startCronScheduler } from "./cron"');
    expect(worker).toContain("startCronScheduler()");
    expect(worker).not.toMatch(/from ["']\.\/app["']/);
  });

  it("index.ts always registers compose consumer (not gated by ENABLE_SCHEDULERS)", () => {
    const index = read("index.ts");
    expect(index).toContain("startAiReportComposeJobConsumer()");
    const composeIdx = index.indexOf("startAiReportComposeJobConsumer()");
    const schedGate = index.indexOf('process.env["ENABLE_SCHEDULERS"]');
    expect(composeIdx).toBeGreaterThan(-1);
    expect(schedGate).toBeGreaterThan(-1);
    // Compose registration is OUTSIDE the ENABLE_SCHEDULERS block (before it).
    expect(composeIdx).toBeLessThan(schedGate);
  });

  it("startCronScheduler wires dedicated compose consumer", () => {
    expect(typeof startAiReportComposeJobConsumer).toBe("function");
    expect(typeof startCronScheduler).toBe("function");
    const cron = read("cron.ts");
    expect(cron).toContain("startAiReportComposeJobConsumer()");
    expect(cron).toContain("async function fireAiReportComposeTick");
  });
});
