/**
 * The disc-level spinal canal AP diameter table.
 *
 * ONE builder for two surfaces: the draft print-preview
 * (`radiology-report-generator.ts`) and the clinical body of a radiology report
 * as it is created (`patient-reports.ts POST /`). Before this file existed the
 * table was drawn inline in the preview handler only, so a measurement a
 * radiologist entered printed on the draft and then stopped existing — the
 * signed print, the signed PDF, the email share and the PACS archive all render
 * `patient_reports.body`, and that body had no table in it.
 *
 * The signed side stores the table rather than re-deriving it at render time,
 * because a signed report is a historical document: `spinal_measurements` keeps
 * being editable while the study is open again (withdrawal → correction), and a
 * renderer that reads it live would let a later measurement rewrite a document
 * that has already been signed and possibly delivered.
 *
 * The level vocabulary comes from `@workspace/measurements` — the same list the
 * reporting workspace renders. This used to carry its own copy, which is how the
 * printed sheet kept offering a C1-C2 column that no table upstream could ever
 * fill.
 */
import { inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { spinalMeasurementsTable } from "@workspace/db/schema";
import {
  DORSAL_JUNCTION_LEVEL,
  canalLevelsForSegment,
  canonicalizeCanalLevel,
} from "@workspace/measurements";
import { escapeHtml } from "./reportPresentation";

const SEGMENTS = ["lumbar", "cervical", "dorsal"] as const;
type Segment = (typeof SEGMENTS)[number];

/**
 * Reads the canal rows for one examination.
 *
 * `studyKeys` must be ordered MOST-PREFERRED FIRST. One study legitimately has
 * two ids: the reporting workspace keys canal rows by
 * `radiology_worklist.study_id` (the billed study) and, when the study has no
 * billed link, by the worklist row id — while `save-draft` stores the worklist
 * ROW id in `radiology_report_drafts.study_id`. Reading only one of the two
 * silently produced an empty table for every linked study, so both are read and
 * the earlier key wins where they disagree. Never whichever row Postgres
 * happened to return first.
 */
export async function loadCanalApLevelsByLevel(studyKeys: readonly (number | null | undefined)[]): Promise<Map<string, string>> {
  const keys = [...new Set(studyKeys.filter((k): k is number => k != null))];
  const byLevel = new Map<string, string>();
  if (keys.length === 0) return byLevel;
  const rows = await db
    .select({
      studyId: spinalMeasurementsTable.studyId,
      vertebraLevel: spinalMeasurementsTable.vertebraLevel,
      canalAP: spinalMeasurementsTable.canalAP,
    })
    .from(spinalMeasurementsTable)
    .where(inArray(spinalMeasurementsTable.studyId, keys));
  const canonOf = (raw: string) => canonicalizeCanalLevel(raw) ?? raw;
  // Least-preferred key first, so the preferred key's value overwrites it.
  const rankOf = (k: number | null) => {
    const i = k == null ? -1 : keys.indexOf(k);
    return i < 0 ? keys.length : i;
  };
  const orderedRows = [...rows].sort((a, b) => rankOf(b.studyId) - rankOf(a.studyId));
  for (const r of orderedRows) {
    const value = r.canalAP?.trim();
    if (!value) continue;
    byLevel.set(canonOf(r.vertebraLevel ?? ""), value);
  }
  return byLevel;
}

/**
 * Picks the segment to print and lays its levels out in the catalogue's order,
 * so the printed order is the rail's, not the database's.
 */
export function renderCanalApTable(byLevel: ReadonlyMap<string, string>): { title: string; html: string } | null {
  const levelsFor = (segment: Segment) => {
    const base = [...canalLevelsForSegment(segment)];
    if (segment === "dorsal" && byLevel.has(DORSAL_JUNCTION_LEVEL)) {
      base.push(DORSAL_JUNCTION_LEVEL);
    }
    return base;
  };
  const filled = (segment: Segment) => levelsFor(segment).filter((l) => byLevel.has(l)).length;
  const counts = SEGMENTS.map(filled);
  const best = SEGMENTS[counts.indexOf(Math.max(...counts))];
  // The most-filled segment is the one to print. This used to index `counts`
  // with the largest COUNT instead of asking whether it is above zero, so a
  // lumbar report's [n,0,0] read `counts[n]` — a dorsal slot, always 0 — and
  // the table was dropped however many levels had been measured.
  const levels = Math.max(...counts) > 0 ? levelsFor(best) : [];
  if (!levels.some((l) => byLevel.has(l))) return null;
  const title = `${best.toUpperCase()} CANAL AP DIAMETER AT ${levels[0]?.split("-")[0]} TO ${levels[levels.length - 1]
    ?.split("-")
    .slice(1)
    .join("-")} LEVELS`;
  const th = levels.map((l) => `<th style="border:1px solid #000;padding:2px 6px;font-size:11px;">${escapeHtml(l)}</th>`).join("");
  const td = levels
    .map((l) => `<td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">${escapeHtml(byLevel.get(l) || "—")}</td>`)
    .join("");
  return {
    title,
    html: `<div class="section-heading">${escapeHtml(title)}</div>
<table style="border-collapse:collapse;margin:0 0 8px;width:auto;">
  <thead><tr><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">LEVEL</th>${th}</tr></thead>
  <tbody><tr><td style="border:1px solid #000;padding:2px 6px;font-size:11px;">AP (mm)</td>${td}</tr></tbody>
</table>`,
  };
}

/** The table markup for one examination, or "" when it has no measured levels.
 *  Missing measurements must never stop a report from rendering. */
export async function buildSpinalCanalApTableHtml(
  studyKeys: readonly (number | null | undefined)[],
): Promise<string> {
  try {
    const byLevel = await loadCanalApLevelsByLevel(studyKeys);
    if (byLevel.size === 0) return "";
    return renderCanalApTable(byLevel)?.html ?? "";
  } catch {
    return "";
  }
}

const CANAL_TABLE_IN_BODY = /CANAL AP DIAMETER/i;
const IMPRESSION_HEADING = /<div class="section-heading">\s*Impression\s*<\/div>/i;

/**
 * Splices the table into a composed clinical body where the draft preview puts
 * it — after Findings, before Impression — and never twice. A body that already
 * carries the table (a client that composes one, or a re-created row) is
 * returned untouched.
 */
export function insertCanalTableIntoBody(bodyHtml: string, tableHtml: string): string {
  if (!tableHtml) return bodyHtml;
  if (CANAL_TABLE_IN_BODY.test(bodyHtml)) return bodyHtml;
  if (!IMPRESSION_HEADING.test(bodyHtml)) return bodyHtml ? `${bodyHtml}\n${tableHtml}` : tableHtml;
  return bodyHtml.replace(IMPRESSION_HEADING, (heading) => `${tableHtml}\n${heading}`);
}
