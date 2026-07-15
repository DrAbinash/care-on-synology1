# 07 — Proposed Reporting Core Architecture

*Synthesis document, written by the audit author as Lead Architect, drawing on docs 01-06. As-of commit: `15ed9dfc`.*

## The question as posed, and the honest answer

The task brief asks whether a literal `reporting-core/` directory (with `modalities/mri/`, `modalities/usg/` subdirectories) should be created, with `RadiologyReportingWorkspace.tsx` and its supporting files physically moved into it.

**Recommendation: no — not as a physical file-tree restructuring. Yes — as a logical/architectural discipline that mostly already exists and should be completed, not re-invented.**

Reasoning:

1. **The sharing this question is really asking about already exists, at the level that matters.** Doc 03 and doc 04 establish that the workspace shell, workflow, template mechanism, findings mechanism, draft/finalize/print/audit pipeline, settings framework, worklist integration, and DICOM integration are already ~85-95% modality-agnostic — not because of a `reporting-core/` folder, but because they're built as generic functions operating on data (`modality`, `studyType` region, `templateId`) rather than as MRI-specific code with USG special-cases bolted on. Doc 02 confirms the design documents already governing this codebase (`CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md`, the BEND-1 freeze) already articulate and enforce exactly this "one engine, referenced by every modality" principle.
2. **A physical directory move of a 5,250-line, actively-developed file is high-risk for low reward right now.** Doc 03's own commit history shows `RadiologyReportingWorkspace.tsx` and its supporting `components/radiology/*` files received **fifteen-plus commits in the last two weeks** from a concurrently-active branch (Smart Findings, Structured Finding Assistant, Clinical History chips, Command Palette, CARE Copilot — see doc 03 §16 and doc 08). Moving these files into a new `reporting-core/` tree would conflict with every one of those in-flight changes, for a benefit (folder organization) that doesn't change runtime behavior at all — the code is already shared at the module/import level regardless of which directory it physically lives in.
3. **The BEND-1 freeze contract (doc 02) explicitly prohibits exactly this kind of unforced restructuring** — "a second/competing report lifecycle... a duplicate catalog... without an explicit Backend v2 decision." A directory reorg that touches the frozen backend's route/schema files would need that formal decision; a directory reorg that touches only frontend presentation files gains nothing runtime-visible and still creates a large, hard-to-review diff against a fast-moving target.

**What should happen instead**: treat "reporting-core" as an *architectural role*, not a folder — a defined set of files/tables/endpoints that are understood by convention (and, ideally, documented in one place — this audit can be that place initially) to be shared, modality-agnostic, and requiring extra care/broader review when changed, exactly like `PROTECTED_FILES.md`'s existing 🟢-shared-tier convention already does for other cross-cutting code. New USG-specific work should be added *using* these shared mechanisms (new template rows, new finding rows, new settings rows, new content-pack YAML files) rather than by forking them.

---

## What already functions as the reporting core (no move required)

| Layer | Current location | Role |
|---|---|---|
| Workspace shell + workflow controller | `pages/RadiologyReportingWorkspace.tsx`, `hooks/useReportingWorkflow.ts`, `lib/reportingWorkflow.ts`, `lib/workspaceCommands.ts`, `lib/workspaceReportState.ts` | The 3-column layout, queue/navigation, keyboard dispatcher — modality-agnostic today. |
| Template engine | `routes/radiology.ts` (`structured_report_templates` table), `routes` for `radiology/knowledge/master-templates` | Fetch/auto-select/fill-empty-only mechanism — data-driven, no MRI branching. |
| Findings engine | `lib/smartFindings.ts`, `components/radiology/QuickFindingsPanel.tsx`, `lib/structuredFindings.ts`, `components/radiology/StructuredFindingDialog.tsx` | Section-flip contribution algorithm + structured-question templating — pure, data-driven. |
| Command palette | `components/radiology/CommandPalette.tsx`, `lib/commandPalette.ts`, `hooks/useRadiologyPalettePrefs.ts` | Ranks whatever's already cached for the open study — modality-agnostic by construction. |
| Draft/finalize/print/audit pipeline | `routes/radiology-report-generator.ts`, `routes/patient-reports.ts`, `lib/radiologyReportLifecycle.ts`, `lib/radiologyD1FinalWriter.ts`, `lib/radiologyD1AmendmentWriter.ts`, `lib/reportPresentation.ts` | Save/finalize/amend/print — already generic across modalities. |
| Settings framework | `radiology_study_tabs`, `radiology_quick_findings`, `radiology_quick_measurements`, `radiology_protocols`, `radiology_clinical_history_chips` (region-keyed, `modality`-tagged) | Per-study-type configuration — USG needs new *rows*, not new *schema*. |
| Worklist + DICOM integration | `pages/RadiologyWorklist.tsx`, `lib/studyLaunchService.ts`, `components/radiology/ReportImagePicker.tsx`, `ReportImagePanel.tsx`, `dicom_nodes`/`dicom_pull_jobs`/`dicom_pulled_studies` schema | Already USG-aware (worklist columns, Voluson-specific `dicom_nodes` fields). |
| Structured-report document schema (target future core) | `artifacts/api-server/src/lib/structuredReport/*`, `docs/STRUCTURED_REPORT_JSON_SPEC_v1.md` | Modality-neutral document schema + validator — foundation-only, not yet load-bearing for any modality, but the *right* long-term target for measurement/finding data (see doc 06's recommendation). |

None of these need to move. What needs to happen is:
1. **Documenting them as the core**, explicitly (this document, and a follow-up short reference doc maintained alongside `PROTECTED_FILES.md`), so future contributors — including USG-workspace authors — know what's shared vs. what's safe to add without touching shared code.
2. **Finishing, not restarting, the structured-report wiring** — the schema/validator (`structuredReport/*`) is the one piece that genuinely isn't load-bearing yet, and completing its wiring (behind the existing feature flags, per BEND-1) is the real prerequisite for a trustworthy shared measurement library (doc 06), not a new folder.
3. **Consolidating the three overlapping USG template systems** (doc 05) — `usgReportTemplates.ts`, `radiologyMasterTemplates.ts`'s USG entries, and the not-yet-built rich YAML catalog — into the *same* `structured_report_templates`/content-pack mechanism MRI already uses, rather than a fourth system.

---

## What is genuinely modality-specific and should stay that way

- `usgExtractor.ts` (DICOM SR/GE-private-tag/OCR measurement extraction) — inherently USG-only; MRI has no equivalent extraction pipeline to unify with.
- `UsgMeasurementReviewPanel.tsx` — a genuinely USG-specific review/approve UI (confidence scoring, provenance, "Trace" source viewer) that doesn't generalize to MRI's workflow (MRI has no equivalent auto-extracted-measurement-approval step). Already correctly built as an opt-in tab (`isUltrasound` gate) rather than forced into every modality's UI.
- USG's PCPNDT compliance lock — a regulatory requirement with no MRI analog. This needs a home in the canonical finalize path (a gate, analogous to how sign-authority checks already gate structured finalize) rather than a parallel finalize pipeline.
- `ObDashboardStrip` — an obstetric-specific summary strip, correctly scoped to obstetric studies only.
- The actual clinical content: USG templates, findings catalogs, measurement definitions for each of the ~19 missing/partial study types (doc 05) and the broken/missing calculation formulas (doc 06). This is not "core" — it's the same kind of per-modality content MRI's own templates/findings already are, just USG's version of it.

---

## If a physical `modalities/` split is ever warranted

Not now, but worth naming the trigger condition: if and when this codebase ever splits into genuinely separate deployable services (per `PROTECTED_FILES.md`'s own "Phase 2+" note about eventually rebuilding Radiology without rebuilding Billing as separate Docker images), a physical `reporting-core/` + `modalities/mri/` + `modalities/usg/` split would make sense as part of that larger infrastructure change — at that point the module boundary needs to be enforced by the build system, not just convention. That is explicitly **not** the situation today (single Docker image, single frontend bundle, `PROTECTED_FILES.md` itself says Phase 1 is "labeling & enforcement only, no files moved"), so forcing the directory structure ahead of that infrastructure change buys nothing.
