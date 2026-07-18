/**
 * Provisional report versioning — P3 completion patch.
 * Regeneration creates a NEW version (never overwrites). Pure `nextProvisionalVersion`
 * is unit-tested; the DB helper (lazy imports, so the pure fn stays DB-free) reads
 * the current max for a study.
 */

/** Next monotonic version given the existing version numbers for a study. */
export function nextProvisionalVersion(existingVersions: number[]): number {
  if (existingVersions.length === 0) return 1;
  return Math.max(...existingVersions) + 1;
}

/** DB-backed: the next version for a study's provisional report. */
export async function getNextProvisionalVersion(studyInstanceUid: string): Promise<number> {
  const { db } = await import("@workspace/db");
  const { aiShadowDraftsTable } = await import("@workspace/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const [row] = await db
    .select({ maxV: sql<number>`coalesce(max(${aiShadowDraftsTable.version}), 0)::int` })
    .from(aiShadowDraftsTable)
    .where(eq(aiShadowDraftsTable.studyInstanceUid, studyInstanceUid));
  return (row?.maxV ?? 0) + 1;
}
