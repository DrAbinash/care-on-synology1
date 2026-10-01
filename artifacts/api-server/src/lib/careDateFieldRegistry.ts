/**
 * CARE date-field classification — the decision table behind
 * `careBusinessDatePolicy.ts` (final business-time policy, Phase B/C).
 *
 * Management's §9 constraint is the reason this file exists: a radiology ERP
 * stores three genuinely different kinds of date, and treating all of them as
 * "the business date" would be clinically wrong.
 *
 *   CLASS A  SYSTEM BUSINESS DATE     the day the record belongs to. For an
 *                                     ordinary staff creation it must equal the
 *                                     current trusted CARE clinic date, and it
 *                                     stops being editable once the row exists.
 *   CLASS B  HISTORICAL FACT          may legitimately be earlier: DOB, LMP, a
 *                                     procedure that happened last week, the
 *                                     DICOM acquisition day. Data, not a
 *                                     system timestamp.
 *   CLASS C  FUTURE / PLANNED         may legitimately be later: appointment,
 *                                     recall due date, EDD, payment terms.
 *   CLASS D  TRUSTED SYSTEM INSTANT   when CARE actually received or performed
 *                                     something. Never client-authoritative;
 *                                     enforced by construction (DB default /
 *                                     server clock), not by a date comparison.
 *
 * `CARE_CLASS_A_DATE_FIELDS` is the only enforcement surface. Everything in
 * `CARE_NEVER_BUSINESS_DATE_FIELDS` is refused by the guard even if a caller
 * asks for it, which is what keeps a future refactor from silently turning
 * `dateOfBirth` into a same-day-only field.
 *
 * Evidence for each entry is in
 * docs/audits/business-time-class-a-date-enforcement-2026-10-01.md. A column
 * listed here as Class A has been read in the route, the service and the
 * schema — not inferred from its name.
 */

export type CareDateClass = "A" | "B" | "C" | "D";

/** Keyed by `<table>.<column>` as it exists in Postgres. */
export type CareClassADateField = {
  readonly table: string;
  readonly column: string;
  /** The stored Postgres type. Both Class-A columns are plain `text`: the
   *  database cannot enforce a calendar for them (Stage 0 §11), which is
   *  exactly why the application has to. */
  readonly storedType: "text" | "date" | "timestamptz";
  /** Where an ordinary staff request can put a value into this column. */
  readonly clientWritableAt: readonly string[];
  /** Whether a value can reach the column without a client body: auto-voucher,
   *  sync, DB default. Documented so a reviewer can see the guard is not the
   *  only writer and must not be treated as one. */
  readonly serverWriters: readonly string[];
  readonly note: string;
};

export const CARE_CLASS_A_DATE_FIELDS: Record<string, CareClassADateField> = {
  "vouchers.date": {
    table: "vouchers",
    column: "date",
    storedType: "text",
    clientWritableAt: [
      "routes/accounting.ts:45,268 (POST /accounting/vouchers — `date` is required, format-checked, stored verbatim)",
      "routes/accounting.ts:295,312,353 (PATCH /accounting/vouchers/:id — no request schema; `date` is written whenever it differs from the stored value, with no guard of any kind)",
      "routes/accounting.ts:1411,1492 (POST /accounting/bank-statement/import — `transactions[].date` reaches the same column with no format check)",
    ],
    serverWriters: [
      "lib/auto-voucher.ts:193-194,288,377,455,541,614,685 (`istDateStr()` — Node clock mapped to Asia/Kolkata; server-derived, never client input)",
      "routes/accounting.ts:1279,1317 (POST /accounting/sync-billing — derives the day from the payment's own DB instant)",
    ],
    note: "The general-ledger posting date. Every other Class-A financial date in CARE is ultimately expressed as a voucher, so this is the highest-value field in the set.",
  },
  "expenses.expense_date": {
    table: "expenses",
    column: "expense_date",
    storedType: "text",
    clientWritableAt: [
      "lib/expenseV2Service.ts:301 <- lib/api-zod CreateExpenseBody (routes/expenses.ts:341) — bare `zod.string()`, no format check",
      "routes/expenses.ts:467-471,519 (PATCH /expenses/:id) — re-dates the row; today blocked only when the expense already has a ledger link (routes/expenses.ts:497-504)",
    ],
    serverWriters: [
      "No server-side derivation: the stored value is whatever the body said (Stage 0 characterization: 'the client's date string is stored verbatim').",
    ],
    note: "Drives the expense list filter (routes/expenses.ts:82) and the duplicate-detection window (lib/expenseV2Service.ts:249), so it is a real posting date and not a label.",
  },
};

/**
 * Refused by the guard. Presence in this map is a statement about the
 * clinical/business meaning of the column, established from the code, and the
 * reason a same-day rule must never be applied to it.
 */
export const CARE_NEVER_BUSINESS_DATE_FIELDS: Record<string, { class: Exclude<CareDateClass, "A">; reason: string }> = {
  "vouchers.external_event_date": { class: "B", reason: "The date a bank printed on its own statement (management decision 2026-10-01, design doc §12). It is external evidence about a movement, and the voucher's posting date is the separate Class-A `vouchers.date`. Policing it would make importing any statement older than today impossible again, which is the workflow management chose to keep." },
  "patients.date_of_birth": { class: "B", reason: "A historical fact about a person. A same-day rule would make it impossible to register a patient." },
  "fetal_usg_studies.lmp": { class: "B", reason: "Last menstrual period — by definition earlier than today; the GA calculation depends on it." },
  "fetal_usg_studies.edd": { class: "C", reason: "Estimated delivery date — by definition in the future." },
  "pregnancy_episodes.edd": { class: "C", reason: "Same clinical concept on the episode record." },
  "form_f_records.procedure_date": { class: "B", reason: "PCPNDT statutory record of a scan that already happened; the register prints it (lib/formFRegister.ts:180). Form F rows are insert-only, so there is no edit path to guard." },
  "form_f_records.consent_date": { class: "B", reason: "Date on prior-dated paper consent. Statutory data, not a CARE action time." },
  "form_f_records.mtp_date": { class: "B", reason: "MTP certificate date, same as consent. `\"\"` is a legitimate stored value (routes/form-f.ts:290,298)." },
  "radiology_studies.study_date": { class: "B", reason: "The acquisition day. A radiologist legitimately reports an older study today (policy §11) — that is not backdating." },
  "radiology_worklist.study_date": { class: "B", reason: "External modality date (DICOM StudyDate), parsed as IST-naive on purpose by lib/ai/studyAgeWindow.ts:28-43. Never a CARE audit timestamp." },
  "dicom_studies.study_date": { class: "B", reason: "A DICOM tag value from the connector (lib/dicomConnectors.ts:182) and an external event time; CARE's own ingest instant is the separate `created_at`." },
  "radiology_tumor_followups.study_date": { class: "B", reason: "The date of the examined study, baseline or interval — clinical history." },
  "appointments.appointment_date": { class: "C", reason: "A planned slot; stats compare it against the clinic day (routes/appointments.ts:118,124) but it is not the record's business date." },
  "online_bookings.selected_date": { class: "C", reason: "Patient-chosen future day, entered on a public endpoint." },
  "recall_queue.due_date": { class: "C", reason: "Derived recall task date (deliveredAt + interval); intentionally future." },
  "mwl_entries.scheduled_start_date": { class: "C", reason: "DICOM Modality Worklist scheduled day, pushed to the modality." },
  "radiology_scheduled_procedures.scheduled_date": { class: "C", reason: "ScheduledStudyDate sent to the modality." },
  "bills.due_date": { class: "C", reason: "A payment term, not a posting date. The bill's business date is its DB-generated `created_at`." },
  "discount_rules.expires_at": { class: "C", reason: "Rule validity horizon." },
  "expense_attachments.uploaded_at": { class: "D", reason: "System instant, server-generated." },
  "patient_reports.signed_at": { class: "D", reason: "Professional attestation instant. Must be server-derived — it is currently client-settable on the Reporting Studio path and is handled as an instant problem, not a business-date comparison." },
  "patient_report_amendments.created_at": { class: "D", reason: "Effective instant of a correction; immutable by design." },
  "radiology_critical_findings.acknowledged_at": { class: "D", reason: "Safety attestation instant, already server-derived with a session actor (routes/radiologyWorkflow.ts:401-428)." },
  "day_closures.closed_at": { class: "D", reason: "The close action instant. `closure_date` is the business day and is already server-derived; no ordinary-staff body input reaches either." },
  "bank_transactions.transaction_date": { class: "B", reason: "Provider-supplied statement date of an external banking event (lib/db schema banking.ts:50), fetched not typed." },
  "purchase_invoices.invoice_date": { class: "B", reason: "The vendor's document date. Posting it today for an older invoice is the normal case — see the open question in the design doc before this is revisited." },
};

/** `<table>.<column>` for the guard's lookup key. */
export function careDateFieldKey(table: string, column: string): string {
  return `${table}.${column}`;
}

export function isCareClassAField(table: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(CARE_CLASS_A_DATE_FIELDS, careDateFieldKey(table, column));
}

export function isCareNeverBusinessDate(table: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(CARE_NEVER_BUSINESS_DATE_FIELDS, careDateFieldKey(table, column));
}
