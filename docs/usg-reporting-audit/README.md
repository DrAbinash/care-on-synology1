# USG Reporting Platform — Architecture & Reuse Audit

**Status: audit only. No production code was modified to produce this audit.**
**As-of commit: `15ed9dfc` on `origin/feature/website-login-redirection` (cross-checked against `origin/claude/radiology-clinical-history-chips-j04t4b` at `b0e83b39`, the active concurrent branch).**

This is a comprehensive architecture audit answering one question: *how should USG (ultrasound) reporting be built so MRI, CT, USG, X-ray, and future modalities all share one reporting platform instead of becoming multiple independent codebases?* It was produced by five parallel research passes over the codebase and documentation, followed by synthesis and cross-verification against the current, actively-developing state of the `feature/website-login-redirection` branch.

## How this audit was produced

Five independent research passes read the actual source code, DB schema, and documentation corpus directly (not each other's output): a reverse-engineering pass over the MRI/CT Reporting Workspace, a full inventory of every existing USG-related file, a claims-vs-reality audit of ~30 documentation files, a deep dive into USG measurement/calculation correctness, and a study-type-by-study-type coverage audit against ~37 common ultrasound studies. Mid-audit, a working-tree staleness issue was discovered and corrected: the initial checkout predated two recent merges (PRs #79 and #80) containing a universal Command Palette and the beginnings of a "CARE Copilot" advisory panel — the final documents reflect the corrected, current state, and a still-open unmerged commit on the source branch was used as live evidence for the merge-risk assessment in doc 09.

## Documents in this audit

| File | Contents |
|---|---|
| [`01-existing-usg-code.md`](./01-existing-usg-code.md) | Every USG-related file in the repo, classified as working/hidden/disconnected/incomplete/duplicate/obsolete/production-ready. |
| [`02-existing-documentation.md`](./02-existing-documentation.md) | All ~30 prior audit/architecture/roadmap documents, dated and tiered by currency, with ~12 specific claims verified or refuted against the actual code. |
| [`03-mri-reporting-architecture.md`](./03-mri-reporting-architecture.md) | 16-section deep reverse-engineering of the MRI/CT Reporting Workspace — component hierarchy, data flow, state management, template/findings engines, AI/Copilot integration, draft/finalize/print/audit pipeline, settings, worklist, DICOM. |
| [`04-reuse-analysis.md`](./04-reuse-analysis.md) | Component-by-component reuse verdicts and percentage estimates for a USG implementation. |
| [`05-usg-study-analysis.md`](./05-usg-study-analysis.md) | Coverage audit of ~37 common USG study types (General/Obstetric/Gynae/Small Parts/Doppler) against existing templates and content. |
| [`06-measurements-and-calculations.md`](./06-measurements-and-calculations.md) | Deep audit of every USG measurement/calculation — includes a critical, live-bug finding (see below). |
| [`07-proposed-reporting-core.md`](./07-proposed-reporting-core.md) | Whether/how to formalize a shared "reporting core" — recommends a logical, not physical, core. |
| [`08-migration-strategy.md`](./08-migration-strategy.md) | Option A (build beside MRI) vs. Option B (extract core, migrate MRI first) — recommends Option A with reasoning. |
| [`09-implementation-roadmap.md`](./09-implementation-roadmap.md) | Phased build order plus a concrete, evidence-based merge-risk assessment against the currently-active concurrent branch. |
| [`10-final-recommendation.md`](./10-final-recommendation.md) | Closing Lead-Architect judgment, ten-year view. |

---

## Executive summary

### 1. Existing USG implementation status

Extensive, and more mature than expected — but split across **two parallel, fully-functional systems** that were never reconciled. The canonical path (`RadiologyReportingWorkspace.tsx`) already has USG mode folded in for two study types (Whole Abdomen, KUB), with a genuinely production-ready shared measurement-review panel. A second, older, equally-real system (`UsgReporting.tsx`/`UsgDopplerReporting.tsx` + five supporting pages, backed by its own `/api/usg-reports` API) implements a full draft→verify→finalize→amend lifecycle with PCPNDT regulatory compliance locking — but has **zero sidebar navigation entry point** anywhere in the app. A third, separate obstetric module (`FetalUsgLevel4.tsx`) is the one USG page a normal user will actually find in the sidebar, and is the most feature-complete single obstetric-USG tool in the codebase — but has a hardcoded-patient-ID bug on study creation and (see below) serious calculation bugs.

### 2. Estimated reusable percentage

**~85-95% at the platform/plumbing layer** (workspace shell, workflow controller, template engine mechanism, findings engine, structured-question templating, command palette, draft/finalize/print/audit pipeline, settings framework, worklist integration, DICOM/image handling — all already modality-agnostic in practice, not just in theory). **~0-30% at the content layer** (the actual USG templates, findings catalogs, and measurement calculation formulas are, by nature, not reusable from MRI content and must be authored fresh — but using the exact same shared mechanisms MRI's content uses). See doc 04 for the full component-by-component table.

### 3. Recommended reporting architecture

Continue the architecture the codebase has already been building toward since early July 2026: one shared, modality-parameterized reporting platform (workspace, template engine, findings engine, finalize/audit pipeline, settings framework), with per-modality *content* (templates, findings, measurement definitions) added as data, not as forked code. This is not a new proposal — it is the explicit, already-documented, already-partially-executed architecture of `CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md` and the R2.0 initiative, confirmed by this audit to be holding up under direct code inspection.

### 4. Should `reporting-core/` be extracted?

**No, not as a physical directory restructuring.** The sharing this question is really asking about already exists at the module/data level; a literal file-tree move of the actively-developed, 5,250-line canonical workspace would carry real regression and merge-conflict risk (there is verified, ongoing concurrent development in exactly these files as of this audit) for no runtime-visible benefit. Instead: treat "reporting core" as a documented logical role (doc 07 names exactly which files/tables/endpoints play that role today) and finish completing it — most importantly, the modality-neutral `structuredReport` document schema, which is designed correctly but not yet wired to any live route for any modality.

### 5. Should USG have its own workspace?

**No.** USG should continue to live inside `RadiologyReportingWorkspace.tsx` as a mode (as R2.0 already began), not get a separate page. The one exception worth a deliberate decision, not a default: USG's PCPNDT regulatory compliance-lock requirement, which has no MRI equivalent and currently only exists in the disconnected legacy USG pages — this needs an explicit integration plan (port it into the canonical finalize path, or keep a narrowly-scoped separate finalize surface for obstetric studies specifically), addressed in doc 09's Phase 4.

### 6. Recommended implementation phases

Five phases, ordered to touch actively-developed shared files as little and as late as possible: **(0)** fix known bugs (obstetric GA/EFW calculation errors) and make the template-authority and PCPNDT-integration decisions; **(1)** complete the two already-integrated study types correctly; **(2)** add content for the highest-value coverage gaps (Gynaecology, then Small Parts, then Doppler, then General) — almost entirely in USG-specific, currently-unowned files; **(3)** complete the measurement-calculation library, in parallel with (2); **(4)** reconcile the two duplicate finalize systems — the highest-stakes decision, made last, with full information; **(5)** nav/discoverability cleanup. Full detail in doc 09.

### 7. Merge-conflict assessment

**Real and currently active, not hypothetical.** As of this audit, the branch that produced the last month of MRI-side radiology work (Smart Findings, Structured Finding Assistant, Command Palette, CARE Copilot) still has an **unmerged commit in flight**, touching `RadiologyReportingWorkspace.tsx` and its Copilot-panel components directly. The roadmap (doc 09) classifies every relevant file into a risk tier and recommends spending the first several implementation phases almost entirely in the "safe, USG-specific, currently unowned" tier, deferring the one genuinely shared, currently-hot-adjacent task (structured-report catalog completion) to a point where the concurrent branch's state can be re-checked. The single highest-leverage risk mitigation identified is a **process** decision (sequence vs. coordinate the two efforts), not a code-level one — flagged for Dr. Abinash to decide before implementation starts.

### 8. Final recommendation, as Lead Architect

Build USG reporting as content on the existing shared platform — not a new platform, not a defensive core extraction, not a parallel system. The architecture question this audit was commissioned to answer was already correctly answered by this codebase's own recent history; this audit's contribution is confirming that under direct scrutiny, cataloguing precisely what content and correctness work remains (doc 05, doc 06), and sequencing it to avoid a live, ongoing merge-risk collision (doc 09). Full reasoning in doc 10.

---

## ⚠ One finding that should not wait for any of the above

**`FetalUsgLevel4.tsx` — a live, nav-linked obstetric ultrasound page — is currently computing wrong gestational ages for real patients.** A unit-mismatch bug (centimeter-calibrated formulas fed millimeter inputs) means a normal BPD of 82mm returns "243 weeks," a normal AC of 300mm returns "3559 weeks," and the one correctly-transcribed formula in the whole stack (Hadlock EFW) silently produces ~0 grams. This is documented in full, with every broken formula and its correct counterpart, in [`06-measurements-and-calculations.md`](./06-measurements-and-calculations.md) §3. It is independent of every architectural question this audit otherwise addresses and was flagged to the user immediately upon discovery, separately from this written record.
