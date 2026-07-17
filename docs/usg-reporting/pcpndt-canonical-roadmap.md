# PCPNDT Canonical Migration Roadmap & Configuration-Driven Design

**Status: roadmap and design only. No implementation in this document or the PR that produced it.**

> **Implementation update (Part 1 steps 2 & 4 — done):** the Form F
> verification now lives in ONE shared function,
> `artifacts/api-server/src/lib/pcpndtCompliance.ts`, called by the legacy
> `usgReports.ts` finalize (byte-identical responses), by BOTH canonical
> server-side gates (`patient-reports.ts` POST /, `internal-radiology.ts`
> report-status REPORT_FINAL), and by `fetalUsgLevel4.ts` final-sign (which
> previously had **no** Form F check at all). The canonical gates are no
> longer blanket blocks: a compliant obstetric study finalizes through the
> canonical workspace normally; a non-compliant one is refused with the
> exact missing fields; an admin/super_admin may override with a documented
> reason, audited (`pcpndt_override_finalize` in `audit_logs` /
> `fetal_usg_audit_logs`) — mirroring the legacy finalize-force gate. The
> workspace UI shows live compliance status (red missing-fields notice /
> green verified) via `GET /api/patient-reports/pcpndt-compliance/:patientId`
> and unblocks automatically once Form F is completed. The by-patient-latest
> lookup semantics were kept deliberately (see §1.6 — a per-study date
> window would false-block Form F records completed at registration, before
> the study). Steps 3 (inline Form F UX — the tab hand-off remains), 5–6
> (legacy retirement) and Part 2 (config-driven classifier) remain open.
**Produced for:** PR C (CARE USG Gold Standard, Complete Study Library & Canonical PCPNDT Migration Roadmap), Phases 8–9.
**Builds on:** [`platform-consolidation-pr-b.md`](./platform-consolidation-pr-b.md) §17.1/§18.1 (where this exact roadmap was first promised), and the PCPNDT guard code itself (`isObstetricUsgStudy()` in both `usgModality.ts` files, the finalize blocks in `RadiologyReportingWorkspace.tsx`/`patient-reports.ts`/`internal-radiology.ts`).

This document has two parts: **Part 1** is the migration roadmap for eventually retiring the legacy `usgReports.ts` PCPNDT pipeline once the canonical platform can do everything it does. **Part 2** evaluates replacing the regex-based `isObstetricUsgStudy()` classifier with a configuration-driven `requiresPCPNDT` property, per this PR's explicit review request. Neither part is implemented here — both are deliberately scoped as design work for a future, separately-scoped PR, consistent with the prior audit's own recommendation that the PCPNDT reconciliation decision be made *last, with full information*, not folded into a content-completion PR.

---

## Part 1 — Canonical PCPNDT Migration Roadmap

### 1.1 Current legacy pipeline (what actually enforces PCPNDT compliance today)

The **only** pipeline in the codebase that performs the real PCPNDT Form F check is:

- **Page**: `artifacts/diagnostic-erp/src/pages/UsgReporting.tsx` — a full draft → verify → quality-check → finalize → amend USG report editor. Not nav-linked (deliberately, per PR B) but still routed at `/usg/reporting` and fully functional.
- **API**: `artifacts/api-server/src/routes/usgReports.ts` (688 lines) — `POST /`, `POST /auto-generate`, `PATCH /:id`, `POST /:id/regenerate`, `POST /:id/verify`, `POST /:id/quality-check`, `POST /:id/finalize`, `POST /:id/finalize-force` (super-admin override), `POST /:id/amend`, `GET /prior/by-patient/:id`.
- **Table**: `usg_report_drafts` — an entirely separate draft table from the canonical workspace's `patient_reports`/`radiology_report_drafts`.
- **The compliance gate itself**: `usgReports.ts:464–503`, inside `POST /:id/finalize`. For any draft whose `templateType` starts with `"OB_"` (i.e. an obstetric template from the 13-template `usgReportTemplates.ts` catalog — `OB_EARLY`, `OB_GROWTH`, `OB_ANOMALY`):
  1. Looks up the most recent `form_f_records` row for `existing.patientId` (`formFRecordsTable`, ordered by `createdAt` desc).
  2. `400`s with `"PCPNDT Form F record is missing for this obstetric study."` if none exists.
  3. Otherwise validates four fields on that record and `400`s listing exactly which are missing/unverified: `idCardVerified` (boolean, set via a separate ID-card OCR + human-verify flow), `husbandFatherName`, `address`, and (`consentDate` OR `procedureDate`).
  4. Only if all four pass does finalize proceed.
- **Form F record management**: `artifacts/api-server/src/routes/form-f.ts` (1137 lines) — a full CRUD/OCR/verification surface: `GET /fetch-billing/:search`, `POST /save`, `GET /pending`, `GET /list`, `PATCH /update-patient-data`, `GET /ocr-status`, `POST /upload-id` (ID card image upload), `PATCH /verify-id-data/:id` (the human verification step that sets `idCardVerified`), `GET /:id`, `POST /send-whatsapp`, `GET /export-for-portal/:billNumber`. Most write/sensitive routes are gated by `requireStaffPermission("/form-f")` — a **distinct, granular permission scope**, not merely inherited from the general `/reports` permission (the general nav-visibility check for the `/form-f` *page* piggybacks on `/reports`, per `staffSession.ts:106`, but individual sensitive actions inside the page require the dedicated `/form-f` grant — two layers, not one).
- **Digital signature**: Form F has **no signature mechanism of its own**. Compliance is represented by `idCardVerified: boolean` plus the text fields above — not by a cryptographic or countersignature artifact the way `patient_reports` rows are (`signaturesTable`, `signedByName`/`signedAt`/`structuredJson.audit.signature`). The legacy `usgReports.ts` finalize *does* separately produce a SHA-256 finalize hash of the report content itself (a data-integrity hash, not a Form-F-specific signature).
- **Audit trail**: the legacy pipeline has its own amendment chain (`POST /:id/amend`) and (per the prior architecture audit, doc 01) a real audit log — but this is a *second*, independent audit trail from the canonical workspace's `audit_logs`/`patient_report_amendments` chain, not a shared one.
- **Locks**: the legacy pipeline does **not** appear to use the canonical workspace's M1.6A study-lock mechanism (`checkWriteLock`) — it has its own draft/verify/finalize state machine on `usg_report_drafts.status` instead.

### 1.2 Current canonical platform (what exists today, post PR B/PCPNDT-guards/PR C)

- **One shared reporting lifecycle**: draft save (`radiologyReportLifecycle.ts` → `/api/radiology/report-generator/save-draft`), finalize (`finalizeRadiologyReport()` → `POST /api/patient-reports` + `POST /api/internal/radiology/report-status`), print, audit (`audit_logs`), amendment (`patient_report_amendments`), versioning — already modality-generic, already used by MRI/CT/general USG today.
- **Locks**: M1.6A study-lock mechanism (`checkWriteLock`), already generic, already applies to any study opened in the canonical workspace including obstetric USG.
- **Digital signatures**: `signaturesTable` + `POST /:id/sign` + the D5 structured-finalize path's cryptographic signing (content-hash + signer identity + timestamp) — already generic, already applies to any canonical report.
- **Permissions**: the canonical workspace's general radiology permission model (`/reports`-family paths, `canSign`/`canStructuredSign` authority checks) — already generic.
- **PCPNDT-specific protection that DOES exist in the canonical path today**: two hard *blocks* (client-side in `finalizeReport()`, server-side in `POST /api/patient-reports` and `POST /api/internal/radiology/report-status`) that prevent an obstetric/fetal ultrasound study from reaching `REPORT_FINAL` through the canonical workspace **at all** — see `platform-consolidation-pr-b.md` §8. This is a *safety net*, not a compliance workflow: it stops the unsafe case, it does not implement the compliant case.

### 1.3 Missing features the canonical platform needs before it can host PCPNDT-compliant obstetric finalize

Everything below is **absent** from the canonical path today and would need to be added before the legacy pipeline could be retired:

1. **Form F linkage to the canonical report.** `form_f_records` links to `billId`/`patientId`/`fetalUsgStudyId` — it has no column linking it to a `patient_reports.id` or `radiology_worklist.id`. The canonical finalize would need a way to resolve "does this obstetric study have a complete Form F record" (by patient, as the legacy path does) *before* allowing finalize to proceed, not just after blocking it.
2. **The Form F compliance check itself**, ported into (or called from) the canonical finalize path — the same four-field check (`idCardVerified`, `husbandFatherName`, `address`, `consentDate`/`procedureDate`) `usgReports.ts:464–503` already implements correctly. This must not become a *second*, independently-drifting implementation of the same regulatory rule — see §1.6.
3. **A canonical UI surface for completing Form F inline** (or a seamless hand-off), so a radiologist working an obstetric study in the canonical workspace isn't dead-ended by the current guard's "go finalize elsewhere" message. The existing "Review & Map to Form F" button (opens `/form-f` in a new tab, prefilled) is a reasonable starting point, but today it's a one-way, non-returning hand-off — the canonical workspace has no way to know Form F was subsequently completed without a page reload/re-fetch.
4. **A super-admin force-finalize override**, matching `usgReports.ts:POST /:id/finalize-force` — the legacy pipeline has an explicit, audited escape hatch for exceptional cases; the canonical path currently has none for PCPNDT specifically (only the unconditional block).
5. **Reconciling the OCR/ID-verification workflow** (`form-f.ts`'s `upload-id`/`ocr-status`/`verify-id-data`) — this is real, working infrastructure with no canonical-workspace equivalent or entry point today.
6. **A decision on the obstetric-template-type signal.** The legacy check gates on `templateType.startsWith("OB_")` (a fixed, 13-value enum from `usgReportTemplates.ts`). The canonical guard gates on `isObstetricUsgStudy()` (a free-text regex over `modality`+`studyDescription`). These are two different classification mechanisms answering the same question — see Part 2 for whether/how to unify them.

### 1.4 Required migration order

Ordered so each step is independently safe, testable, and rollback-able — no step requires the next step to already exist:

1. **Add the Form F ↔ canonical-report linkage** (a new nullable FK column on `form_f_records`, or a lookup-by-patient-and-date-range join — schema decision deferred to the actual migration PR). Purely additive; zero behavior change on its own.
2. **Port the Form F compliance check as a shared, single function** callable from both `usgReports.ts` and the canonical finalize path — not copy-pasted twice. This is the step that turns the canonical guard from "always block" into "block only if genuinely non-compliant, else allow." Requires real integration tests against a live-migrated test database (the ephemeral-Postgres technique already demonstrated in PR B/PR C is directly reusable here) before merging, given the regulatory stakes of getting this wrong in either direction (false-allow *or* false-block).
3. **Build the inline/return-trip Form F completion UX** in the canonical workspace (or accept the current tab-based hand-off as permanent — a legitimate, lower-effort option; see §1.5).
4. **Add the canonical equivalent of force-finalize**, audited, permission-gated identically to the legacy one.
5. **Only after 2–4 are live and have run in production for a reasonable observation period** (this roadmap does not prescribe a specific duration — that is an operational decision for whoever owns this migration): begin routing *new* obstetric finalizes exclusively through the canonical path, by removing the `usgReports.ts` route's own reachability (not the code, and never the table — see §1.7) from `UsgReporting.tsx`, or by simply never nav-linking it and letting its zero-traffic state persist.
6. **Retire `UsgReporting.tsx`/`usgReports.ts` only after step 5 has been stable long enough that no legitimate workflow still depends on it.**

### 1.5 Dependencies

- Step 2 (shared Form F check function) depends on step 1 (linkage) existing, unless the check is done by-patient-only (matching the legacy pipeline's own current behavior, which does not scope by report/study either — see §1.6's honesty note about this).
- Step 3 (inline UX) is **not** a hard dependency for steps 4–6 — the current tab-based hand-off is functionally sufficient, just less smooth. This roadmap explicitly recommends treating step 3 as optional/deferred rather than blocking the rest of the migration on a UX polish item.
- Step 5 depends on steps 2 and 4 both being live (compliance check + override) — retiring the legacy path before the canonical path can express "yes, compliant, proceed" and "no, but a supervisor is overriding" would leave PCPNDT-relevant radiologists with no legitimate path to finalize a compliant obstetric study.

### 1.6 Risk

- **Regulatory risk is the dominant concern.** PCPNDT is a criminal-liability statute in India (the Act this workflow exists to comply with carries criminal penalties for non-compliant prenatal diagnostic reporting). A bug in step 2's ported check — in either direction — is not an ordinary software regression:
  - *False-allow* (a non-compliant study is allowed to finalize) is the more severe failure mode and the reason this roadmap insists on real, live-DB-tested integration coverage before that step ships, not merely unit tests of the predicate.
  - *False-block* (a compliant study is refused) is a workflow/availability problem, not a compliance problem, but still needs guarding against with real test coverage — an over-broad block that stops legitimate obstetric finalizes indefinitely would push radiologists back to the legacy pipeline anyway, defeating the migration's purpose.
- **A pre-existing honesty note, carried forward from the legacy code itself, not introduced by this roadmap**: the legacy check looks up Form F **by `patientId` only**, taking the most recent record (`orderBy(desc(formFRecordsTable.createdAt)).limit(1)`) — it does not verify that *specific* Form F record corresponds to *this specific* obstetric study/visit. A patient with multiple obstetric studies over time could, in principle, have an old Form F record satisfy the check for a new, unrelated study. This is an existing characteristic of the current legacy compliance gate, not something this roadmap's migration would introduce — but a canonical port is a natural opportunity to tighten it (e.g. scope the lookup by patient AND a date window, or require a Form F record created after the study's own date), and this roadmap explicitly flags that decision as in-scope for whoever implements step 2, not something to silently carry forward unexamined.
- **Split-brain risk during the transition window** (between step 2 and step 6): two live pipelines both capable of legitimately finalizing an obstetric report. The existing worklist-status/report-row model does not have a natural single source of truth across `usg_report_drafts` and `patient_reports` for "has this study already been finalized." This is the same "duplicate finalize systems" risk the original architecture audit (doc 01/09) flagged before PR B ever started, and it remains open until step 6.
- **Permission-model risk**: the `/form-f` permission scope and the canonical workspace's `/reports`-family permissions are independent grants today. A staff member with report-finalize authority but no `/form-f` grant (or vice versa) is a real, already-possible configuration — the migration must decide whether canonical PCPNDT finalize requires *both* grants, and communicate that to whoever administers staff permissions.

### 1.7 Backward compatibility & historical reports

- **No historical report is touched by this roadmap, ever, at any step.** Every step above is additive (new column, new shared function callable by both pipelines, new UI affordance) or a reachability change (removing a nav path, not deleting a route/table). This mirrors the precedent already set by PR A (`calc_version` stamping, zero recalculation of existing rows) and PR B (zero migration of `usg_report_drafts`/`fetal_usg_*` history).
- **`usg_report_drafts` is never deleted or migrated into `patient_reports`.** Reports already finalized through the legacy pipeline remain exactly as they are, in their own table, indefinitely — even after step 6 "retires" the pipeline in the sense of removing new-traffic access to it. Retirement means *no new drafts can be created there*; it does not mean the historical data disappears or becomes unreadable. Any read-only surface currently used to look up a patient's past legacy reports (e.g. `GET /prior/by-patient/:id`) should remain functional after retirement.
- **The legacy Form F CRUD (`form-f.ts`) is not proposed for removal at any step of this roadmap** — Form F itself (the record type) is the actual regulatory artifact and continues to exist and be edited regardless of which *report* pipeline references it.

### 1.8 Legacy retirement plan (the explicit target state)

Legacy `usgReports.ts`/`UsgReporting.tsx`/`usg_report_drafts` may be retired (in the reachability sense of §1.4 step 5–6 — never in the data-deletion sense) **only after all of the following are true simultaneously**:

- [ ] Form F ↔ canonical-report linkage exists and is populated for new studies (§1.4 step 1).
- [ ] The PCPNDT compliance check itself runs inside the canonical finalize path, as one shared function also used by the legacy path — not a second, drifting reimplementation (§1.4 step 2, §1.6).
- [ ] A canonical, audited force-finalize override exists for exceptional cases, gated the same way the legacy one is (§1.4 step 4).
- [ ] Locks: confirmed the canonical path's existing M1.6A lock mechanism is sufficient for obstetric studies too (no PCPNDT-specific locking gap was found in this review — flagged here for the implementing team to re-confirm, not assumed).
- [ ] Digital signatures: confirmed the canonical path's existing D5/legacy sign mechanism is an acceptable signature artifact for a PCPNDT-relevant report (no PCPNDT-specific signature requirement was found in the legacy pipeline to replicate — Form F's own "compliance" signal is `idCardVerified` + text fields, not a signature).
- [ ] Permissions: an explicit decision has been made and implemented on whether canonical PCPNDT finalize requires both `/reports`-family and `/form-f` grants (§1.6).
- [ ] The migration has run in production long enough, with the legacy pipeline's traffic monitored, that no legitimate in-flight workflow still depends on it (duration is an operational decision, not specified here).

Until every box above is checked, the legacy pipeline remains the **only** genuinely PCPNDT-compliant finalize path in this codebase, and both PR B's and this PR's guards deliberately continue routing users toward it rather than around it.

---

## Part 2 — Configuration-Driven PCPNDT Proposal (`requiresPCPNDT`)

### 2.1 The question

Should `isObstetricUsgStudy(modality, studyDescription)` — a hardcoded regex classifier, duplicated (by necessity, per this codebase's own established convention) between the frontend and backend packages — be replaced by a `requiresPCPNDT` **configuration property**, settable per study type without a code change?

### 2.2 Where it would have to live

There is no existing per-study-type configuration row today that both (a) already exists as a live, wired table, and (b) is checked at exactly the two points that need it (the canonical finalize guards). The candidates:

| Option | Verdict |
|---|---|
| **New column on `radiology_study_tabs`** (e.g. `requires_pcpndt boolean`) | Closest fit conceptually — a per-region flag. But `radiology_study_tabs` rows are shared across MRI/CT/USG regions and keyed only by free-text `name`, with no modality column of its own; a USG "Obstetric"/"NT"/"Growth"/"Anomaly" tab flagged `requires_pcpndt = true` would need every *new* obstetric-USG tab this PR (and any future one) creates to remember to set it — a manual, easy-to-forget admin step, replacing a code-reviewed regex with an unreviewed data-entry step for a regulatory-compliance flag. |
| **New column on `radiology_protocols`** | Similar shape, but a study can have multiple protocols (see the Gold Standard doc's per-study protocol) and not every obstetric study necessarily has a protocol row selected at the moment finalize is attempted — the flag would need to live somewhere resolvable *without* depending on which protocol (if any) was chosen, since the guard fires on the underlying study's modality/description, not on protocol selection. |
| **New, dedicated small lookup table** (e.g. `pcpndt_relevant_study_patterns`) | The cleanest data model, but this is unambiguously a **new table** — schema change, migration, admin UI to manage it, and a third mechanism (beyond `radiology_study_tabs`/`radiology_protocols`) an admin would need to understand. |
| **Reuse `radiology_worklist.studyDescription` matching against an admin-editable keyword list** (config-driven regex, not a fixed one) | Genuinely the smallest schema footprint (one new settings-managed list, no new column on a per-study-tab/protocol basis) — closest to "configuration-driven" in spirit without a broad schema change. Discussed further in §2.4 as the recommended shape *if* this is pursued. |

**None of these is free.** Every option needs at least one schema change (new column or new table) and a settings-UI surface to manage it safely (a regulatory-compliance flag should not be editable only via direct SQL). This is the basis for this PR's decision (§2.5) to defer implementation.

### 2.3 What the regex approach already gets right, and where it falls short

**Right**: `isObstetricUsgStudy()` is a single, shared, unit-tested, code-reviewed function — changing it goes through the same review rigor as any other compliance-relevant code change. It requires zero admin action to "just work" for the ~15 obstetric/fetal study types this PR's Gold Standard doc defines, since they're all matched by the existing broad pattern (`obstet|pregnan|fetal|gestation|nuchal|nt\s*scan|anomaly\s*scan|growth\s*scan|tiffa`).

**Falls short**: (a) a clinic that names a study something the regex doesn't anticipate (a genuine false-negative risk, already flagged in PR B §17.1/§18.1's classification honesty note) has no way to fix that without a code change and a redeploy; (b) it cannot express "this specific site never wants to allow PCPNDT-relevant studies through the canonical path, period" or other per-deployment policy variance, since CARE ERP is a multi-tenant-adjacent product (the audit found clinic-settings-driven branding elsewhere in this codebase) and different clinics may have different obstetric study-naming conventions.

### 2.4 Recommended shape, if pursued (design, not built)

If a configuration-driven approach is adopted, the recommended shape — chosen to minimize schema surface while staying admin-manageable and audited — is:

1. A new, small settings-managed table, `radiology_pcpndt_patterns` (a genuinely new table — this proposal does not claim to avoid that cost, only to make it as small as possible): `id, pattern (text, a single keyword or short regex fragment), is_active, created_at, created_by`. Seeded on migration with exactly the keyword set `isObstetricUsgStudy()` already uses today (`obstet`, `pregnan`, `fetal`, `gestation`, `nuchal`, `nt scan`, `anomaly scan`, `growth scan`, `tiffa`), so behavior is byte-identical on day one.
2. `isObstetricUsgStudy()` is **not removed** — it becomes the fallback/default when the table is empty or unreachable (defense against a misconfigured or accidentally-emptied pattern list silently disabling PCPNDT protection entirely — a regulatory guard must fail closed, not open).
3. A small, admin-only settings section (new tab inside the existing `RadiologyQuickSelectSettings.tsx` or `RadiologySettingsCenter.tsx` — **not** a new settings page, consistent with the Hard Rules) to view/add/deactivate patterns, with every change going through `audit_logs` (this table's writes are compliance-relevant and must be attributable).
4. Both the frontend and backend classifiers query (or receive, via a cached settings fetch) the same pattern list — reusing the existing "deliberate documented duplicate" convention for the *lookup mechanism*, not the *data*, since the data now lives in one shared DB table both packages read.

### 2.5 This PR's decision: designed, not implemented

Per this PR's own scope boundary (Phase 9: "design, NOT implement"), and because every option above requires a schema change plus a new admin-audited settings surface — more surface than "one small classifier swap" — **no code from §2.4 is implemented in this PR.** The existing `isObstetricUsgStudy()` regex classifier remains the live mechanism. This section exists so that if/when a clinic's real-world obstetric study-naming diverges from the current pattern (the concrete trigger that would justify this migration), the design is ready to execute without re-deriving it from scratch, and the exact schema/migration/audit shape it would take is already decided.

### 2.6 Schema impact summary (for the record)

- **New table**: `radiology_pcpndt_patterns` (id, pattern, is_active, created_at, created_by) — 1 table, ~5 columns, 1 unique index on `pattern`.
- **No changes** to `radiology_study_tabs`, `radiology_protocols`, `radiology_worklist`, or any existing table.
- **No changes** to the guard call sites' function signatures — `isObstetricUsgStudy(modality, studyDescription)` keeps the same shape; only its *implementation* would change from a hardcoded regex to a DB-backed pattern list (with the hardcoded regex retained as the fail-closed fallback).

### 2.7 Migration strategy (for the record)

1. Add the table, seeded with the current regex's keyword set (byte-identical behavior on day one — this step alone changes nothing observable).
2. Wire both classifiers to read the table with the regex as fallback; ship behind a feature flag (this codebase already has an established `isFeatureEnabledServer`/`ff_*` convention) defaulting OFF, so the regex remains authoritative until explicitly flipped.
3. Build the settings UI section.
4. Flip the flag only after confirming the seeded pattern list is verified equivalent to the regex (a straightforward unit-test comparison: every string the regex matches, the seeded pattern list must also match, and vice versa).
5. Regex stays in the codebase permanently as the fail-closed fallback — never deleted, even after the flag is on, per §2.4 point 2's fail-closed requirement.
