/**
 * usgObDopplerService — LIVE data bridge for P5 OB & Doppler consolidation
 * (final-integration wiring; not a pure core).
 *
 * Reads canonical measurement rows and drives the merged P5 cores
 * (buildObSection / buildDopplerSection) over the ONE canonical obstetric
 * engine. It returns canonical `{ section, impression }` payloads for the
 * workspace to merge into radiology_report_drafts via the normal save-draft
 * path — it does NOT write a report or draft itself, and it surfaces the
 * canonical PCPNDT Form-F status for display only (never auto-fills Form F,
 * never emits fetal sex — the OB core cannot produce sex).
 */

import { db } from "@workspace/db";
import { radiologyStudiesTable, usgMeasurementsTable, usgDopplerMeasurementsTable } from "@workspace/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { buildObSection, type ObSectionInput, type ObSectionResult } from "./usgObSection";
import { buildDopplerSection, type DopplerVesselInput, type DopplerSectionResult } from "./usgDopplerSection";
import { checkPcpndtFormFCompliance } from "./pcpndtCompliance";
import { isObstetricUsgStudy } from "./usgModality";

function num(v: unknown): number | null {
  if (v == null) return null;
  const m = String(v).match(/-?\d*\.?\d+/);
  return m ? parseFloat(m[0]) : null;
}

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

async function studyRow(studyId: number) {
  const [s] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId)).limit(1);
  return s ?? null;
}

export interface ObSectionForStudy extends ObSectionResult {
  studyId: number;
  measurementSource: "approved" | "latest" | "none";
}

/** Build the canonical OB section for a study from its measurement row. */
export async function buildObSectionForStudy(studyId: number): Promise<ObSectionForStudy | { error: string }> {
  const s = await studyRow(studyId);
  if (!s) return { error: "study_not_found" };
  const uid = s.studyInstanceUid ?? String(s.id);
  const row = await latestMeasurementRow(uid);

  const fhrBpm = num(row?.fhr);
  const input: ObSectionInput = {
    studyDate: s.studyDate ? String(s.studyDate) : new Date().toISOString().slice(0, 10),
    lmp: null, // LMP is clinical history, not in the extraction row; degrade honestly.
    crlMm: num(row?.crl), bpdMm: num(row?.bpd), hcMm: num(row?.hc), acMm: num(row?.ac), flMm: num(row?.fl),
    fhrBpm, afiCm: num(row?.liquorAfi),
    placenta: (row?.placentaPosition as string) ?? null,
    presentation: (row?.fetalPresentation as string) ?? null,
    // A recorded FHR is direct evidence of cardiac activity → a live gestation.
    cardiacActivity: fhrBpm != null && fhrBpm > 0,
    liveGestation: fhrBpm != null && fhrBpm > 0,
  };
  const result = buildObSection(input);
  return { ...result, studyId, measurementSource: row ? (row.status === "approved" ? "approved" : "latest") : "none" };
}

export interface DopplerSectionForStudy extends DopplerSectionResult {
  studyId: number;
  vesselCount: number;
}

/** Build the canonical Doppler section for a study from its vessel rows. */
export async function buildDopplerSectionForStudy(studyId: number): Promise<DopplerSectionForStudy | { error: string }> {
  const s = await studyRow(studyId);
  if (!s) return { error: "study_not_found" };
  const uid = s.studyInstanceUid ?? String(s.id);

  const rows = await db.select().from(usgDopplerMeasurementsTable)
    .where(eq(usgDopplerMeasurementsTable.studyInstanceUID, uid))
    .orderBy(usgDopplerMeasurementsTable.id);

  // Recompute indices from the SOURCE velocities via the canonical engine
  // (the stored ri/pi are legacy pre-computations we intentionally do not trust).
  const vessels: DopplerVesselInput[] = rows.map((r) => ({
    vessel: r.vesselName || "Vessel",
    side: r.side ?? null,
    psv: num(r.psv),
    edv: num(r.edv),
  }));
  const result = buildDopplerSection(vessels);
  return { ...result, studyId, vesselCount: rows.length };
}

export interface FormFStatus {
  applicable: boolean;             // obstetric study?
  compliant: boolean;
  reason: string;
  errors: string[];
  formFId: number | null;
}

/** PCPNDT Form-F status for display. Never auto-fills; the canonical finalize
 *  gate remains the fail-closed enforcement point. */
export async function formFStatusForStudy(studyId: number): Promise<FormFStatus | { error: string }> {
  const s = await studyRow(studyId);
  if (!s) return { error: "study_not_found" };
  const applicable = isObstetricUsgStudy(s.modality, s.studyDescription ?? "");
  if (!applicable) {
    return { applicable: false, compliant: true, reason: "not_obstetric", errors: [], formFId: null };
  }
  const c = await checkPcpndtFormFCompliance(s.patientId);
  return { applicable: true, compliant: c.compliant, reason: c.reason, errors: c.errors, formFId: c.formFId };
}
