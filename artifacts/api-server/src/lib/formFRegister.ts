import { evaluateFormFCompleteness, type FormFCompletenessInput } from "./pcpndtCompliance";

/**
 * formFRegister.ts — pure logic for the monthly PCPNDT Form F register
 * (GET /api/form-f/register + its CSV export).
 *
 * The register is a statutory month-wise listing of every Form F record for
 * submission to / inspection by the Appropriate Authority. Rules:
 *  - Month window is the CLINIC's month — IST (UTC+05:30, no DST), applied to
 *    form_f_records.created_at.
 *  - Ordering is stable and deterministic: created_at ASC, id ASC. The
 *    statutory serial is the record's 1-based position in that order within
 *    the month. The schema captures no separate statutory serial field, so
 *    the serial is DERIVED (documented in docs/PCPNDT_MONTHLY_REGISTER.md);
 *    no statutory fields are invented.
 *  - Incomplete records are never silently omitted — every record in the
 *    month appears, graded with the SAME completeness engine the finalize
 *    gates use (lib/pcpndtCompliance.evaluateFormFCompleteness).
 */

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+05:30, no DST

export interface RegisterQuery {
  month: number; // 1-12
  year: number;
  page: number;
  pageSize: number;
}

export function parseRegisterQuery(q: Record<string, unknown>): { ok: true; value: RegisterQuery } | { ok: false; error: string } {
  const month = Number(q["month"]);
  const year = Number(q["year"]);
  const page = q["page"] === undefined ? 1 : Number(q["page"]);
  const pageSize = q["pageSize"] === undefined ? 50 : Number(q["pageSize"]);

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, error: "month must be an integer between 1 and 12" };
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { ok: false, error: "year must be an integer between 2000 and 2100" };
  }
  if (!Number.isInteger(page) || page < 1) {
    return { ok: false, error: "page must be a positive integer" };
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    return { ok: false, error: "pageSize must be an integer between 1 and 500" };
  }
  return { ok: true, value: { month, year, page, pageSize } };
}

/** UTC instants of the IST month boundary: [start, end). */
export function istMonthWindowUtc(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1) - IST_OFFSET_MS);
  const end = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1) - IST_OFFSET_MS);
  return { start, end };
}

/** The form_f_records columns the register presents (all already captured). */
export interface RegisterSourceRecord extends FormFCompletenessInput {
  id: number;
  createdAt: Date | string | null;
  patientId: number | null;
  billId: number | null;
  billNumber: string | null;
  fetalUsgStudyId: number | null;
  registrationNo: string | null;
  patientName: string | null;
  age: string | null;
  mobile: string | null;
  referredBy: string | null;
  doctorName: string | null;
  procedure: string | null;
  procedurePurpose: string | null;
  basisDiagnosis: string | null;
  gestationalAgeWeeks: string | null;
  gestationalAgeDays: string | null;
  ultrasoundResult: string | null;
  abnormality: string | null;
  resultConveyed: string | null;
  date: string | null;
}

export interface RegisterRow {
  /** Rule 9(1) Column 1 — continuous sequential number for the month/year. */
  serial: number;
  recordId: number;
  /** Rule 9(1) Column 2 — the date the procedure was performed. Resolved as
   *  procedureDate, falling back to the form's own date field; left BLANK
   *  when neither was captured (never fabricated from record timestamps —
   *  the completeness grading already flags the missing date). */
  dateOfProcedure: string;
  /** Form-F-designated tests billed on the record's linked order — the
   *  admin-configured clinic_settings.formFTestIds designation (any
   *  modality/procedure, never fetal/echo-only), matching the /pending
   *  queue's definition. Non-Form-F tests on the same bill are deliberately
   *  excluded from the statutory register. Empty when the record has no bill
   *  linkage (e.g. WhatsApp intake before billing) or no designation is
   *  configured. */
  linkedTests: string[];
  createdAtIst: string;
  formDate: string;
  registrationNo: string;
  patientId: number | null;
  patientName: string;
  age: string;
  husbandFatherName: string;
  address: string;
  mobile: string;
  referredBy: string;
  doctorName: string;
  procedure: string;
  procedurePurpose: string;
  basisDiagnosis: string;
  gestationalAge: string;
  ultrasoundResult: string;
  abnormality: string;
  consentDate: string;
  procedureDate: string;
  resultConveyed: string;
  idCardVerified: boolean;
  /** Same engine as the finalize gates — never a silent omission. */
  completionStatus: "complete" | "incomplete";
  missingFields: string[];
  billNumber: string;
  billId: number | null;
  fetalUsgStudyId: number | null;
}

function istDateTimeString(value: Date | string | null): string {
  if (value == null) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
}

/**
 * Grade + serialize records into register rows. `records` must already be in
 * the canonical order (created_at ASC, id ASC); `firstSerial` is the 1-based
 * serial of the first record (pagination offset + 1), so serials stay stable
 * across pages of the same month. `testsByBillId` maps a record's billId to
 * the billed test names on that order (all test types).
 */
export function buildRegisterRows(
  records: RegisterSourceRecord[],
  firstSerial: number,
  testsByBillId?: Map<number, string[]>,
): RegisterRow[] {
  return records.map((r, i) => {
    const completeness = evaluateFormFCompleteness(r);
    const gaWeeks = r.gestationalAgeWeeks?.trim() ?? "";
    const gaDays = r.gestationalAgeDays?.trim() ?? "";
    return {
      serial: firstSerial + i,
      recordId: r.id,
      dateOfProcedure: r.procedureDate?.trim() || r.date?.trim() || "",
      linkedTests: (r.billId != null ? testsByBillId?.get(r.billId) : undefined) ?? [],
      createdAtIst: istDateTimeString(r.createdAt),
      formDate: r.date?.trim() || "",
      registrationNo: r.registrationNo ?? "",
      patientId: r.patientId,
      patientName: r.patientName ?? "",
      age: r.age ?? "",
      husbandFatherName: r.husbandFatherName ?? "",
      address: r.address ?? "",
      mobile: r.mobile ?? "",
      referredBy: r.referredBy ?? "",
      doctorName: r.doctorName ?? "",
      procedure: r.procedure ?? "",
      procedurePurpose: r.procedurePurpose ?? "",
      basisDiagnosis: r.basisDiagnosis ?? "",
      gestationalAge: gaWeeks || gaDays ? `${gaWeeks || "0"}w ${gaDays || "0"}d` : "",
      ultrasoundResult: r.ultrasoundResult ?? "",
      abnormality: r.abnormality ?? "",
      consentDate: r.consentDate ?? "",
      procedureDate: r.procedureDate ?? "",
      resultConveyed: r.resultConveyed ?? "",
      idCardVerified: Boolean(r.idCardVerified),
      completionStatus: completeness.complete ? "complete" : "incomplete",
      missingFields: completeness.missing,
      billNumber: r.billNumber ?? "",
      billId: r.billId,
      fetalUsgStudyId: r.fetalUsgStudyId,
    };
  });
}

/** Rule 9(1), PC-PNDT Act — the five prescribed structural columns of the
 *  permanent clinic register, in the prescribed order. These lead the CSV
 *  and are the entire statutory print. */
export const RULE_9_1_COLUMNS: Array<{ header: string; value: (r: RegisterRow) => string }> = [
  { header: "Serial Number", value: (r) => String(r.serial) },
  { header: "Date of Procedure", value: (r) => r.dateOfProcedure },
  {
    header: "Name of the Patient & Spouse/Father",
    value: (r) => [r.patientName, r.husbandFatherName && `Spouse/Father: ${r.husbandFatherName}`].filter(Boolean).join(" — "),
  },
  {
    header: "Full Address & Contact Details",
    value: (r) => [r.address, r.mobile && `Ph: ${r.mobile}`].filter(Boolean).join(", "),
  },
  {
    header: "Name of Referring Doctor / Self-Referral",
    value: (r) => r.doctorName || r.referredBy || "Self",
  },
];

// Supplementary (non-statutory) columns — clinic operations + QA data, kept
// AFTER the Rule 9(1) block in the CSV so the statutory structure leads.
const SUPPLEMENTARY_COLUMNS: Array<{ header: string; value: (r: RegisterRow) => string }> = [
  { header: "Age", value: (r) => r.age },
  { header: "Registration No", value: (r) => r.registrationNo },
  { header: "Procedure", value: (r) => r.procedure },
  { header: "Form F Tests", value: (r) => r.linkedTests.join("; ") },
  { header: "Purpose", value: (r) => r.procedurePurpose },
  { header: "Basis/Indication", value: (r) => r.basisDiagnosis },
  { header: "Gestational Age", value: (r) => r.gestationalAge },
  { header: "Ultrasound Result", value: (r) => r.ultrasoundResult },
  { header: "Abnormality", value: (r) => r.abnormality },
  { header: "Consent Date", value: (r) => r.consentDate },
  { header: "Result Conveyed", value: (r) => r.resultConveyed },
  { header: "ID Verified", value: (r) => (r.idCardVerified ? "yes" : "no") },
  { header: "Completion", value: (r) => r.completionStatus },
  { header: "Missing Fields", value: (r) => r.missingFields.join("; ") },
  { header: "Bill No", value: (r) => r.billNumber },
  { header: "Fetal USG Study Id", value: (r) => (r.fetalUsgStudyId == null ? "" : String(r.fetalUsgStudyId)) },
  { header: "Record Id", value: (r) => String(r.recordId) },
  { header: "Record Created (IST)", value: (r) => r.createdAtIst },
];

const CSV_COLUMNS = [...RULE_9_1_COLUMNS, ...SUPPLEMENTARY_COLUMNS];

// ── Self-referral OPD register (Form 25 replica) ─────────────────────────────
//
// PCPNDT rule: a sonologist may scan a SELF-REFERRED pregnant woman only when
// she was clinically examined in the sonologist's own OPD — "self-referred by
// the patient/relative" alone is not a lawful referral. This register is the
// required separate obstetrical-checkup record: the same Form 25 (formerly
// 3C, Income-tax daily case register) structure, containing ONLY the month's
// self-referral/walk-in Form F patients, with the examining doctor and the
// complimentary professional charges recorded. Kept beside the Rule 9(1)
// register in the Form F module.

export const SELF_REFERRAL_OPD_DOCTOR = "Dr. Sugandha Priyadarshini";
export const SELF_REFERRAL_OPD_DOCTOR_QUALIFICATIONS = "MBBS, MD";
export const SELF_REFERRAL_OPD_SERVICE = "General Obstetrical Checkup";
export const SELF_REFERRAL_OPD_FEES = "Complimentary / Free";
/** The auto-prescription's advice — exactly the prescribed two lines. */
export const SELF_REFERRAL_PRESCRIPTION_ADVICE =
  "Patient for Obstetrical Examination.\nAdvice: Sonography for Fetal Well Being (FWB).";

/** A record is self-referral/walk-in when it names NO referring doctor:
 *  doctor_name blank and referred_by blank / "Self" / "walk-in". A free-text
 *  doctor name in referred_by (e.g. "Dr. Mehta") is a doctor referral. */
export function isSelfReferralRecord(
  r: Pick<RegisterSourceRecord, "referredBy" | "doctorName">,
): boolean {
  if (r.doctorName?.trim()) return false;
  const ref = (r.referredBy ?? "").trim().toLowerCase();
  return ref === "" || ref === "self" || ref === "walk-in" || ref === "walkin";
}

export interface OpdRegisterRow {
  /** Form 25 col (1) — date of the obstetrical checkup. The OPD examination
   *  happens at the visit, so this resolves procedure date → form date →
   *  the record's creation date (IST). */
  date: string;
  /** Form 25 col (2) — continuous serial among the month's self-referrals. */
  serial: number;
  /** Form 25 col (3) — the pregnant woman (+ spouse/father for identity). */
  patientName: string;
  spouseFather: string;
  /** Form 25 col (4) — prefilled: the checkup Dr. Sugandha performs. */
  natureOfService: string;
  /** Form 25 col (5) — complimentary professional charges. */
  feesReceived: string;
  /** Form 25 col (6) — no receipt for a complimentary service. */
  dateOfReceipt: string;
  recordId: number;
  mobile: string;
  gestationalAge: string;
}

export function buildOpdRegisterRows(records: RegisterSourceRecord[], firstSerial: number): OpdRegisterRow[] {
  return records.map((r, i) => {
    const gaWeeks = r.gestationalAgeWeeks?.trim() ?? "";
    const gaDays = r.gestationalAgeDays?.trim() ?? "";
    return {
      date: r.procedureDate?.trim() || r.date?.trim() || istDateTimeString(r.createdAt).slice(0, 10),
      serial: firstSerial + i,
      patientName: r.patientName ?? "",
      spouseFather: r.husbandFatherName ?? "",
      natureOfService: SELF_REFERRAL_OPD_SERVICE,
      feesReceived: SELF_REFERRAL_OPD_FEES,
      dateOfReceipt: "—",
      recordId: r.id,
      mobile: r.mobile ?? "",
      gestationalAge: gaWeeks || gaDays ? `${gaWeeks || "0"}w ${gaDays || "0"}d` : "",
    };
  });
}

function csvEscape(v: string): string {
  return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Complete CSV for a month's register rows (same escaping as teachingCases). */
export function registerRowsToCsv(rows: RegisterRow[]): string {
  const header = CSV_COLUMNS.map((c) => csvEscape(c.header)).join(",");
  const lines = rows.map((r) => CSV_COLUMNS.map((c) => csvEscape(c.value(r))).join(","));
  return [header, ...lines].join("\n");
}
