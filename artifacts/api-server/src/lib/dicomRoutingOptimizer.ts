/**
 * dicomRoutingOptimizer.ts
 * Phase 4 — Intelligent DICOM routing optimization.
 * Decides whether to route studies locally or to a remote site
 * based on modality load, site capacity, and SLAs.
 */
import { db } from "@workspace/db";
import {
  dicomRoutingOptimizationLogTable,
  radiologistWorkloadsTable,
  radiologyStudiesTable,
  teleradiologySitesTable,
} from "@workspace/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export type RoutingDecision = "local" | "remote" | "load_balance";

// Thresholds for routing decisions
const LOCAL_LOAD_THRESHOLD = 10; // if local pending > 10, consider remote
const REMOTE_LOAD_THRESHOLD = 5; // if remote pending > 5, don't route there

export async function decideRouting(
  studyInstanceUid: string,
  modality: string,
  priority: string,
  sourceAeTitle?: string,
): Promise<{ decision: RoutingDecision; targetAeTitle: string | null; reason: string; loadFactor: number }> {
  // Check local workload
  const localPending = await db
    .select({ count: db.$count(radiologyStudiesTable.id) })
    .from(radiologyStudiesTable)
    .where(and(eq(radiologyStudiesTable.modality, modality), eq(radiologyStudiesTable.status, "scheduled")));
  const localCount = Number((localPending[0] as unknown as Record<string, unknown>)?.count ?? 0);

  // Check remote sites
  const sites = await db.select().from(teleradiologySitesTable).where(eq(teleradiologySitesTable.isActive, true));
  let bestSite: typeof teleradiologySitesTable.$inferSelect | null = null;
  let bestLoad = Infinity;

  for (const site of sites) {
    if (site.modalityList && !site.modalityList.split(",").map((m) => m.trim()).includes(modality)) continue;
    // Estimate remote load by count of synced studies for this site
    const remotePending = await db
      .select({ count: db.$count(radiologyStudiesTable.id) })
      .from(radiologyStudiesTable)
      .where(and(eq(radiologyStudiesTable.modality, modality), eq(radiologyStudiesTable.status, "scheduled")));
    const remoteCount = Number((remotePending[0] as unknown as Record<string, unknown>)?.count ?? 0);
    if (remoteCount < bestLoad && remoteCount < REMOTE_LOAD_THRESHOLD) {
      bestSite = site;
      bestLoad = remoteCount;
    }
  }

  let decision: RoutingDecision = "local";
  let targetAeTitle: string | null = null;
  let reason = "Local capacity available";

  if (localCount > LOCAL_LOAD_THRESHOLD && bestSite && bestLoad < REMOTE_LOAD_THRESHOLD) {
    decision = "remote";
    targetAeTitle = bestSite.aeTitle ?? bestSite.code;
    reason = `Local load ${localCount} > threshold ${LOCAL_LOAD_THRESHOLD}, routing to ${bestSite.name} (load ${bestLoad})`;
  } else if (localCount > LOCAL_LOAD_THRESHOLD && (!bestSite || bestLoad >= REMOTE_LOAD_THRESHOLD)) {
    decision = "load_balance";
    reason = `Local overloaded (${localCount}) but no suitable remote site available`;
  } else if (priority === "stat" || priority === "emergency") {
    decision = "local";
    reason = `STAT/Emergency study — kept local for fastest turnaround`;
  }

  const loadFactor = localCount + bestLoad;

  // Log the decision
  await db.insert(dicomRoutingOptimizationLogTable).values({
    studyInstanceUid,
    sourceAeTitle: sourceAeTitle ?? null,
    targetAeTitle,
    routingDecision: decision,
    reason,
    loadFactor,
  });

  return { decision, targetAeTitle, reason, loadFactor };
}

export async function getRoutingStats(hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(dicomRoutingOptimizationLogTable)
    .where(gte(dicomRoutingOptimizationLogTable.createdAt, since));

  const byDecision: Record<string, { count: number; success: number; failed: number }> = {};
  for (const r of rows) {
    const d = r.routingDecision;
    const entry = byDecision[d] ?? { count: 0, success: 0, failed: 0 };
    entry.count++;
    if (r.success) entry.success++; else entry.failed++;
    byDecision[d] = entry;
  }
  return { total: rows.length, byDecision, periodHours: hours };
}
