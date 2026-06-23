/**
 * tatTracker.ts
 * Phase 2 — Turn-around time (TAT) tracking for radiology studies.
 * Measures time from study_received to prelim/final per priority level.
 */
import { db } from "@workspace/db";
import {
  radiologyTatTrackingTable,
  radiologyStudiesTable,
} from "@workspace/db/schema";
import { eq, desc, gte, sql } from "drizzle-orm";

const SLA_MINUTES: Record<string, number> = {
  stat: 15,
  emergency: 30,
  urgent: 60,
  vip: 120,
  routine: 240,
};

export async function startTatTracking(studyId: number, priority: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(radiologyTatTrackingTable)
    .where(eq(radiologyTatTrackingTable.studyId, studyId));
  if (existing) return;

  await db.insert(radiologyTatTrackingTable).values({
    studyId,
    priority,
    studyReceivedAt: new Date(),
    slaMinutes: SLA_MINUTES[priority] ?? SLA_MINUTES.routine,
  });
}

export async function recordPrelimCompleted(studyId: number): Promise<void> {
  const [row] = await db
    .select()
    .from(radiologyTatTrackingTable)
    .where(eq(radiologyTatTrackingTable.studyId, studyId));
  if (!row) return;

  const now = new Date();
  const minutes = row.studyReceivedAt
    ? Math.round((now.getTime() - new Date(row.studyReceivedAt).getTime()) / 60000)
    : null;

  const slaBreached = minutes !== null && row.slaMinutes !== null && minutes > row.slaMinutes;

  await db
    .update(radiologyTatTrackingTable)
    .set({ prelimCompletedAt: now, prelimMinutes: minutes, slaBreached, updatedAt: now })
    .where(eq(radiologyTatTrackingTable.studyId, studyId));
}

export async function recordFinalCompleted(studyId: number): Promise<void> {
  const [row] = await db
    .select()
    .from(radiologyTatTrackingTable)
    .where(eq(radiologyTatTrackingTable.studyId, studyId));
  if (!row) return;

  const now = new Date();
  const minutes = row.studyReceivedAt
    ? Math.round((now.getTime() - new Date(row.studyReceivedAt).getTime()) / 60000)
    : null;

  const slaBreached = minutes !== null && row.slaMinutes !== null && minutes > row.slaMinutes;

  await db
    .update(radiologyTatTrackingTable)
    .set({ finalCompletedAt: now, finalMinutes: minutes, slaBreached, updatedAt: now })
    .where(eq(radiologyTatTrackingTable.studyId, studyId));
}

export async function getTatStats(days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(radiologyTatTrackingTable)
    .where(gte(radiologyTatTrackingTable.studyReceivedAt, since));

  const byPriority: Record<string, { count: number; avgPrelim: number; avgFinal: number; slaBreaches: number }> = {};
  for (const r of rows) {
    const p = r.priority || "routine";
    const entry = byPriority[p] ?? { count: 0, avgPrelim: 0, avgFinal: 0, slaBreaches: 0 };
    entry.count++;
    if (r.prelimMinutes) entry.avgPrelim += r.prelimMinutes;
    if (r.finalMinutes) entry.avgFinal += r.finalMinutes;
    if (r.slaBreached) entry.slaBreaches++;
    byPriority[p] = entry;
  }
  for (const p of Object.keys(byPriority)) {
    const e = byPriority[p];
    e.avgPrelim = e.count > 0 ? Math.round(e.avgPrelim / e.count) : 0;
    e.avgFinal = e.count > 0 ? Math.round(e.avgFinal / e.count) : 0;
  }
  return { total: rows.length, byPriority, periodDays: days };
}

export async function getTatForStudy(studyId: number): Promise<typeof radiologyTatTrackingTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(radiologyTatTrackingTable)
    .where(eq(radiologyTatTrackingTable.studyId, studyId));
  return row ?? null;
}
