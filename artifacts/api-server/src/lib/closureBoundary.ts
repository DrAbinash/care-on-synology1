/**
 * Shared closure-boundary helper.
 *
 * Single source of truth for "what is the most recent overall day-close
 * boundary?" — used by day-close.ts to compute the next open window, and by
 * bills.ts to warn staff when they refund a bill whose original creation
 * predates the most recent close (Approved Fix: "Refund Against Closed
 * Period Warning" — see DAILY_FINANCIAL_RECONCILIATION_SPECIFICATION.md
 * §22.5).
 *
 * IMPORTANT: this is informational only. Per the ERP's existing rule
 * (LOCKED BUSINESS RULE #10/#11), a refund against a closed period is never
 * blocked and never requires owner approval — it simply carries forward
 * into the next open reconciliation window automatically. This helper only
 * answers "should the staff member see a heads-up?", not "should this
 * be allowed?".
 */

import { db, dayClosuresTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

/**
 * Returns the `coveredToTs` of the most recent closed day-close row, or
 * `null` if the clinic has never closed a day. This is the boundary that
 * separates "already reconciled" activity from the currently-open window.
 */
export async function lastOverallClosureBoundary(): Promise<Date | null> {
  const [last] = await db
    .select({ coveredToTs: dayClosuresTable.coveredToTs })
    .from(dayClosuresTable)
    .where(eq(dayClosuresTable.status, "closed"))
    .orderBy(desc(dayClosuresTable.coveredToTs))
    .limit(1);
  return last?.coveredToTs ? new Date(last.coveredToTs) : null;
}

/**
 * True when `timestamp` falls at-or-before the most recent overall close
 * boundary — i.e. it belongs to an already-closed reconciliation period.
 * Pure comparison, exported separately so it's unit-testable without a DB.
 */
export function isBeforeClosureBoundary(timestamp: Date, boundary: Date | null): boolean {
  if (!boundary) return false;
  return timestamp.getTime() <= boundary.getTime();
}
