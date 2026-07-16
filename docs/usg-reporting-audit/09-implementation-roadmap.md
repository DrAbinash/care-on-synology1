# 09 — Implementation Roadmap & Merge-Risk Assessment

*Synthesis document, written by the audit author as Lead Architect. As-of commit: `15ed9dfc` on `origin/feature/website-login-redirection`, cross-checked against `origin/claude/radiology-clinical-history-chips-j04t4b` (the active concurrent branch) at `b0e83b39`.*

---

## Part A — Merge risk: what's actually happening right now

This is not a hypothetical. As of writing, `claude/radiology-clinical-history-chips-j04t4b` — the branch that produced PRs #71–#80 (Smart Findings, Structured Finding Assistant, Clinical History chips, Command Palette, CARE Copilot) — **still exists remotely with one unmerged commit**: *"Radiology: CARE Copilot Phase 2 — smart auto-completion + Copilot settings,"* touching:

- `artifacts/diagnostic-erp/src/components/radiology/CareCopilotPanel.tsx`
- `artifacts/diagnostic-erp/src/hooks/useCopilotPrefs.ts` (new file)
- `artifacts/diagnostic-erp/src/lib/copilotCompletion.ts` (new file, + test)
- `artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx`

This confirms, concretely, that `RadiologyReportingWorkspace.tsx` and its adjacent `components/radiology/*` files are an **active, live target** for another line of work right now, not a stable base to build against. Any USG implementation plan needs to account for this as an ongoing condition, not a one-time snapshot to work around.

### File risk classification

| Risk tier | Files | Why |
|---|---|---|
| **🔴 Hot — expect concurrent edits** | `pages/RadiologyReportingWorkspace.tsx`, `components/radiology/CareCopilotPanel.tsx`, `lib/copilotOrchestrator.ts`, `lib/copilotCompletion.ts`, `hooks/useCopilotPrefs.ts` | Confirmed actively edited (commits landing within the last day at time of writing, more likely still in flight). |
| **🟡 Warm — recently touched, may still be iterated on** | `components/radiology/QuickFindingsPanel.tsx`, `components/radiology/StructuredFindingDialog.tsx`, `components/radiology/StructuredQuestionsEditor.tsx`, `lib/smartFindings.ts`, `lib/structuredFindings.ts`, `components/radiology/CommandPalette.tsx`, `lib/commandPalette.ts`, `hooks/useRadiologyPalettePrefs.ts`, `pages/RadiologySettingsCenter.tsx` (Clinical History chip editor) | Received commits in the same recent wave (doc 03 §5, §6, §8); no evidence of further open work on them specifically, but the same author/branch has shown a pattern of rapid iteration on adjacent files. |
| **🟢 Safe — stable, low collision risk** | `routes/radiology-report-generator.ts`, `routes/patient-reports.ts`, `lib/radiologyReportLifecycle.ts`, `lib/radiologyD1FinalWriter.ts`, `lib/db/src/schema/radiology*.ts` (frozen per BEND-1), `pages/RadiologyWorklist.tsx`, `lib/studyLaunchService.ts`, `components/radiology/ReportImagePicker.tsx`/`ReportImagePanel.tsx`, `lib/reportPresentation.ts` | Backend v1 is explicitly frozen (BEND-1); frontend files here weren't touched by the recent radiology-clinical-history-chips wave and aren't part of its apparent trajectory (findings/copilot UI, not worklist/finalize plumbing). |
| **🟢 Safe — USG-specific, effectively unowned** | `routes/usgReports.ts`, `usgDoppler.ts`, `usgExtraction.ts`, `usgAnalytics.ts`, `usgCriticalAlerts.ts`, `fetalUsgLevel4.ts`, `lib/usgExtractor.ts`, `usgMeasurementEngine.ts`, `usgQualityCheck.ts`, `usgReportTemplates.ts`, `pages/UsgReporting.tsx`, `UsgDopplerReporting.tsx`, `FetalUsgLevel4.tsx`, and all USG-specific schema files | Not touched by the concurrent MRI-focused work; this is the natural place to build new USG content without colliding with anything. |
| **🟠 Shared, needs coordination before editing** | `components/radiology/UsgMeasurementReviewPanel.tsx` (embedded IN the hot `RadiologyReportingWorkspace.tsx`), the `structured_report_templates` table/route, `radiology_quick_findings`/`radiology_clinical_history_chips` (shared config tables the concurrent work is actively adding rows/logic around) | Not "hot" by recent-commit evidence, but structurally coupled to hot files — a USG-workspace change here has a real chance of needing to merge alongside whatever the concurrent branch does next. |

### Recommended coordination, not just file avoidance

Given a second agent/developer is verifiably active on this exact area **right now**, the single highest-leverage risk mitigation is not code-level (which files to touch) but process-level: **before starting implementation, confirm with Dr. Abinash whether the two efforts should be sequenced (USG work waits for the current CARE Copilot wave to reach a stopping point) or explicitly coordinated (both agents told about each other, working in adjacent but non-overlapping files with frequent rebase).** This audit cannot make that call — it's a resourcing/scheduling decision, not an architecture one — but flags it as the top item to resolve before writing the first line of USG implementation code.

---

## Part B — Safest implementation order

Ordered to (a) touch 🔴/🟡-tier files as little and as late as possible, (b) fix known-broken things before building on them, (c) deliver visible value early:

### Phase 0 — Prerequisite fixes (no new features, fixes only)
1. **Fix the obstetric GA/EFW unit-mismatch bugs** (doc 06, §3) in `fetalUsgLevel4.ts` — this is a live patient-safety-adjacent bug independent of everything else in this audit and should not wait for any architecture decision. Touches only USG-specific files (🟢 safe tier). **✅ Done — see [`docs/usg-reporting/fetal-usg-calculation-correction.md`](../usg-reporting/fetal-usg-calculation-correction.md).** Also fixed as part of the same PR: the hardcoded `patientId:1/studyId:1` study-creation bug and the duplicate `extract-measurements` route (both noted elsewhere in this audit). `usgMeasurementEngine.ts` and `radiologySmartEngine.ts` still contain their own separate, unfixed formula sets — documented as remaining known duplicates in that doc's §6, not addressed by this fix.
2. **Decide and document the authoritative template layer** for USG (doc 05's recommendation: the YAML content-pack catalog, with `usgReportTemplates.ts` as interim renderer) — a decision record, not code yet.
3. **Decide the PCPNDT compliance-lock integration plan** (doc 04, doc 07) — port the existing logic from `UsgReporting.tsx`/`UsgDopplerReporting.tsx` into a finalize-path gate, or keep the legacy USG pages as the finalize surface for obstetric studies specifically until a later phase. This decision affects how much of Phase 2+ touches the hot `RadiologyReportingWorkspace.tsx` finalize path.

### Phase 1 — Content for the two already-integrated study types, done right
4. Verify/complete USG Whole Abdomen and USG KUB against the now-fixed measurement engine (wire the correct, currently-discarded kidney/prostate/uterus/ovary volume calculations from `usgMeasurementEngine.ts` into an actual display/storage path — doc 06 §1/§2).

### Phase 2 — New study-type content, ordered by doc 05's coverage gaps, safest-file-first
5. **Gynaecology** (TVS protocol content, follicular monitoring, infertility workup) — the biggest coverage gap (doc 05), and the best-suited to the Structured Finding Assistant's `{key}`-templated questions mechanism (doc 04) with minimal new engine code. Primarily touches 🟢-safe USG content files + adds rows to the 🟠-shared settings tables (coordinate timing, not code).
6. **Small Parts completion** (Neck as its own entity, Soft Tissue content, USG MSK) — similarly content-only.
7. **Doppler completion** (Renal/Portal/Hepatic — doc 05 shows these are "one `switch` case away"; Penile, AV Fistula need new vessel presets too) — content + a small, additive change to `usgReportTemplates.ts`'s switch statement (🟢 safe).
8. **General-category gaps** (Hernia, standalone PVR/Appendix/Ascites templates).

### Phase 3 — Measurement library completion (can run parallel to Phase 2)
9. Wire the correct (already-written, currently-discarded) ellipsoid-volume calculations into actual UI display + storage.
10. Add the missing Doppler calculations (S/D ratio trivial; PI needs a new TAMV input field first — doc 06 §4).
11. Add AFI 4-quadrant summation, CPR calculation, EDD-from-dating.
12. Begin wiring the `structuredReport` catalog as the long-term shared measurement store (doc 06's final recommendation) — this is the piece most likely to require coordinating with the concurrent branch if it's still touching structured-report-adjacent code by this point; re-check Part A's hot-file list before starting.

### Phase 4 — Reconciliation of the duplicate finalize systems
13. The single most architecturally significant remaining decision (doc 01, doc 04): what happens to `UsgReporting.tsx`/`UsgDopplerReporting.tsx`/`usg_report_drafts`. Options: (a) retire them once the canonical workspace's PCPNDT gate (Phase 0.3) is live and equivalent, redirecting their routes; (b) keep them as a genuinely separate obstetric-compliance-focused surface indefinitely. This should be a deliberate decision taken with the full picture from Phases 0-3 in hand, not decided upfront.

### Phase 5 — Nav and discoverability cleanup
14. Add sidebar entries for whichever USG pages remain standalone after Phase 4 (doc 01 shows most of the USG module has zero nav link today — a quick, low-risk win independent of everything else, but sequenced last so it reflects the final post-reconciliation page set rather than needing to be redone).

---

## Why this order

- Phase 0 fixes real bugs before anything is built on top of them — building Phase 2 content against still-broken GA formulas would just add more surface area to a bug that already exists.
- Phases 1-2 deliver visible clinical value fastest, touching almost exclusively the 🟢-safe USG-specific file tier, minimizing collision with the concurrent MRI-focused work.
- Phase 3 (measurement library) is scoped to run in parallel with Phase 2 since it's mostly independent, but its final step (structured-report catalog wiring) is flagged as the one sub-task most likely to need re-checking against whatever the concurrent branch has done by then.
- Phase 4 (the finalize-system reconciliation) is deliberately last among the substantive work — it's the highest-stakes decision (regulatory compliance, data-migration-adjacent) and benefits from being made with the most information, not the least.
- Phase 5 (nav) is genuinely last because it's cosmetic and its "right answer" depends on Phase 4's outcome.
