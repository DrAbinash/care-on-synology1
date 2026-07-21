/**
 * operationsHistory.ts — persist + read recent Deployment Smoke Test runs
 * (Phase 6). Stores only already-redacted per-check summaries; never PHI or
 * secrets. Retention is bounded to the newest RETENTION rows on every write.
 */
import { db } from "@workspace/db";
import { operationalHealthRunsTable } from "@workspace/db/schema";
import { desc, sql } from "drizzle-orm";
import type { OpsHealthReport } from "./operationsHealth";

export const OPS_HISTORY_RETENTION = 200;

export interface RecordRunInput {
  report: OpsHealthReport;
  runId: string;
  initiatedBy?: string | null;
}

/** Compact, safe per-check summary stored in checks_json. */
function compactChecks(report: OpsHealthReport) {
  return report.checks.map((c) => ({
    id: c.id, name: c.name, category: c.category, status: c.status,
    message: c.message, durationMs: c.durationMs, recommendedAction: c.recommendedAction ?? null,
  }));
}

export async function recordOpsRun(input: RecordRunInput): Promise<void> {
  const { report, runId } = input;
  const finishedAt = new Date(report.generatedAt);
  const startedAt = new Date(finishedAt.getTime() - report.durationMs);
  const errorSummary =
    report.checks.filter((c) => c.status === "FAIL").map((c) => `${c.id}: ${c.message}`).join(" | ").slice(0, 1000) || null;

  await db.insert(operationalHealthRunsTable).values({
    runId,
    trigger: report.trigger,
    overallStatus: report.overall,
    version: report.version.version,
    gitCommit: report.version.commit,
    startedAt,
    finishedAt,
    durationMs: report.durationMs,
    summaryJson: report.summary,
    checksJson: compactChecks(report),
    initiatedBy: input.initiatedBy ?? null,
    errorSummary,
  });

  // Bounded retention — keep only the newest OPS_HISTORY_RETENTION rows.
  await db.execute(sql`
    DELETE FROM operational_health_runs
    WHERE id NOT IN (SELECT id FROM operational_health_runs ORDER BY id DESC LIMIT ${OPS_HISTORY_RETENTION})
  `);
}

export async function recentOpsRuns(limit = 20) {
  const n = Math.min(Math.max(Math.floor(limit) || 20, 1), 100);
  return db.select().from(operationalHealthRunsTable).orderBy(desc(operationalHealthRunsTable.id)).limit(n);
}
