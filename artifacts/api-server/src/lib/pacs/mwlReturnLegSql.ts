// SQL fragments for the modality-worklist return leg: booking → worklist file →
// modality → C-STORE arrival → link back to the row that was booked.
//
// They live outside the route handlers so a real PostgreSQL can execute them in
// a test. Every mock-based test in this repo stayed green while the two defects
// these fragments pin were live: `status = ANY(('a','b'))` made the worklist
// feed answer HTTP 500 for every multi-status filter, and a raw `OR` inside an
// `and()` lost its parentheses, so the ultrasound demographic fallback read
// every USG row in the database instead of the arriving patient's.
import { inArray, or, sql, type Column, type SQL } from "drizzle-orm";
import { radiologyStudiesTable } from "@workspace/db/schema";
import { isXrayModality, XRAY_MODALITY_CODES } from "../clinicPeakHours";
import { isUltrasoundModality } from "../usgModality";

/** A column reference, or a caller-supplied expression over a stand-in row. */
export type MwlSqlColumn = Column | SQL;

/**
 * MWL status token → the internal statuses the feed returns.
 *
 * `ALL` means "every status a modality may still be asked about": everything
 * except cancelled, because a cancelled order must never reach a film printer or
 * a worklist feed. It used to omit the reported/delivered statuses entirely,
 * which is exactly the state a film printed after the exam is in.
 */
export function mwlOrdersInternalStatuses(mwlStatus: string): string[] {
  switch (mwlStatus) {
    case "ALL":
      return ["scheduled", "in_progress", "acquired", "reported_preliminary", "reported_final", "delivered"];
    case "COMPLETED":
      return ["acquired", "reported_preliminary", "reported_final", "delivered"];
    case "IN_PROGRESS":
      return ["in_progress"];
    case "CANCELLED":
      return ["cancelled"];
    default:
      return ["scheduled"];
  }
}

/**
 * `status in (…)` — deliberately `inArray`, never `` sql`${col} = ANY(${array})` ``:
 * drizzle renders a bare array parameter as a parenthesised value list, so
 * `status = ANY(($1,$2))` reached Postgres and every multi-status filter (ALL,
 * COMPLETED) failed with HTTP 500.
 */
export function mwlOrdersStatusCondition(
  statuses: string[],
  statusColumn: MwlSqlColumn = radiologyStudiesTable.status,
): SQL {
  return inArray(statusColumn as Column, statuses);
}

/**
 * Tier 4 of the intake matcher: patient + study date + modality, used only when
 * the accession and StudyInstanceUID tiers both missed, and only if exactly one
 * row comes back.
 *
 * Two of the three arms are wider than a literal equality because what the
 * console sends is not what the bill desk booked:
 * - plain film is booked `CR` and arrives `DX` (measured on the live PACS: 33 DX
 *   arrivals over two days, zero CR), so both codes are one queue here, exactly
 *   as in `clinicPeakHours.XRAY_MODALITY_CODES`;
 * - ultrasound rows are also found through `department = 'usg'`, for the studies
 *   whose modality column never got normalised.
 *
 * Each arm is parenthesised by `or()`, never by a bare `OR` inside a template:
 * drizzle parenthesises the whole conjunction but not an inserted fragment, so
 * an un-parenthesised `OR` escapes the caller's patient and date guards and
 * matches another patient's study.
 */
export function mwlTier4ModalityCondition(
  modality: string,
  columns: { modality?: MwlSqlColumn; department?: MwlSqlColumn } = {},
): SQL {
  const modalityColumn = columns.modality ?? radiologyStudiesTable.modality;
  if (isUltrasoundModality(modality)) {
    const departmentColumn = columns.department ?? radiologyStudiesTable.department;
    return or(
      sql`lower(${modalityColumn}) in ('us', 'usg', 'ultrasound')`,
      sql`lower(${departmentColumn}) = 'usg'`,
    )!;
  }
  if (isXrayModality(modality)) {
    return inArray(sql`lower(${modalityColumn})`, XRAY_MODALITY_CODES.map((m) => m.toLowerCase()));
  }
  return sql`lower(${modalityColumn}) = lower(${modality})`;
}
