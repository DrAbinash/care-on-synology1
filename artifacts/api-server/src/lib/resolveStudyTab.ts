/**
 * Resolve Study Tab id + denormalized name for child catalog rows
 * (clinical history chips, protocols/technique).
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { radiologyStudyTabsTable } from "@workspace/db/schema";

export type ResolvedStudyTab = { id: number; name: string };

export async function resolveStudyTab(input: {
  studyTabId?: unknown;
  studyType?: unknown;
}): Promise<ResolvedStudyTab | null> {
  const rawId = Number(input.studyTabId);
  if (Number.isInteger(rawId) && rawId > 0) {
    const [byId] = await db
      .select({ id: radiologyStudyTabsTable.id, name: radiologyStudyTabsTable.name })
      .from(radiologyStudyTabsTable)
      .where(eq(radiologyStudyTabsTable.id, rawId));
    if (byId) return byId;
  }
  const name = String(input.studyType ?? "").trim();
  if (!name) return null;
  const [byName] = await db
    .select({ id: radiologyStudyTabsTable.id, name: radiologyStudyTabsTable.name })
    .from(radiologyStudyTabsTable)
    .where(sql`lower(trim(${radiologyStudyTabsTable.name})) = lower(trim(${name}))`);
  return byName ?? null;
}

/** Keep denormalized study_type in sync when a Study Tab is renamed. */
export async function syncChildStudyTypeForTabRename(tabId: number, newName: string): Promise<void> {
  const name = String(newName ?? "").trim();
  if (!Number.isInteger(tabId) || tabId <= 0 || !name) return;
  await db.execute(sql`
    UPDATE radiology_clinical_history_chips
    SET study_type = ${name}, updated_at = NOW()
    WHERE study_tab_id = ${tabId}
  `);
  await db.execute(sql`
    UPDATE radiology_protocols
    SET study_type = ${name}, updated_at = NOW()
    WHERE study_tab_id = ${tabId}
  `);
}
