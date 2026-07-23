# PCPNDT monthly Form F register

**Status:** implemented (stabilization PR 2). A management-authorized, month-wise listing of **every** Form F record, for submission to / inspection by the Appropriate Authority.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/form-f/register?month&year&page&pageSize` | Paginated JSON register for the UI |
| `GET /api/form-f/register/export?month&year` | Complete-month CSV download (audited) |

Both sit behind the `/form-f` staff-permission mount **plus** `requireAdminRole` (management only), and are registered before the router's `/:id` catch-all. Both are excluded from the service-worker cache (`/api/form-f/register` prefix in `public/sw.js`; enforced by `personalEndpointCacheGuard.test.ts`) — statutory PHI must never be served from Cache Storage, and a cached admin 200 must never reach non-admin staff on a shared terminal.

## Rule 9(1) structure

The register follows the permanent-clinic-register structure prescribed by Rule 9(1) of the PC-PNDT Act. The **print reproduces exactly these five columns**; the CSV leads with them (supplementary operational columns follow); the on-screen table shows them first.

| # | Prescribed header | Source data |
| --- | --- | --- |
| 1 | Serial Number | Derived continuous serial for the month (see below) |
| 2 | Date of Procedure | `procedure_date`, falling back to the form's `date`; left **blank** when neither was captured — never back-filled from record timestamps (the completeness grading flags it) |
| 3 | Name of the Patient & Spouse/Father | `patient_name` + `husband_father_name` |
| 4 | Full Address & Contact Details | `address` + `mobile` |
| 5 | Name of Referring Doctor / Self-Referral | `doctor_name`, else `referred_by`, else "Self" |

"Updated daily" (Rule 9(1)) is satisfied operationally: the register is a live view over `form_f_records`, which are created at billing/registration — any day's records appear the moment they are saved.

## Semantics

- **Month window:** the clinic's month — IST (UTC+05:30, no DST) applied to `form_f_records.created_at` (`istMonthWindowUtc`). Month/year/page are validated; bad input is a 400, never an empty-but-200 lie.
- **Ordering & statutory serial:** deterministic `created_at ASC, id ASC`; the serial is the record's 1-based position in that order within the month, stable across pages (serial = pagination offset + row position). The schema captures **no** statutory serial column, so the serial is **derived** — a presentation of stable ordering, not an invented stored field (see "Open issues").
- **No silent omission:** every record of the month appears. Each is graded with `evaluateFormFCompleteness` — the exact four predicates of the finalize gates (`lib/pcpndtCompliance.ts`), extracted so gates and register can never drift apart. Incomplete records carry `completionStatus: "incomplete"` plus the missing-field messages; the response also returns `incompleteCount`.
- **Test linkage — Form-F tests of all kinds, only Form-F tests:** each record's `linkedTests` lists the **Form-F-designated** tests billed on its linked order — the designation is the admin-configured `clinic_settings.formFTestIds` (the same definition the pending queue uses), so any modality/procedure designated as Form-F-requiring appears (never fetal/echo-only), while non-Form-F tests on the same bill are deliberately excluded from the statutory register. Resolution is batched (settings + bills + order_tests joins), no N+1. Records without a bill linkage (e.g. WhatsApp intake) or with no designation configured show an empty list; the UI falls back to the form's free-text `procedure` field for display.
- **Fields:** only data the application already captures on `form_f_records` (patient identifiers, husband/father name, address, referrer, doctor, procedure/purpose/basis, GA, ultrasound result, abnormality, consent/procedure dates, result conveyed, ID-verification state, bill number, fetal-USG study linkage, timestamps).

## Export & audit

The CSV export always covers the **complete month** (no pagination), uses the repo's standard CSV escaping, and is written to the tamper-evident hash-chained audit log (`auditFromRequest`: `action: "export"`, `entityType: "form_f_register"`, `entityId: "YYYY-MM"`, record + incomplete counts in `newValue`). An invalid request never produces an audit entry.

## UI

FormF page → **Monthly Register** tab (rendered only for management roles, matching the API gate): month/year picker, graded table with incomplete-field callouts, pagination, **Export CSV** (server-generated, audited) and **Print Register** — the print fetches every page first so the printed document also covers the complete month, using the existing Form F window-print pattern (A4 landscape).

## Tests

`lib/formFRegister.test.ts` (window boundaries, validation, serial stability, grading, Form-F-test linkage, CSV escaping, empty month), `routes/form-f.register.test.ts` (admin gate attached, 400s, offset-stable serials, designation filtering — a non-Form-F test on the bill never appears, empty-designation semantics, audited export, empty month) and the source contracts in `formFRegisterContract.test.ts`.

## Partition rule — which register an entry belongs to

The month's Form F records are **partitioned** between the two statutory books, never duplicated:

- **Referral named a doctor** → the Rule 9(1) Monthly Register (above). Its JSON, CSV export and print all contain doctor-referred records only.
- **Referral is self/walk-in** (no `doctor_name`, `referred_by` blank/"Self"/"walk-in") → the **Self-Referral OPD register** below, provided the patient is also a Form F **test** patient (both criteria).

Each register's serials are continuous within itself.

## Self-referral OPD register (Form 25 replica)

PCPNDT rule: a sonologist may perform ultrasonography on a **self-referred** pregnant woman only when the sonologist runs an OPD, examines pregnant women, and keeps a **separate obstetrical-checkup record** of them — "self-referred by the patient or a relative" alone is not a lawful referral. The **Self-Referral OPD** tab (kept beside the Monthly Register, management-only) is that record:

- `GET /api/form-f/register/self-referral-opd?month&year&page&pageSize` — same admin gate, IST month window and deterministic ordering as `/register`; auto-filled with the month's records meeting **both criteria**: (1) self-referral/walk-in per `isSelfReferralRecord`, and (2) a Form F **test** patient — the linked bill carries a `formFTestIds`-designated test; a record with no bill linkage (e.g. WhatsApp intake) or with no designation configured counts, since the Form F record itself evidences the test. Serials are continuous among the qualifying records.
- Rendered and printed as a **FORM 25 (formerly 3C) daily case register replica** (the format already used by accounting's Form3C component): Date · Sl. No. · Patient's name (+ spouse/father) · Nature of professional services — **prefilled "General Obstetrical Checkup"** · Fees received — **"Complimentary / Free"** (total ₹0) · Date of receipt.
- Examining doctor recorded on the sheet and signature line: **Dr. Sugandha Priyadarshini** (`SELF_REFERRAL_OPD_DOCTOR` in `lib/formFRegister.ts` — a single named constant; change it there if the examining clinician ever changes).
- The checkup date resolves procedure date → form date → the record's creation date (the OPD examination happens at the visit, so the record's creation day *is* the attendance day — unlike the Rule 9(1) Date of Procedure, which is never back-filled).
- Print covers the complete month; the endpoint is inside the `/api/form-f/register` network-only prefix (never cached).

## Auto-prescription for self-referral patients (digitally signed)

Every patient who qualifies for the Self-Referral OPD register also gets an **auto-generated advice prescription**, created idempotently (one per Form F record, `ON CONFLICT DO NOTHING` on the unique `form_f_record_id`) at Form F save time and re-ensured whenever the OPD register is viewed (covers historical records):

- **Content (fixed):** "Patient for Obstetrical Examination. / Advice: Sonography for Fetal Well Being (FWB)." — prescriber **Dr. Sugandha Priyadarshini, MBBS, MD** (constants in `lib/formFRegister.ts`).
- **Digital signature (built for this feature):** at signing time the row snapshots (1) the signer identity block incl. the registration number from the existing `signatures` master (active row matching "Sugandha"), (2) the signature **image** from that master — a snapshot, so later edits to the master never alter a signed prescription, and (3) a **SHA-256 content hash** over the canonical prescription content, making later tampering detectable. The printed sheet carries the signature image plus a "Digitally signed by … on … (IST) · Integrity SHA-256: …" block.
- **Printing:** the OPD register's per-row **Rx** button prints an A5 prescription on the clinic letterhead (branding endpoint). Fetch endpoint: `GET /api/form-f/register/self-referral-opd/prescription/:recordId` (admin-gated, inside the network-only prefix).
- **Storage:** `self_referral_prescriptions` (migration `migrations/self_referral_prescriptions.sql`, idempotent). If no signature image is configured in the signatures master, the prescription still saves and prints with the identity + hash block only — configure Dr. Sugandha's signature under Reports → Signatures to include the image.

## Open issues — statutory data the application does not currently capture

Stated plainly rather than fabricated (per the stabilization brief):

1. **Stored statutory serial:** the Government register format expects a persistent serial per Form F entry; today's serial is derived from stable ordering. Backdated inserts cannot occur (`created_at` is server-set), so derived serials are stable in practice — but a stored, gap-free statutory serial column (assigned at record creation) would make the register robust to any future data correction. Needs a migration + numbering policy decision.
2. **Result-conveyed date** is a free-text field; the statutory format wants an explicit date.
3. **Declaration blocks** (the doctor's and the pregnant woman's declarations with signatures) exist only on the per-record printed Form F, not as structured register data.
