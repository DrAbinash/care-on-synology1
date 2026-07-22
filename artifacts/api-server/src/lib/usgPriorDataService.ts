/**
 * usgPriorDataService — the LIVE data bridge for P4 prior-study intelligence
 * (final-integration wiring; not a pure core).
 *
 * Reads canonical tables (radiology_studies, usg_measurements, patient_reports)
 * and drives the merged P4 cores:
 *   - usgPriorMatch.matchPriorStudies        (same-patient-only prior selection)
 *   - usgStructuredComparison.compareMeasurements
 *   - usgComparisonText.buildComparisonSuggestions
 *   - usgPregnancyEpisodes.groupPregnancyEpisodes
 *   - usgPregnancyTimeline.buildPregnancyTimeline
 *
 * Cross-patient safety is doubly enforced: the SQL scopes candidates to the
 * current study's patientId, and matchPriorStudies drops any row whose
 * patientId differs. Comparison suggestions are read-only drafts — this service
 * never writes to a report or a draft.
 */

import { db } from "@workspace/db";
import { radiologyStudiesTable, usgMeasurementsTable, patientReportsTable } from "@workspace/db/schema";
import { and, eq, ne, desc } from "drizzle-orm";
import { matchPriorStudies, type StudyRef, type PriorMatch } from "./usgPriorMatch";
import { compareMeasurements, type MeasurementPoint, type ComparisonRow } from "./usgStructuredComparison";
import { buildComparisonSuggestions, type ComparisonSuggestion } from "./usgComparisonText";
import { groupPregnancyEpisodes, type ObScan, type PregnancyEpisode } from "./usgPregnancyEpisodes";
import { buildPregnancyTimeline, type TimelineScanInput, type PregnancyTimeline } from "./usgPregnancyTimeline";

const FINAL_REPORT_STATUSES = new Set(["final", "verified", "delivered", "signed", "finalized"]);

/** Numeric measurement fields we surface for comparison + timeline. */
const NUMERIC_FIELDS: { field: keyof typeof usgMeasurementsTable.$inferSelect; label: string; unit: string }[] = [
  { field: "bpd", label: "BPD", unit: "mm" },
  { field: "hc", label: "HC", unit: "mm" },
  { field: "ac", label: "AC", unit: "mm" },
  { field: "fl", label: "FL", unit: "mm" },
  { field: "crl", label: "CRL", unit: "mm" },
  { field: "efw", label: "EFW", unit: "g" },
  { field: "liquorAfi", label: "AFI", unit: "cm" },
  { field: "rightKidneyLengthMm", label: "Right kidney length", unit: "mm" },
  { field: "leftKidneyLengthMm", label: "Left kidney length", unit: "mm" },
  { field: "liverSpanMm", label: "Liver span", unit: "mm" },
  { field: "cbdMm", label: "CBD", unit: "mm" },
];

function num(v: unknown): number | null {
  if (v == null) return null;
  const m = String(v).match(/-?\d*\.?\d+/);
  return m ? parseFloat(m[0]) : null;
}

/** Latest approved (else latest) usg_measurements row for a study UID. */
async function latestMeasurementRow(studyInstanceUID: string) {
  const [approved] = await db.select().from(usgMeasurementsTable)
    .where(and(eq(usgMeasurementsTable.studyInstanceUID, studyInstanceUID), eq(usgMeasurementsTable.status, "approved")))
    .orderBy(desc(usgMeasurementsTable.reviewedAt)).limit(1);
  if (approved) return approved;
  const [latest] = await db.select().from(usgMeasurementsTable)
    .where(eq(usgMeasurementsTable.studyInstanceUID, studyInstanceUID))
    .orderBy(desc(usgMeasurementsTable.createdAt)).limit(1);
  return latest ?? null;
}

/** Convert a measurement row into canonical MeasurementPoints (numeric only). */
export function rowToMeasurementPoints(row: Record<string, unknown> | null): MeasurementPoint[] {
  if (!row) return [];
  const out: MeasurementPoint[] = [];
  for (const { field, label, unit } of NUMERIC_FIELDS) {
    const n = num(row[field as string]);
    if (n != null) out.push({ key: String(field), label, value: `${n} ${unit}`, unit });
  }
  return out;
}

/** Load a study row and its finalized-report status (if any). */
async function studyRefFor(studyId: number): Promise<StudyRef | null> {
  const [s] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId)).limit(1);
  if (!s) return null;
  const [rep] = await db.select({ status: patientReportsTable.status }).from(patientReportsTable)
    .where(eq(patientReportsTable.studyId, studyId)).orderBy(desc(patientReportsTable.id)).limit(1);
  return {
    studyInstanceUID: s.studyInstanceUid ?? String(s.id),
    patientId: s.patientId,
    modality: s.modality,
    studyType: s.studyDescription ?? null,
    bodyRegion: s.studyDescription ?? null,
    accessionNumber: s.accessionNumber ?? null,
    studyDate: s.studyDate ? String(s.studyDate) : null,
    reportStatus: rep?.status ?? null,
  };
}

export interface PriorStudyResult extends PriorMatch {
  studyId: number | null;
  hasFinalReport: boolean;
}

/** Find comparable prior studies for the current study (same patient only). */
export async function findPriorStudies(currentStudyId: number): Promise<PriorStudyResult[]> {
  const [current] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, currentStudyId)).limit(1);
  if (!current) return [];
  const currentRef = await studyRefFor(currentStudyId);
  if (!currentRef) return [];

  // SQL scopes to the same patient; matchPriorStudies re-enforces it.
  const rows = await db.select().from(radiologyStudiesTable)
    .where(and(eq(radiologyStudiesTable.patientId, current.patientId), ne(radiologyStudiesTable.id, currentStudyId)))
    .orderBy(desc(radiologyStudiesTable.studyDate)).limit(50);

  const idByUid = new Map<string, number>();
  const candidates: StudyRef[] = [];
  for (const r of rows) {
    const uid = r.studyInstanceUid ?? String(r.id);
    idByUid.set(uid, r.id);
    const [rep] = await db.select({ status: patientReportsTable.status }).from(patientReportsTable)
      .where(eq(patientReportsTable.studyId, r.id)).orderBy(desc(patientReportsTable.id)).limit(1);
    candidates.push({
      studyInstanceUID: uid, patientId: r.patientId, modality: r.modality,
      studyType: r.studyDescription ?? null, bodyRegion: r.studyDescription ?? null,
      accessionNumber: r.accessionNumber ?? null, studyDate: r.studyDate ? String(r.studyDate) : null,
      reportStatus: rep?.status ?? null,
    });
  }

  return matchPriorStudies(currentRef, candidates).map((m) => ({
    ...m,
    studyId: idByUid.get(m.study.studyInstanceUID) ?? null,
    hasFinalReport: FINAL_REPORT_STATUSES.has((m.study.reportStatus ?? "").toLowerCase()),
  }));
}

export interface ComparisonResult {
  currentStudyId: number;
  priorStudyId: number;
  intervalDays: number | null;
  rows: ComparisonRow[];
  suggestions: ComparisonSuggestion[];
}

/** Structured current-vs-prior comparison for two studies of the same patient. */
export async function compareStudies(currentStudyId: number, priorStudyId: number): Promise<ComparisonResult | { error: string }> {
  const [cur] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, currentStudyId)).limit(1);
  const [pri] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, priorStudyId)).limit(1);
  if (!cur || !pri) return { error: "study_not_found" };
  // Hard cross-patient guard at the data layer.
  if (cur.patientId !== pri.patientId) return { error: "cross_patient_comparison_blocked" };

  const curPoints = rowToMeasurementPoints(await latestMeasurementRow(cur.studyInstanceUid ?? String(cur.id)));
  const priPoints = rowToMeasurementPoints(await latestMeasurementRow(pri.studyInstanceUid ?? String(pri.id)));
  const intervalDays = cur.studyDate && pri.studyDate
    ? Math.round((Date.parse(String(cur.studyDate)) - Date.parse(String(pri.studyDate))) / 86_400_000)
    : null;

  const rows = compareMeasurements(curPoints, priPoints, { intervalDays });
  return { currentStudyId, priorStudyId, intervalDays, rows, suggestions: buildComparisonSuggestions(rows) };
}

export interface TimelineResult {
  episodes: PregnancyEpisode[];
  timeline: PregnancyTimeline;
}

/** Build the pregnancy timeline + episode grouping for a patient's OB scans. */
export async function pregnancyTimelineForPatient(patientId: number): Promise<TimelineResult> {
  const studies = await db.select().from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.patientId, patientId))
    .orderBy(radiologyStudiesTable.studyDate).limit(50);

  const scans: TimelineScanInput[] = [];
  const obScans: ObScan[] = [];
  for (const s of studies) {
    const uid = s.studyInstanceUid ?? String(s.id);
    const row = await latestMeasurementRow(uid);
    if (!row) continue;
    const studyDate = s.studyDate ? String(s.studyDate) : (row.studyDate ? String(row.studyDate) : null);
    if (!studyDate) continue;
    scans.push({
      studyInstanceUID: uid, studyDate,
      crlMm: num(row.crl), bpdMm: num(row.bpd), hcMm: num(row.hc), acMm: num(row.ac), flMm: num(row.fl),
      afiCm: num(row.liquorAfi), efwGrams: num(row.efw), lmp: null,
    });
    obScans.push({ studyInstanceUID: uid, studyDate, edd: (row.edd as string) ?? null, gaDays: null });
  }

  return { episodes: groupPregnancyEpisodes(obScans), timeline: buildPregnancyTimeline(scans) };
}
