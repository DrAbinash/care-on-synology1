/**
 * pcpndtCompliance.ts — the ONE PCPNDT Form F compliance check.
 *
 * Implements step 2 of docs/usg-reporting/pcpndt-canonical-roadmap.md §1.4:
 * the Form F verification that previously lived inline in
 * routes/usgReports.ts POST /:id/finalize (the legacy pipeline's compliance
 * gate) is now this shared function, called by BOTH pipelines — the legacy
 * usgReports finalize AND the canonical finalize path (patient-reports.ts,
 * internal-radiology.ts, fetalUsgLevel4.ts final-sign). One engine, never
 * two independently-drifting implementations of the same regulatory rule.
 *
 * The rule (verbatim from the legacy gate, roadmap §1.1): the most recent
 * form_f_records row for the patient must exist and have ALL of —
 *   1. idCardVerified === true          (set by the human ID-verify flow)
 *   2. husbandFatherName non-blank
 *   3. address non-blank
 *   4. consentDate OR procedureDate non-blank
 *
 * Lookup semantics — DOCUMENTED DECISION (roadmap §1.6): the check is
 * by-patient-latest, exactly matching the legacy gate. Tightening it to a
 * per-study date window was considered and deliberately NOT done here:
 * Form F is completed at registration/billing, typically BEFORE the study,
 * so any "record newer than the study" rule would false-block legitimate
 * compliant workflows — the worse failure mode operationally, while the
 * theoretical stale-record false-allow it would prevent is unchanged from
 * the behavior the clinic has run under the legacy pipeline all along.
 * The returned formFCreatedAt lets callers/UI surface the record's age so
 * a radiologist can judge staleness; revisit if a real incident shows the
 * window is needed.
 *
 * Failure direction: this function never fails open. A DB error propagates
 * to the caller (whose route handler 500s) rather than returning
 * compliant=true — a regulatory guard must fail closed.
 */

import { db } from "@workspace/db";
import { formFRecordsTable } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";

export interface PcpndtComplianceResult {
  compliant: boolean;
  reason: "compliant" | "no_patient" | "no_form_f" | "incomplete_form_f";
  /** Human-readable missing-field messages — same wording the legacy
   *  usgReports finalize gate has always returned (UI compatibility). */
  errors: string[];
  formFId: number | null;
  formFCreatedAt: string | null;
}

/** The subset of a form_f_records row the completeness rule reads. */
export interface FormFCompletenessInput {
  idCardVerified: boolean | null;
  husbandFatherName: string | null;
  address: string | null;
  consentDate: string | null;
  procedureDate: string | null;
}

/**
 * Pure completeness evaluation for ONE Form F record — the exact four
 * predicates of the compliance rule, extracted so the finalize gates and the
 * monthly PCPNDT register grade records with the same engine (never two
 * drifting copies of a statutory rule). Wording unchanged from the legacy
 * gate (UI compatibility).
 */
export function evaluateFormFCompleteness(record: FormFCompletenessInput): {
  complete: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!record.idCardVerified) {
    missing.push("ID Card must be verified.");
  }
  if (!record.husbandFatherName?.trim()) {
    missing.push("Husband/Father Name is required.");
  }
  if (!record.address?.trim()) {
    missing.push("Address is required.");
  }
  if (!record.consentDate?.trim() && !record.procedureDate?.trim()) {
    missing.push("Consent Date or Procedure Date is required.");
  }
  return { complete: missing.length === 0, missing };
}

export async function checkPcpndtFormFCompliance(
  patientId: number | null | undefined,
): Promise<PcpndtComplianceResult> {
  if (!patientId) {
    return {
      compliant: false,
      reason: "no_patient",
      errors: ["Patient ID is missing for this obstetric report."],
      formFId: null,
      formFCreatedAt: null,
    };
  }

  const [formF] = await db
    .select()
    .from(formFRecordsTable)
    .where(eq(formFRecordsTable.patientId, patientId))
    .orderBy(desc(formFRecordsTable.createdAt))
    .limit(1);

  if (!formF) {
    return {
      compliant: false,
      reason: "no_form_f",
      errors: ["PCPNDT Form F record is missing for this obstetric study."],
      formFId: null,
      formFCreatedAt: null,
    };
  }

  const { complete, missing: errors } = evaluateFormFCompleteness(formF);

  return {
    compliant: complete,
    reason: complete ? "compliant" : "incomplete_form_f",
    errors,
    formFId: formF.id,
    formFCreatedAt: formF.createdAt ? new Date(formF.createdAt).toISOString() : null,
  };
}

/** Roles allowed to override a failing PCPNDT check at the canonical
 *  finalize sites — identical to the legacy POST /:id/finalize-force gate
 *  in usgReports.ts (admin or super_admin, documented reason, audited). */
export const PCPNDT_OVERRIDE_ROLES = new Set(["admin", "super_admin"]);
