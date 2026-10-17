/**
 * The disc-level spinal canal AP diameter table.
 *
 * ONE builder for every signed and previewed surface: the draft print-preview
 * (`radiology-report-generator.ts`), the clinical body of a radiology report as
 * it is created on the legacy path (`patient-reports.ts POST /`), and the
 * structured (D1) final and amendment bodies via the shared preparers. Before
 * this file existed the table was drawn inline in the preview handler only, so a
 * measurement a radiologist entered printed on the draft and then stopped
 * existing — the signed print, the signed PDF, the email share and the PACS
 * archive all render `patient_reports.body`, and that body had no table in it.
 *
 * The signed side stores the table rather than re-deriving it at render time,
 * because a signed report is a historical document: `spinal_measurements` keeps
 * being editable while the study is open again (withdrawal → correction), and a
 * renderer that reads it live would let a later measurement rewrite a document
 * that has already been signed and possibly delivered.
 *
 * TWO STORES, ONE AUTHORITY. The measurement the radiologist sees and edits is
 * the canonical record in the draft (`structured_json.careCanalApProvenance`,
 * written by the Reporting Workspace grid and by the viewer capture);
 * `spinal_measurements` is where the legacy generator page and the AI-tab box
 * store rows. Both are read, and the record decides: `canalApValue` is the only
 * function allowed to answer "what number goes in the report", so a manual
 * override is never silently replaced by the caliper it overrode, and a level the
 * record declines to answer (alias conflict, renumbered vertebra) prints nothing
 * rather than the other store's older guess. Levels that exist only in
 * `spinal_measurements` still print, so nothing that printed before stops.
 *
 * The level vocabulary and the column plan come from `@workspace/measurements` —
 * the same list the reporting workspace renders, shared with every other printed
 * surface. This used to carry its own copy, which is how the printed sheet kept
 * offering a C1-C2 column that no table upstream could ever fill. The fixed lists
 * are the ROUTINE levels; a transitional vertebra offers more (`L5-T`, `L5-L6`,
 * `L6-S1`) and those keys are printed too, because a measurement the grid accepts,
 * saves and restores must not be silently absent from the report. And a study that
 * measured more than one segment prints ONE table covering every segment it
 * measured — the table no longer picks a favourite and drops the rest.
 *
 * Two output formats, one set of numbers: HTML for the legacy composed body and
 * the preview, plain text for the D1 body, which is text by contract
 * (`structuredReport/renderer.ts` emits no HTML). A table that differed between
 * them would be two different clinical answers on two surfaces.
 */
import { desc, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { radiologyReportDraftsTable, spinalMeasurementsTable } from "@workspace/db/schema";
import {
  canalPrintPlan,
  canonicalizeCanalLevel,
  canonicalizeCanalMap,
  canalApValue,
  hasRenderedCanalApTable,
  stripUnmeasuredCanalScaffold,
} from "@workspace/measurements";
import { escapeHtml } from "./reportPresentation";
import { extractCareCanalApProvenance } from "./structuredJsonColumn";

/** The number as printed. Whitespace-trimmed text in, text out — never a parse
 *  that could turn an unmeasured cell into a `0`. */
function printValue(raw: number | string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (typeof raw === "number" && !Number.isFinite(raw)) return null;
  return s;
}

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
    const value = printValue(r.canalAP);
    if (!value) continue;
    byLevel.set(canonOf(r.vertebraLevel ?? ""), value);
  }
  return byLevel;
}

/**
 * The canonical canal record of the study's own draft, for a caller that has no
 * draft row in scope.
 *
 * The legacy create-report route composes the signed body without ever reading
 * `radiology_report_drafts`, so it could not see the grid's numbers at all. Every
 * other caller already holds the draft and passes its `structured_json` in —
 * reading it twice, or reading a different draft, would be its own bug.
 */
export async function loadCanalApProvenanceForStudy(
  studyKeys: readonly (number | null | undefined)[],
): Promise<unknown> {
  const keys = [...new Set(studyKeys.filter((k): k is number => k != null))];
  if (keys.length === 0) return null;
  try {
    const [draft] = await db
      .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
      .from(radiologyReportDraftsTable)
      .where(inArray(radiologyReportDraftsTable.studyId, keys))
      .orderBy(desc(radiologyReportDraftsTable.updatedAt))
      .limit(1);
    return extractCareCanalApProvenance(draft?.structuredJson);
  } catch {
    // A draft that cannot be read must not take the report down: the table then
    // falls back to the rows this study has in spinal_measurements.
    return null;
  }
}

/**
 * The same examination's canonical record, level by level.
 *
 * `null` is an answer, not an absence: it means the draft HAS a record for that
 * level and the record refuses to report a number (two aliases disagreeing, or a
 * vertebra that moved under it). Callers must not treat it as "no opinion" and
 * fall back to the other store — that is how a declined measurement would end up
 * printed anyway.
 */
export function canalApLevelsFromCanonicalRecord(raw: unknown): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const { records } = canonicalizeCanalMap(raw as Record<string, unknown>);
  for (const [level, rec] of Object.entries(records)) {
    out.set(level, printValue(canalApValue(rec)));
  }
  return out;
}

/**
 * Fold the two stores into the one map the table prints from.
 *
 * The canonical record wins; a `null` from it deletes the level (the record
 * declined, so nothing prints); a level only `spinal_measurements` knows keeps
 * its row. Pure, so the same fold is available to the preview, the legacy
 * finalize and the D1 preparers without a second implementation.
 */
export function mergeCanalApLevels(
  serverByLevel: ReadonlyMap<string, string>,
  canonicalByLevel: ReadonlyMap<string, string | null>,
): Map<string, string> {
  const merged = new Map<string, string>(serverByLevel);
  for (const [level, value] of canonicalByLevel) {
    if (value === null) merged.delete(level);
    else merged.set(level, value);
  }
  return merged;
}

/**
 * Lays out and prints the canal table for one examination.
 *
 * The columns come from `canalPrintPlan` in `@workspace/measurements` — the same plan
 * every surface uses — so a study that measured levels in more than one segment prints
 * ONE combined table carrying all of them. This replaces the old habit of picking the
 * most-filled segment, which silently dropped every level of the other segment: a
 * Dorso-Lumbar study with three lumbar and one dorsal measurement printed a LUMBAR
 * table with no dorsal row at all (owner DECISION 1, 2026-10-17).
 */
export function renderCanalApTable(
  byLevel: ReadonlyMap<string, string>,
): { title: string; html: string; text: string } | null {
  const plan = canalPrintPlan(byLevel.keys());
  if (!plan) return null;
  const levels = plan.levels;
  const { title } = plan;
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
    text: `${title}\n${levels.map((l) => `${l}: ${byLevel.get(l) || "—"}`).join("   ")} (mm)`,
  };
}

/** The table markup for one examination, or "" when it has no measured levels.
 *  Missing measurements must never stop a report from rendering.
 *
 *  `canonicalProvenance` is the draft's `careCanalApProvenance` — pass the record
 *  every caller already holds. Omit it only where no draft is in scope. */
export async function buildSpinalCanalApTableHtml(
  studyKeys: readonly (number | null | undefined)[],
  canonicalProvenance?: unknown,
): Promise<string> {
  return canalApRender(studyKeys, canonicalProvenance, "html");
}

/** The same numbers in the plain-text form the structured (D1) body uses. */
export async function buildSpinalCanalApTextBlock(
  studyKeys: readonly (number | null | undefined)[],
  canonicalProvenance?: unknown,
): Promise<string> {
  return canalApRender(studyKeys, canonicalProvenance, "text");
}

async function canalApRender(
  studyKeys: readonly (number | null | undefined)[],
  canonicalProvenance: unknown,
  format: "html" | "text",
): Promise<string> {
  try {
    const merged = mergeCanalApLevels(
      await loadCanalApLevelsByLevel(studyKeys),
      canalApLevelsFromCanonicalRecord(canonicalProvenance),
    );
    if (merged.size === 0) return "";
    const table = renderCanalApTable(merged);
    return table ? table[format] : "";
  } catch {
    return "";
  }
}

const IMPRESSION_HEADING = /<div class="section-heading">\s*Impression\s*<\/div>/i;
/** The D1 body's heading: `IMPRESSION:` / `Impression:` at the start of a line. */
const IMPRESSION_TEXT_HEADING = /(^|\n)[ \t]*IMPRESSION[ \t]*:/i;

/**
 * Splices the table into a composed clinical body where the draft preview puts
 * it — after Findings, before Impression — and never twice.
 *
 * Three cases, and the middle one is why this function exists:
 *
 *  - the body already carries a canal table that REPORTS a measurement (an
 *    AI-tab table the radiologist inserted, a hand-composed grid, or a body this
 *    route already spliced) → returned byte-untouched, because two grids naming
 *    one level with two numbers is the defect the whole path exists to kill;
 *  - the body carries a canal grid with nothing in it — the clinic's own
 *    LS-Spine template ships `Canal Diameter:` over a grid of dashes — → that
 *    placeholder is replaced by the real table rather than left beside it;
 *  - the body only MENTIONS a canal diameter in prose → the table is added. It
 *    used not to be: the old guard matched the PHRASE `CANAL AP DIAMETER`
 *    anywhere in the body, so a report whose Findings said "Canal AP diameter
 *    8 mm." signed with no table at all, including for a level measured after the
 *    prose was generated (owner DECISION 2, 2026-10-17).
 *
 * Handles both body formats the clinic signs: the legacy HTML body and the
 * plain-text D1 body. `insertCanalTableIntoBody("")` is inert, so a study with no
 * measurements leaves the body byte-identical.
 */
export function insertCanalTableIntoBody(bodyHtml: string, tableHtml: string): string {
  if (!tableHtml) return bodyHtml;
  const withoutPlaceholder = stripUnmeasuredCanalScaffold(bodyHtml);
  if (hasRenderedCanalApTable(withoutPlaceholder)) return bodyHtml;
  // HTML first: a composed body can mention "impression:" in prose, and a prose
  // match must not mis-place the table in a body that has real headings.
  if (IMPRESSION_HEADING.test(withoutPlaceholder)) {
    return withoutPlaceholder.replace(IMPRESSION_HEADING, (heading) => `${tableHtml}\n${heading}`);
  }
  const textHeading = withoutPlaceholder.match(IMPRESSION_TEXT_HEADING);
  if (textHeading) {
    const at = textHeading.index ?? 0;
    return `${withoutPlaceholder.slice(0, at)}\n${tableHtml}\n${withoutPlaceholder.slice(at).replace(/^\n/, "")}`;
  }
  return withoutPlaceholder ? `${withoutPlaceholder}\n${tableHtml}` : tableHtml;
}
