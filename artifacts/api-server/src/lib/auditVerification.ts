/**
 * auditVerification.ts — Ticket BEND-1 Phase 7: operational audit-chain
 * verification.
 *
 * Wires the EXISTING verifiers (lib/audit verifyChainRows — previously
 * reachable only from tests) into an operational service that:
 *
 *  - verifies previousHash LINKAGE (full chain or a bounded recent window),
 *  - RECOMPUTES each row's chainHash with the supported app recipe
 *    (canonicalHashPayload → sha256) and classifies rows explicitly:
 *      · app-recipe verified     — recomputation matches (tamper-evident)
 *      · legacy-recipe           — linkage intact but the hash was produced
 *        by the boot-time SQL backfill (jsonb_build_object recipe) — these
 *        are DECLARED, never silently counted as verified
 *      · suspicious              — recomputation mismatch on a row NEWER
 *        than app-recipe rows already seen (a tampered app row would look
 *        like this) → WARN, never a false "healthy"
 *  - persists every result to radiology_ops_checks so health reports
 *    last-verified time + outcome instead of guessing.
 *
 * NEVER reseals or rewrites anything — detection only. A broken chain stays
 * broken and drives health to UNHEALTHY.
 */

import { db } from "@workspace/db";
import { auditLogsTable, radiologyOpsChecksTable } from "@workspace/db/schema";
import { asc, desc, sql } from "drizzle-orm";
import {
  canonicalHashPayload, computeChainHash, verifyChainRows,
  type AuditChainVerification,
} from "./audit";

export interface AuditRowClassification {
  appRecipeVerified: number;
  legacyRecipeRows: number;
  suspicious: number;
  suspiciousIds: number[];
}

/** Pure classification over per-row recompute outcomes (ordered by id ASC).
 *  A mismatching row that appears AFTER app-recipe rows have been seen is
 *  suspicious — legitimate legacy backfill rows precede app-written history. */
export function classifyRecipeRows(rows: Array<{ id: number; recomputeMatches: boolean }>): AuditRowClassification {
  let appRecipeVerified = 0;
  let legacyRecipeRows = 0;
  const suspiciousIds: number[] = [];
  let seenAppRecipe = false;
  for (const row of rows) {
    if (row.recomputeMatches) {
      appRecipeVerified += 1;
      seenAppRecipe = true;
    } else if (seenAppRecipe) {
      suspiciousIds.push(row.id);
    } else {
      legacyRecipeRows += 1;
    }
  }
  return { appRecipeVerified, legacyRecipeRows, suspicious: suspiciousIds.length, suspiciousIds: suspiciousIds.slice(0, 20) };
}

export interface AuditVerificationReport {
  ok: boolean;
  status: "pass" | "warn" | "fail";
  mode: "full" | "window";
  checked: number;
  linkage: AuditChainVerification;
  classification: AuditRowClassification;
  ranAt: string;
}

function recomputeMatches(row: {
  userId: number | null; userName: string; role: string | null; action: string;
  module: string; entityType: string | null; entityId: string | null;
  oldValue: string | null; newValue: string | null; reason: string | null;
  ipAddress: string | null; userAgent: string | null; createdAt: Date;
  previousHash: string; chainHash: string;
}): boolean {
  try {
    const payload = canonicalHashPayload({
      userId: row.userId,
      userName: row.userName,
      role: row.role ?? "system",
      action: row.action,
      module: row.module,
      entityType: row.entityType,
      entityId: row.entityId,
      oldValue: row.oldValue,
      newValue: row.newValue,
      reason: row.reason,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: new Date(row.createdAt).toISOString(),
      previousHash: row.previousHash,
    });
    return computeChainHash(payload) === row.chainHash;
  } catch {
    return false;
  }
}

/** Run a verification and persist the result. mode "window" (default) reads
 *  the most recent `limit` rows; "full" walks the whole chain from genesis. */
export async function runAuditChainVerification(
  opts: { mode?: "full" | "window"; limit?: number; ranBy?: string } = {},
): Promise<AuditVerificationReport> {
  const mode = opts.mode ?? "window";
  const limit = Math.max(100, Math.min(opts.limit ?? 5000, 200_000));

  let rows;
  if (mode === "full") {
    rows = await db.select().from(auditLogsTable).orderBy(asc(auditLogsTable.id));
  } else {
    const recent = await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.id)).limit(limit);
    rows = recent.reverse();
  }

  const linkage = verifyChainRows(
    rows.map((r) => ({ id: r.id, previousHash: r.previousHash, chainHash: r.chainHash })),
    { window: mode === "window" },
  );
  const classification = classifyRecipeRows(
    rows.map((r) => ({ id: r.id, recomputeMatches: recomputeMatches(r) })),
  );

  const status: "pass" | "warn" | "fail" = !linkage.ok
    ? "fail"
    : classification.suspicious > 0
      ? "warn"
      : "pass";

  const report: AuditVerificationReport = {
    ok: linkage.ok,
    status,
    mode,
    checked: rows.length,
    linkage,
    classification,
    ranAt: new Date().toISOString(),
  };

  await db.insert(radiologyOpsChecksTable).values({
    checkName: "audit_chain",
    status,
    ranBy: opts.ranBy ?? "system",
    detail: {
      mode, checked: rows.length,
      firstBrokenId: linkage.firstBrokenId, reason: linkage.reason,
      appRecipeVerified: classification.appRecipeVerified,
      legacyRecipeRows: classification.legacyRecipeRows,
      suspicious: classification.suspicious,
      suspiciousIds: classification.suspiciousIds,
    },
  }).catch(() => undefined);

  return report;
}

/** Scheduled entry point (cron, daily) — safe default cadence: windowed over
 *  the most recent 5000 rows. */
export async function runScheduledAuditChainVerification(): Promise<void> {
  const report = await runAuditChainVerification({ mode: "window", limit: 5000, ranBy: "cron" });
  if (report.status !== "pass") {
    console.error("[audit-verify] NON-PASS result:", JSON.stringify({
      status: report.status, firstBrokenId: report.linkage.firstBrokenId,
      reason: report.linkage.reason, suspicious: report.classification.suspicious,
    }));
  }
}

/** Latest persisted result for a named ops check (health consumes this). */
export async function latestOpsCheck(checkName: string): Promise<{ status: string; ranAt: Date; detail: unknown } | null> {
  const [row] = await db
    .select()
    .from(radiologyOpsChecksTable)
    .where(sql`${radiologyOpsChecksTable.checkName} = ${checkName}`)
    .orderBy(desc(radiologyOpsChecksTable.id))
    .limit(1);
  return row ? { status: row.status, ranAt: row.ranAt, detail: row.detail } : null;
}
