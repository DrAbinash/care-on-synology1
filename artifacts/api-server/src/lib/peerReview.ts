/**
 * peerReview.ts
 * Phase 2 — Peer review workflow for radiology reports.
 * Assigns second-read radiologists and tracks review outcomes.
 */
import { db } from "@workspace/db";
import {
  radiologyReportVerificationsTable,
  radiologyStudiesTable,
  radiologistWorkloadsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export async function createVerificationRecord(studyId: number): Promise<typeof radiologyReportVerificationsTable.$inferSelect> {
  const [existing] = await db
    .select()
    .from(radiologyReportVerificationsTable)
    .where(eq(radiologyReportVerificationsTable.studyId, studyId));
  if (existing) return existing;

  const [row] = await db
    .insert(radiologyReportVerificationsTable)
    .values({ studyId, status: "pending_prelim" })
    .returning();
  return row;
}

export async function assignPeerReviewer(studyId: number, reviewerId: number): Promise<void> {
  const [study] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, studyId));
  if (!study) throw new Error("Study not found");

  await db
    .update(radiologyReportVerificationsTable)
    .set({ peerReviewerId: reviewerId, updatedAt: new Date() })
    .where(eq(radiologyReportVerificationsTable.studyId, studyId));

  await db
    .update(radiologyStudiesTable)
    .set({ assignedRadiologistId: reviewerId, updatedAt: new Date() })
    .where(eq(radiologyStudiesTable.id, studyId));
}

export async function recordPrelimReport(studyId: number, radiologistId: number, reportText: string): Promise<void> {
  await db
    .update(radiologyStudiesTable)
    .set({
      prelimReport: reportText,
      prelimReportedBy: String(radiologistId),
      prelimReportedAt: new Date(),
      status: "reported_preliminary",
      updatedAt: new Date(),
    })
    .where(eq(radiologyStudiesTable.id, studyId));

  await db
    .update(radiologyReportVerificationsTable)
    .set({ status: "prelim_ready", prelimBy: radiologistId, prelimAt: new Date(), updatedAt: new Date() })
    .where(eq(radiologyReportVerificationsTable.studyId, studyId));
}

export async function recordPeerReview(studyId: number, reviewerId: number, notes?: string): Promise<void> {
  await db
    .update(radiologyReportVerificationsTable)
    .set({
      status: "peer_review",
      peerReviewerId: reviewerId,
      peerReviewedAt: new Date(),
      peerReviewNotes: notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(radiologyReportVerificationsTable.studyId, studyId));
}

export async function verifyReport(studyId: number, verifierId: number): Promise<void> {
  await db
    .update(radiologyReportVerificationsTable)
    .set({ status: "verified", verifiedBy: verifierId, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(radiologyReportVerificationsTable.studyId, studyId));
}

export async function finalizeReport(studyId: number, radiologistId: number, reportText: string): Promise<void> {
  await db
    .update(radiologyStudiesTable)
    .set({
      finalReport: reportText,
      finalReportedBy: String(radiologistId),
      finalReportedAt: new Date(),
      status: "reported_final",
      updatedAt: new Date(),
    })
    .where(eq(radiologyStudiesTable.id, studyId));

  await db
    .update(radiologyReportVerificationsTable)
    .set({ status: "final", finalBy: radiologistId, finalAt: new Date(), updatedAt: new Date() })
    .where(eq(radiologyReportVerificationsTable.studyId, studyId));
}

export async function getVerificationQueue(status?: string) {
  const conds = [];
  if (status) conds.push(eq(radiologyReportVerificationsTable.status, status));
  const rows = await db
    .select()
    .from(radiologyReportVerificationsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(radiologyReportVerificationsTable.updatedAt))
    .limit(100);
  return rows;
}
