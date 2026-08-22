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

import { formatAgeForPrint, isPlausibleAgeYears, isSentinelDob } from "./age";
import { sanitizeDicomSex } from "@workspace/pathology";

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
  if (m[2] === "Y") return isPlausibleAgeYears(n) ? `${n} Yrs` : "";
  if (m[2] === "M") return `${n} Mo`;
  return `${n} D`;
}

/** DICOM PatientSex ("M"/"F"/"O"/"MALE"/…) → single-letter normalized. */
export function normalizeSex(raw: string | null | undefined): string {
  return sanitizeDicomSex(raw) ?? "";
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
  // Try parsing each value through dicomAgeToDisplay (handles "045Y" → "45 Yrs" etc.)
  for (const v of vals) {
    const raw = String(v ?? "").trim();
    if (!raw) continue;
    const parsed = dicomAgeToDisplay(raw);
    if (parsed) return parsed;
  }
  // Fallback: accept any non-sentinel, non-zero, plausible-numeric ERP age
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (!s || s === "0" || /^0\s*(yrs?|years?|mo|months?|d|days?)?$/i.test(s)) continue;
    const years = parseInt(s, 10);
    if (Number.isFinite(years) && !/[a-z]/i.test(s) && !isPlausibleAgeYears(years) && years <= 120) return s;
  }
  return "";
}

const DEGREE_RE = /\b(md|mbbs|ms|mch|m\.ch|dnb|dm|frcr|frcs|frcp|mrcp|dmrd|fcps)\b/i;

/** MRI/billing sometimes type "DR.SANJAY KUMAR" into Acc No. instead of a work-id. */
export function accessionLooksLikeReferringDoctor(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  if (/^ACC[-_]/i.test(s)) return false;
  if (/^\d{4,}$/.test(s.replace(/[-\s]/g, ""))) return false;
  const spaced = s.replace(/\s+/g, " ");
  if (/^dr\.?\s*/i.test(spaced)) return true;
  if (/^dr[A-Z.]/i.test(s)) return true;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const digits = (s.match(/\d/g) || []).length;
  const words = spaced.split(/[\s.^]+/).filter(Boolean);
  if (DEGREE_RE.test(s) && words.length >= 2 && digits <= 2 && letters >= 6) return true;
  return false;
}

function titleCaseName(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^[A-Z]\.?$/.test(w)) return w.toUpperCase();
      if (/^[A-Z]{2,4}$/.test(w)) return w;
      if (DEGREE_RE.test(w)) return w.toUpperCase().replace(/\.$/, "");
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/** "DR.SANJAY KUMAR MD" → "Dr. Sanjay Kumar, MD" */
export function formatReferringDoctorDisplay(raw: string | null | undefined): string {
  const s = String(raw ?? "").replace(/\^+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/^(self|walk[\s-]*in|na|n\/a|none|-)$/i.test(s)) return s;

  let body = s;
  let hadDr = false;
  if (/^dr\.?\s+/i.test(body)) {
    hadDr = true;
    body = body.replace(/^dr\.?\s+/i, "").trim();
  } else if (/^dr\.?[A-Z]/i.test(body.replace(/\s+/g, ""))) {
    hadDr = true;
    body = body.replace(/^dr\.?/i, "").trim();
  }

  const tokens = body.split(/[\s,]+/).filter(Boolean);
  const degrees: string[] = [];
  const nameParts: string[] = [];
  for (const tok of tokens) {
    if (DEGREE_RE.test(tok.replace(/\./g, ""))) {
      const pretty = tok.replace(/\./g, "").toUpperCase();
      if (!degrees.includes(pretty)) degrees.push(pretty);
    } else if (!/^dr\.?$/i.test(tok)) {
      nameParts.push(tok);
    }
  }
  const core = titleCaseName(nameParts.join(" "));
  if (!core) return hadDr ? `Dr. ${s.replace(/^dr\.?\s*/i, "").trim()}` : s;
  const withDr = hadDr || /^dr/i.test(s) ? `Dr. ${core}` : `Dr. ${core}`;
  return degrees.length ? `${withDr}, ${degrees.join(", ")}` : withDr;
}

/** Doctors-master name + degree for REF. BY, chips, and report headers. */
export function formatDoctorWithDegree(name: string, degree?: string | null): string {
  const formatted = formatReferringDoctorDisplay(name);
  const deg = String(degree ?? "").replace(/\s+/g, " ").trim();
  if (!deg || !formatted) return formatted;
  const hay = formatted.toLowerCase();
  if (hay.includes(deg.toLowerCase())) return formatted;
  const tokens = deg.split(/[\s,;/]+/).filter((t) => t.length > 1);
  if (tokens.length > 0 && tokens.every((t) => hay.includes(t.toLowerCase()))) return formatted;
  return `${formatted}, ${deg}`;
}

export function reconcileAccessionVsReferringDoctor(input: {
  accessionNumber?: string | null;
  referringDoctor?: string | null;
}): { accessionNumber: string; referringDoctor: string } {
  const accession = String(input.accessionNumber ?? "").trim();
  let referring = String(input.referringDoctor ?? "").trim();
  if (!referring && accessionLooksLikeReferringDoctor(accession)) {
    return { accessionNumber: "", referringDoctor: formatReferringDoctorDisplay(accession) };
  }
  if (referring) referring = formatReferringDoctorDisplay(referring);
  if (accessionLooksLikeReferringDoctor(accession)) {
    return { accessionNumber: "", referringDoctor: referring };
  }
  return { accessionNumber: accession, referringDoctor: referring };
}

function nameKey(raw: string): string {
  return raw.toLowerCase().replace(/^dr\.?\s*/i, "").replace(/[^a-z]/g, "");
}

/** If a unique doctor-catalog name matches, use it (usually includes degree). */
export function enrichReferringDoctorFromCatalog(
  current: string,
  catalogNames: string[] | null | undefined,
): string {
  const cur = String(current ?? "").trim();
  if (!cur || !catalogNames?.length) return cur;
  const key = nameKey(cur.replace(DEGREE_RE, ""));
  if (key.length < 6) return cur;
  const hits = catalogNames.filter((n) => {
    const k = nameKey(n.replace(DEGREE_RE, ""));
    return k === key || k.includes(key) || key.includes(k);
  });
  if (hits.length !== 1) return cur;
  return formatReferringDoctorDisplay(hits[0]!);
}

/**
 * Merge ERP + DICOM into one canonical demography object. ERP wins for any
 * field it has; DICOM only fills gaps. `overrides` (radiologist edits) always win.
 */
export function mergeReportDemography(input: {
  erp?: SourceBag;
  dicom?: SourceBag;
  overrides?: Partial<ReportDemography> | null;
  referringDoctorCatalog?: string[] | null;
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
    dateOfBirth: isSentinelDob(pick(erp.dateOfBirth, dicomMeta.PatientBirthDate))
      ? ""
      : pick(erp.dateOfBirth, dicomMeta.PatientBirthDate),
  };

  const ov = input.overrides ?? {};
  const out = { ...base };
  for (const k of Object.keys(out) as Array<keyof ReportDemography>) {
    const v = ov[k];
    if (v != null && String(v).trim() !== "") out[k] = String(v);
  }
  const reconciled = reconcileAccessionVsReferringDoctor({
    accessionNumber: out.accessionNumber,
    referringDoctor: out.referringDoctor,
  });
  out.accessionNumber = reconciled.accessionNumber;
  out.referringDoctor = enrichReferringDoctorFromCatalog(
    reconciled.referringDoctor,
    input.referringDoctorCatalog,
  );
  return out;
}

function escDemographyHtml(v: string): string {
  return String(v ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** True when a demography field should appear on printed/exported reports. */
export function hasDemographyValue(v: string | null | undefined): boolean {
  return String(v ?? "").trim().length > 0;
}

/** "45 Yrs / F" or whichever parts exist — empty when both age and sex are blank. */
export function formatDemographyAgeSexLine(age: string | null | undefined, sex: string | null | undefined): string {
  const a = String(age ?? "").trim();
  const s = String(sex ?? "").trim();
  if (!a && !s) return "";
  if (a && s) return `${a} / ${s}`;
  return a || s;
}

/** Classic NAME / AGE/SEX / ACC line(s) — omit labels with no value. */
export function buildClassicDemographyHeaderParts(d: {
  patientName?: string | null;
  age?: string | null;
  sex?: string | null;
  uhid?: string | null;
  patientId?: string | null;
  accessionNumber?: string | null;
  referringDoctor?: string | null;
  studyDate?: string | null;
}): { line1: string; line2: string } {
  const line1Parts: string[] = [];
  if (hasDemographyValue(d.patientName)) {
    line1Parts.push(`NAME: ${escDemographyHtml(String(d.patientName).trim())}`);
  }
  const ageSex = formatDemographyAgeSexLine(d.age, d.sex).replace(/\s*\/\s*/g, "/");
  if (ageSex) line1Parts.push(`AGE/SEX: ${escDemographyHtml(ageSex)}`);
  const uhid = String(d.uhid ?? d.patientId ?? "").trim();
  if (uhid) line1Parts.push(`UHID: ${escDemographyHtml(uhid)}`);
  if (hasDemographyValue(d.accessionNumber)) {
    line1Parts.push(`ACC: ${escDemographyHtml(String(d.accessionNumber).trim())}`);
  }

  const line2Parts: string[] = [];
  if (hasDemographyValue(d.referringDoctor)) {
    line2Parts.push(`REF. BY: ${escDemographyHtml(String(d.referringDoctor).trim())}`);
  }
  if (hasDemographyValue(d.studyDate)) {
    line2Parts.push(`DATE: ${escDemographyHtml(String(d.studyDate).trim())}`);
  }

  return {
    line1: line1Parts.join(" &nbsp;&nbsp; "),
    line2: line2Parts.join(" &nbsp;&nbsp; "),
  };
}

export function buildClassicDemographyHeaderHtml(d: {
  patientName?: string | null;
  age?: string | null;
  sex?: string | null;
  uhid?: string | null;
  patientId?: string | null;
  accessionNumber?: string | null;
  referringDoctor?: string | null;
  studyDate?: string | null;
}): string {
  const { line1, line2 } = buildClassicDemographyHeaderParts(d);
  return [line1, line2]
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 2px;"><strong>${line}</strong></p>`)
    .join("\n");
}

/** Header block shared by Preview / Word / PDF / print (table layout). */
export function buildDemographyHeaderHtml(d: ReportDemography): string {
  const esc = escDemographyHtml;
  const name = hasDemographyValue(d.patientName)
    ? esc(d.patientName).toUpperCase()
    : "—";
  const refLine = hasDemographyValue(d.referringDoctor)
    ? `<span style="font-size:13px;">REF. BY: <strong>${esc(d.referringDoctor).toUpperCase()}</strong></span>`
    : "";
  const ageSex = formatDemographyAgeSexLine(d.age, d.sex);
  const ageSexLine = ageSex
    ? `<strong style="font-size:15px;">${esc(ageSex)}</strong>`
    : "";
  const metaParts: string[] = [];
  if (hasDemographyValue(d.dateOfBirth)) {
    metaParts.push(`DOB: <strong>${esc(d.dateOfBirth)}</strong>`);
  }
  if (hasDemographyValue(d.studyDate)) {
    metaParts.push(`DATE: <strong>${esc(d.studyDate)}</strong>`);
  }
  if (hasDemographyValue(d.accessionNumber)) {
    metaParts.push(`ACC: <strong>${esc(d.accessionNumber)}</strong>`);
  }
  const metaLine = metaParts.length
    ? `<span style="font-size:13px;">${metaParts.join(" · ")}</span>`
    : "";
  const leftSub = refLine ? `<br/>${refLine}` : "";
  const rightSub = metaLine ? `<br/>${metaLine}` : "";
  return `
<table style="width:100%;border-collapse:collapse;margin:0 0 6px;font-size:14px;">
  <tr>
    <td style="text-align:left;vertical-align:top;padding:0;"><strong style="font-size:16px;">${name}</strong>${leftSub}</td>
    <td style="text-align:right;vertical-align:top;padding:0;white-space:nowrap;">${ageSexLine}${rightSub}</td>
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
    const fromMaster = formatAgeForPrint({
      ...patientMaster,
      dateOfBirth: isSentinelDob(patientMaster.dateOfBirth) ? "" : patientMaster.dateOfBirth,
    });
    if (fromMaster) return fromMaster;
  }
  return dicomAgeToDisplay(dicomAge);
}
