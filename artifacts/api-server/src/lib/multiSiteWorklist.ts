/**
 * multiSiteWorklist.ts
 * Phase 4 — Multi-site worklist aggregator for teleradiology.
 * Syncs studies across remote sites and resolves external accession numbers.
 */
import { db } from "@workspace/db";
import {
  radiologyMultiSiteWorklistTable,
  teleradiologySitesTable,
  radiologyStudiesTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function syncStudyToSite(studyId: number, siteId: number, externalAccession?: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(radiologyMultiSiteWorklistTable)
    .where(and(eq(radiologyMultiSiteWorklistTable.studyId, studyId), eq(radiologyMultiSiteWorklistTable.siteId, siteId)));

  if (existing) {
    await db
      .update(radiologyMultiSiteWorklistTable)
      .set({ syncStatus: "synced", lastSyncAt: new Date(), lastSyncError: null, updatedAt: new Date() })
      .where(eq(radiologyMultiSiteWorklistTable.id, existing.id));
  } else {
    await db.insert(radiologyMultiSiteWorklistTable).values({
      studyId,
      siteId,
      externalAccessionNumber: externalAccession ?? null,
      syncStatus: "synced",
      lastSyncAt: new Date(),
    });
  }
}

export async function markSyncFailed(studyId: number, siteId: number, error: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(radiologyMultiSiteWorklistTable)
    .where(and(eq(radiologyMultiSiteWorklistTable.studyId, studyId), eq(radiologyMultiSiteWorklistTable.siteId, siteId)));

  if (existing) {
    await db
      .update(radiologyMultiSiteWorklistTable)
      .set({ syncStatus: "failed", lastSyncError: error, updatedAt: new Date() })
      .where(eq(radiologyMultiSiteWorklistTable.id, existing.id));
  }
}

export async function getMultiSiteWorklist(siteId?: number): Promise<typeof radiologyMultiSiteWorklistTable.$inferSelect[]> {
  if (siteId) {
    return db
      .select()
      .from(radiologyMultiSiteWorklistTable)
      .where(eq(radiologyMultiSiteWorklistTable.siteId, siteId))
      .orderBy(desc(radiologyMultiSiteWorklistTable.updatedAt));
  }
  return db.select().from(radiologyMultiSiteWorklistTable).orderBy(desc(radiologyMultiSiteWorklistTable.updatedAt));
}

export async function getSites(): Promise<typeof teleradiologySitesTable.$inferSelect[]> {
  return db.select().from(teleradiologySitesTable).where(eq(teleradiologySitesTable.isActive, true));
}
