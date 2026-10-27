/**
 * worklistDateFilter.ts — date bounds for `radiology_worklist.study_date`.
 *
 * That column is free text (`lib/db/src/schema/radiologyWorklist.ts:23`) and
 * carries whatever shape the source that wrote it used. Two live writers, two
 * shapes: modality/Orthanc intake stores the DICOM StudyDate verbatim
 * (`YYYYMMDD`, `routes/internal-radiology.ts:819`) and CARE's own day-stamping
 * writes an ISO calendar day (`YYYY-MM-DD`, `radiology.ts:220` and `:1334` on
 * `radiology_studies`, which the worklist rows are matched against).
 *
 * Converting the *parameter* to compact and comparing the raw column lexically
 * against it is wrong twice over:
 *
 *   • a dashed row never reaches a compact bound — `'2026-10-11' >= '20261011'`
 *     is false, because `-` is not `1`; and
 *   • `-` (0x2D) sorts before `0` (0x30), so EVERY compact row compares greater
 *     than EVERY dashed row. A range over a column that mixes the two does not
 *     narrow by date at all — it partitions by format.
 *
 * Nothing surfaces this. The study is simply not in the queue, so "Today" reads
 * as an empty day and the radiologist concludes nobody sent anything.
 *
 * The stored representation is deliberately left alone: it is text that several
 * readers already normalize in their own way (`lib/ai/studyAgeWindow.ts`
 * `parseStudyDateInstant`, `lib/pacs/nameReferralLink.ts`
 * `normalizeStudyDateIso`, and on the client
 * `diagnostic-erp/src/lib/dateRangePresets.ts` `studyDateToISO`), and rewriting
 * a clinic column needs a migration plan and a forward-upgrade proof, not a
 * filter change. What this module adds is the comparison those readers already
 * make — the first eight digits of the value, on both sides — so the bound and
 * the row always live in the same space.
 */
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * The stored value reduced to `YYYYMMDD`, or NULL when it does not hold a date.
 *
 * `case … end` without an `else` yields NULL, which makes both comparisons NULL
 * and therefore excludes the row — the same verdict the old filter reached for a
 * NULL study_date, and the right one: a row with no date cannot be shown to be
 * inside a date range.
 */
function canonDay(col: SQLWrapper): SQL {
  const digits = sql`regexp_replace(${col}::text, '[^0-9]', '', 'g')`;
  return sql`(case when length(${digits}) >= 8 then left(${digits}, 8) end)`;
}

/**
 * `2026-10-11`, `20261011`, `2026/10/11` or a full timestamp → `20261011`.
 * Anything holding fewer than eight digits is not a day and returns null.
 */
export function compactStudyDateDay(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 8);
  return digits.length === 8 ? digits : null;
}

export type WorklistDateBounds = {
  /** Inclusive lower bound, YYYY-MM-DD (or any form of a day). */
  dateFrom?: string | null;
  /** Inclusive upper bound. */
  dateTo?: string | null;
  /** Single day; takes precedence over the range, as the callers already do. */
  exact?: string | null;
};

/**
 * Conditions to AND into a worklist query. Empty when no bound was asked for.
 *
 * A bound that is present but unparseable yields `false`, not "no condition":
 * silently widening a filter the operator did ask for is how a date-scoped
 * queue ends up showing the whole archive.
 */
export function worklistDateConditions(
  col: SQLWrapper,
  bounds: WorklistDateBounds,
): SQL[] {
  const day = (v: string | null | undefined) => compactStudyDateDay(v);
  const asked = (v: string | null | undefined) => Boolean(v && v.trim());
  const out: SQL[] = [];

  if (asked(bounds.exact)) {
    const exact = day(bounds.exact);
    out.push(exact ? sql`${canonDay(col)} = ${exact}` : sql`false`);
    return out;
  }
  if (asked(bounds.dateFrom)) {
    const from = day(bounds.dateFrom);
    out.push(from ? sql`${canonDay(col)} >= ${from}` : sql`false`);
  }
  if (asked(bounds.dateTo)) {
    const to = day(bounds.dateTo);
    out.push(to ? sql`${canonDay(col)} <= ${to}` : sql`false`);
  }
  return out;
}
