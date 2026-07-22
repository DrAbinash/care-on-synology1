/**
 * usgPacsReturnPolicy — fail-closed eligibility + tag policy for returning a
 * signed USG report to PACS (P6.1).
 *
 * This is the DECISION layer only. The actual PDF render + encapsulated-PDF
 * DICOM upload is the canonical `archiveReportToPacs` (pacsArchive.ts) — P6 does
 * NOT create a second pusher. This module answers, purely and testably:
 *   - is this study's report allowed to go back to PACS right now?
 *   - what canonical DICOM tags does it carry (correct study/patient linkage,
 *     new report series, never overwriting source imaging)?
 *
 * Fail-closed by construction:
 *   - only a finalized/verified/signed report is eligible (never a draft);
 *   - a superseded report version is never auto-returned;
 *   - an obstetric study requires a COMPLIANT PCPNDT Form-F result — a missing
 *     or non-compliant result blocks the return (the regulatory guard never
 *     fails open);
 *   - a missing StudyInstanceUID blocks (we never fabricate study identity).
 */

export interface PacsReturnStudyState {
  studyId: number;
  studyInstanceUid: string | null;
  accessionNumber: string | null;
  patientId: number | null;
  patientName?: string | null;
  patientDisplayId?: string | null;
  modality: string | null;
  /** True when the study is obstetric — triggers the PCPNDT gate. */
  isObstetric: boolean;
  studyDate?: string | null;          // ISO or YYYYMMDD
  referringDoctor?: string | null;
}

export interface PacsReturnReportState {
  reportId: number | null;
  status: string | null;              // must be a signed/final status
  sequenceNumber?: number | null;
  /** Non-null → this version has been superseded by a later amendment. */
  supersededByReportId?: number | null;
}

/** Minimal shape of the canonical PcpndtComplianceResult this policy consumes. */
export interface PacsReturnPcpndtState {
  compliant: boolean;
  errors: string[];
}

export type PacsReturnBlockReason =
  | "no_report"
  | "not_finalized"
  | "superseded_report"
  | "no_study_uid"
  | "no_patient"
  | "pcpndt_missing"
  | "pcpndt_not_compliant";

export interface PacsReturnDecision {
  eligible: boolean;
  blockReasons: PacsReturnBlockReason[];
  errors: string[];
  /** Canonical encapsulated-PDF DICOM tags — only when eligible, else null. */
  tags: Record<string, string> | null;
  /** Deterministic idempotency key so a re-push targets one logical export. */
  idempotencyKey: string | null;
}

const FINAL_STATUSES = new Set(["final", "verified", "signed", "report_final", "delivered", "finalized"]);

const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();

/**
 * Decide whether a signed USG report may return to PACS, and build its tags.
 * `pcpndt` is REQUIRED for an obstetric study (the caller runs the canonical
 * async `checkPcpndtFormFCompliance` and passes the result); omitting it for an
 * obstetric study blocks the return (fail-closed).
 */
export function planUsgPacsReturn(
  study: PacsReturnStudyState,
  report: PacsReturnReportState,
  pcpndt?: PacsReturnPcpndtState | null,
): PacsReturnDecision {
  const blockReasons: PacsReturnBlockReason[] = [];
  const errors: string[] = [];

  if (!report || report.reportId == null) {
    blockReasons.push("no_report");
    errors.push("No signed report exists for this study.");
  } else if (!FINAL_STATUSES.has(norm(report.status))) {
    blockReasons.push("not_finalized");
    errors.push(`Report status "${report.status ?? "unknown"}" is not a finalized/verified state.`);
  }

  if (report && report.supersededByReportId != null) {
    blockReasons.push("superseded_report");
    errors.push("This report version has been superseded by a later amendment — return the latest version instead.");
  }

  if (!study.studyInstanceUid || !study.studyInstanceUid.trim()) {
    blockReasons.push("no_study_uid");
    errors.push("Study Instance UID is missing — cannot link the report to the study in PACS.");
  }

  if (study.patientId == null) {
    blockReasons.push("no_patient");
    errors.push("Patient identity is missing for this study.");
  }

  // PCPNDT gate — obstetric only, fail-closed.
  if (study.isObstetric) {
    if (!pcpndt) {
      blockReasons.push("pcpndt_missing");
      errors.push("PCPNDT Form-F compliance was not evaluated for this obstetric study — return blocked.");
    } else if (!pcpndt.compliant) {
      blockReasons.push("pcpndt_not_compliant");
      errors.push(...(pcpndt.errors.length ? pcpndt.errors : ["PCPNDT Form-F is not compliant."]));
    }
  }

  const eligible = blockReasons.length === 0;
  if (!eligible) {
    return { eligible, blockReasons, errors, tags: null, idempotencyKey: null };
  }

  // Canonical encapsulated-PDF tags. A NEW report series (Orthanc mints the
  // Series/SOP UIDs) — we never reuse or overwrite a source-image series.
  const studyDateRaw = study.studyDate ? String(study.studyDate).replace(/-/g, "") : "";
  const seq = report.sequenceNumber ?? 1;
  const tags: Record<string, string> = {
    PatientName: (study.patientName ?? "").replace(/\^/g, " ").trim() || "Patient",
    PatientID: (study.patientDisplayId ?? (study.patientId != null ? String(study.patientId) : "")).trim(),
    StudyInstanceUID: study.studyInstanceUid!.trim(),
    AccessionNumber: (study.accessionNumber ?? "").trim(),
    StudyDate: studyDateRaw,
    ReferringPhysicianName: (study.referringDoctor ?? "").trim(),
    SOPClassUID: "1.2.840.10008.5.1.4.1.1.104.1", // Encapsulated PDF Storage
    Modality: "OT",
    SeriesDescription: `USG Report PDF${seq > 1 ? ` (amended v${seq})` : ""}`.slice(0, 64),
  };

  const idempotencyKey = `usg-pacs:${study.studyInstanceUid!.trim()}:${report.reportId}:${seq}`;

  return { eligible: true, blockReasons: [], errors: [], tags, idempotencyKey };
}
