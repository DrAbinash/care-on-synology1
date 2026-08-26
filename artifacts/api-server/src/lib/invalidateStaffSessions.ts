import { db } from "@workspace/db";
import { portalSessionsTable } from "@workspace/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { invalidateStaffAuthCache } from "../middleware/requireStaffAuth";

/**
 * Invalidate staff portal sessions after a credential change (PIN reset /
 * self PIN change). Stolen bearer tokens must stop working once the PIN
 * that authorized them is no longer valid.
 *
 * @param keepToken When set (self-service PIN change), that session stays
 *   alive so the caller is not bounced mid-flow. All other sessions for the
 *   user are deleted and their auth-cache entries cleared. When omitted
 *   (admin PIN reset), every staff session for the user is revoked.
 */
export async function invalidateStaffSessionsForUser(
  userId: number,
  opts?: { keepToken?: string },
): Promise<number> {
  const sessions = await db
    .select({ token: portalSessionsTable.token })
    .from(portalSessionsTable)
    .where(and(
      eq(portalSessionsTable.scope, "staff"),
      eq(portalSessionsTable.subjectId, userId),
    ));

  let revoked = 0;
  for (const s of sessions) {
    if (opts?.keepToken && s.token === opts.keepToken) continue;
    invalidateStaffAuthCache(s.token);
    revoked += 1;
  }

  if (opts?.keepToken) {
    await db.delete(portalSessionsTable).where(and(
      eq(portalSessionsTable.scope, "staff"),
      eq(portalSessionsTable.subjectId, userId),
      ne(portalSessionsTable.token, opts.keepToken),
    ));
  } else {
    await db.delete(portalSessionsTable).where(and(
      eq(portalSessionsTable.scope, "staff"),
      eq(portalSessionsTable.subjectId, userId),
    ));
  }

  return revoked;
}
