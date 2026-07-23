# PCPNDT Form F compliance — Fetal Echocardiography

**Status:** implemented (stabilization PR 2). **Scope:** fetal (prenatal) echo only — adult echocardiography is deliberately untouched.

## What was wrong

A fetal echocardiography study is by definition a prenatal ultrasound examination of a pregnant patient, yet its finalization path had **no PCPNDT Form F check**:

- `POST /api/echo-cardiology/fetal/:studyId/finalize` finalized with only a critical-alert check, while the identical obstetric workflow in `fetalUsgLevel4.ts` gates its final-sign through the shared compliance engine.
- Worse, `POST /api/echo-cardiology/fetal/:studyId` (draft save) accepted any client-supplied `status`, including `"final"` — an equivalent finalization path that skipped review, critical-alert acknowledgement **and** Form F, silently and without an audit trail.

## What is enforced now (server-side; frontend disabling is never the control)

1. **Finalize gate** (`enforceFetalEchoPcpndtGate` in `routes/echoCardiology.ts`):
   - Runs `checkPcpndtFormFCompliance` from `lib/pcpndtCompliance.ts` — the **one** shared engine also used by the legacy `usgReports` finalize, the canonical `patient-reports` gates and `fetalUsgLevel4`. No duplicated Form F logic.
   - Patient resolution: the fetal-echo row's `patientId`, falling back to the linked `radiology_studies` row (`fetal_echo_studies.study_id → radiology_studies.id`). **Fails closed**: no resolvable patient → blocked; a DB error propagates to a 500, never to `compliant=true`.
   - Blocked attempts return **409** with a human-readable `error` (the ERP toaster shows `error` verbatim, so the message itself lists the missing fields), plus `code: "pcpndt_compliance_required"`, `validationErrors[]` and `formFId`.
   - **Every blocked attempt is audited** (`pcpndt_blocked` in `fetal_echo_audit_logs`, with the attempted action and missing fields) — not only overrides.
2. **Override contract** — identical to `fetalUsgLevel4` final-sign: `pcpndtOverride: true` + `pcpndtOverrideReason` (≥ 3 chars), roles in `PCPNDT_OVERRIDE_ROLES` (admin / super_admin) only, audited as `pcpndt_override_finalize` with the reason and the missing fields.
3. **Equivalent-path guard** — the draft-save endpoint may echo an already-`final` status back (so existing save flows don't break) but can never **escalate** a study to `final`: that request is a 409 (`code: "finalize_endpoint_required"`), audited, and nothing is written. `fetal_echo_studies` has no other writers in the codebase (verified by sweep; the adult-echo writers touch `echo_reports` only).

## Configurability

The repo's existing PCPNDT configuration surface is `clinic_settings.formFTestIds` (which billed tests **require** a Form F — drives the pending queue and the register's test linkage). The finalize gates, including this one, are deliberately **unconditional** on their obstetric workflows, matching `fetalUsgLevel4`: a fetal echo cannot be non-obstetric, so there is no per-test toggle to consult. If a per-workflow toggle is ever wanted, it belongs in `clinic_settings` beside `formFTestIds` — not as a fork of the compliance engine.

## UI behaviour

`FetalEcho.tsx` surfaces the 409 as a "PCPNDT Form F required" toast containing the server's message (which lists the exact missing fields). The finalize control itself stays enabled — enforcement is server-side; the toast tells the sonologist what to complete.

## Tests

`routes/echoCardiology.pcpndt.test.ts` (13 tests, run through the real handlers and the real compliance engine): missing Form F, incomplete Form F (exact field messages), complete Form F, unauthorized override, admin override with/without reason, `radiology_studies` patient fallback, fail-closed on unresolvable patient, draft-save escalation (update & insert paths), already-final echo-back, ordinary draft save, and proof the adult finalize never consults Form F. Source contracts in `diagnostic-erp/src/lib/formFRegisterContract.test.ts` keep the gate, the audit actions and the guard from silently disappearing.

## Known limitations (honest)

- The gate's lookup is **by-patient-latest** Form F (the engine's documented decision, `lib/pcpndtCompliance.ts` header) — per-study date-window matching was considered and rejected there; this PR follows the engine.
- The block/override audit lives in `fetal_echo_audit_logs` (the echo module's existing audit store), not the global hash-chained `audit_logs`; unifying the module audit stores is a separate consolidation item from the platform audit.
