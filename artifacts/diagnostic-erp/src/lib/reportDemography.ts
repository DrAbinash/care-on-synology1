/**
 * reportDemography.ts — the ONE canonical report-demography model.
 *
 * Used by the Reporting Workspace header/editor, Preview/Word/PDF export,
 * and (after finalize) any shared report output. Do NOT fork per-surface
 * formatting: callers pass this object through and `buildDemographyHeaderHtml`
 * renders the single authoritative header block.
 *
 * Merge precedence (highest → lowest):
 *   1. Radiologist manual edit (workspace demography override)
 *   2. ERP / billing / patient-master values (queue row + patient record)
 *   3. DICOM worklist row / dicomMetadata (PatientAge, PatientSex, …)
 */

import { formatAgeForPrint } from "./age";

export interface ReportDemography {
  patientName: string;
  /** Display-ready age string (e.g. "45 Yrs", "6 Mo"). Never blank when any source has age. */
  age: string;
  /** "M" | "F" | "O" (normalized) */
  sex: string;
  patientId: string;
  uhid: string;
  accessionNumber: string;
  studyDescription: string;
  studyDate: string;
  referringDoctor: string;
  dateOfBirth: string;
}

/** DICOM PatientAge tag value ("045Y", "006M", "012D", …) → display string. */
export function dicomAgeToDisplay(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().toUpperCase();
  const m = /^(\d+)\s*([YMD])$/.exec(s);
  if (!m) return "";
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (m[2] === "Y") return `${n} Yrs`;
  if (m[2] === "M") return `${n} Mo`;
  return `${n} D`;
}

/** DICOM PatientSex ("M"/"F"/"O"/"MALE"/…) → single-letter normalized. */
export function normalizeSex(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return "";
  if (s.startsWith("M")) return "M";
  if (s.startsWith("F")) return "F";
  return "O";
}

type SourceBag = Record<string, unknown> | null | undefined;

function pick(...vals: Array<unknown>): string {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function firstNonEmptyAge(...vals: Array<unknown>): string {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    // Reject bare "0" / "0 Yrs" so a blank ERP age field falls through to DICOM.
    if (!s || s === "0" || /^0\s*(yrs?|years?|mo|months?|d|days?)?$/i.test(s)) continue;
    return s;
  }
  return "";
}

/**
 * Merge ERP + DICOM into one canonical demography object. ERP wins for any
 * field it has; DICOM only fills gaps. `overrides` (radiologist edits) always win.
 */
export function mergeReportDemography(input: {
  erp?: SourceBag;
  dicom?: SourceBag;
  overrides?: Partial<ReportDemography> | null;
}): ReportDemography {
  const erp = input.erp ?? {};
  const dicom = (input.dicom ?? {}) as Record<string, unknown>;
  const dicomMeta = (dicom.dicomMetadata as Record<string, unknown> | undefined) ?? {};

  const base: ReportDemography = {
    patientName: pick(
      erp.patientName,
      erp.name,
      dicom.patientName,
      dicomMeta.PatientName,
    ),
    age: firstNonEmptyAge(
      erp.age,
      erp.patientAge,
      dicomAgeToDisplay(dicom.age as string),
      dicomAgeToDisplay(dicomMeta.PatientAge as string),
    ),
    sex: pick(
      normalizeSex(erp.sex as string),
      normalizeSex(erp.gender as string),
      normalizeSex(dicom.sex as string),
      normalizeSex(dicomMeta.PatientSex as string),
    ),
    patientId: pick(erp.patientId, erp.dicomPatientId, dicom.dicomPatientId, dicomMeta.PatientID),
    uhid: pick(erp.uhid, erp.patientId),
    accessionNumber: pick(erp.accessionNumber, dicom.accessionNumber, dicomMeta.AccessionNumber),
    studyDescription: pick(erp.studyDescription, erp.testName, dicom.studyDescription, dicomMeta.StudyDescription),
    studyDate: pick(erp.studyDate, dicom.studyDate, dicomMeta.StudyDate),
    referringDoctor: pick(erp.referringDoctor, dicom.referringDoctor, dicomMeta.ReferringPhysicianName),
    dateOfBirth: pick(erp.dateOfBirth, dicomMeta.PatientBirthDate),
  };

  const ov = input.overrides ?? {};
  const out = { ...base };
  for (const k of Object.keys(out) as Array<keyof ReportDemography>) {
    const v = ov[k];
    if (v != null && String(v).trim() !== "") out[k] = String(v);
  }
  return out;
}

/** Header block shared by Preview / Word / PDF / print. */
export function buildDemographyHeaderHtml(d: ReportDemography): string {
  const esc = (v: string) => String(v ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const name = esc(d.patientName || "—").toUpperCase();
  const ref = esc(d.referringDoctor || "—").toUpperCase();
  const ageSex = `${esc(d.age || "")}${d.age && d.sex ? " / " : ""}${esc(d.sex || "")}`.trim();
  const dob = d.dateOfBirth ? esc(d.dateOfBirth) : "";
  const date = esc(d.studyDate || "");
  return `
<table style="width:100%;border-collapse:collapse;margin:0 0 4px;font-size:13px;">
  <tr>
    <td style="text-align:left;vertical-align:top;padding:0;"><strong style="font-size:14px;">${name}</strong><br/><span style="font-size:12px;">REF. BY: <strong>${ref}</strong></span></td>
    <td style="text-align:right;vertical-align:top;padding:0;white-space:nowrap;"><strong style="font-size:13px;">${esc(ageSex || "—")}</strong><br/><span style="font-size:12px;">${dob ? `DOB: <strong>${dob}</strong> · ` : ""}${date ? `DATE: <strong>${date}</strong>` : ""}</span></td>
  </tr>
</table>`.trim();
}

/** Resolve display age for a queue row + optional patient-master record. */
export function resolveDisplayAge(
  erp: { age?: unknown; patientAge?: unknown } | null | undefined,
  patientMaster: { dateOfBirth?: string | null; ageValue?: number | null; ageUnit?: string | null } | null | undefined,
  dicomAge?: string | null,
): string {
  const fromErp = firstNonEmptyAge(erp?.age, erp?.patientAge);
  if (fromErp) return fromErp;
  if (patientMaster) {
    const fromMaster = formatAgeForPrint(patientMaster);
    if (fromMaster) return fromMaster;
  }
  return dicomAgeToDisplay(dicomAge);
}
