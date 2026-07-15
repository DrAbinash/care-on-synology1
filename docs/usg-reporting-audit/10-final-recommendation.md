# 10 — Final Recommendation (Lead Architect)

*As-of commit: `15ed9dfc`. Written as the closing judgment call of this audit, synthesizing docs 01-09.*

## The ten-year question

If I had to maintain CARE ERP's reporting platform for the next ten years — MRI, CT, USG, X-ray, Mammography, and whatever comes after — here is how I would build it, and why.

### 1. There is no "USG Reporting Workspace" to build. There is a reporting workspace that needs USG content.

The most important finding of this entire audit is that the architectural question it was commissioned to answer — *"should USG get its own codebase, or share one with MRI?"* — was already answered correctly, in writing and in code, before this audit started. `CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md` and the R2.0 initiative (doc 02) already committed to one shared platform, and doc 04's component-by-component analysis confirms that commitment is ~85-95% executed at the plumbing layer. Treating this as a decision still open would be a mistake — the decision is made, and re-litigating it (e.g. by building a standalone USG codebase, or by doing a defensive `reporting-core/` extraction "just in case") would create the exact duplicated-system problem this codebase has already fought its way out of once (doc 02's account of three competing "unified page" candidates before `RadiologyReportingWorkspace.tsx` won).

**What remains is content and correctness work, not architecture work**: ~19 of 37 common USG study types need templates (doc 05), the measurement-calculation layer is a genuine mess with real bugs (doc 06), and two full duplicate finalize pipelines need reconciling (doc 01). None of that requires a new platform.

### 2. Every future modality (X-ray, Mammography, Echo, whatever comes next) should follow the same pattern USG should follow: content on a shared platform, not a new platform per modality.

The shared mechanisms this audit catalogued (template engine, findings engine, structured-question templating, command palette, draft/finalize/print/audit pipeline, settings framework) contain almost nothing MRI-specific in their code — they're parameterized by `modality` and free-text `studyType` region strings throughout. A tenth modality added five years from now should look like: new rows in `structured_report_templates`/`radiology_quick_findings`/`radiology_protocols`/`radiology_clinical_history_chips`, a new content-pack YAML if it needs the rich structured-finding catalog, and — only if it has a genuinely unique workflow requirement (like USG's PCPNDT compliance lock, or DICOM-SR extraction) — new, clearly-scoped, opt-in code gated by a modality check, not a fork of the workspace.

The discipline that makes this durable over ten years isn't a folder structure — it's the norm, already visible in the most recent commits this audit found (CARE Copilot's own commit message: *"Built by ORCHESTRATING the engines that already exist, not adding a new one"*), of treating new capability as composition over the shared core rather than parallel construction. That norm should be written down (this audit, and doc 07's "logical core" table, are a starting point) and enforced in code review, the same way `PROTECTED_FILES.md` already enforces the billing/radiology boundary.

### 3. Fix correctness before building on top of it — twice.

Two things in this audit are not architecture debates; they're bugs that will hurt real patients or real radiologists if left in place while new work is built on top of them:

- **The obstetric GA/EFW calculation bugs (doc 06 §3).** A live, nav-linked page is currently showing gestational ages of "243 weeks" and "3559 weeks" for normal measurements, and silently producing a ~0g fetal weight where the underlying formula is actually correct. This is not a USG-workspace-architecture problem — it needs fixing on its own timeline, independent of everything else in this audit.
- **The duplicate, disconnected USG module (doc 01).** Two fully-working finalize pipelines for the same clinical artifact, plus five nav-invisible pages, is a maintenance and (potentially) a patient-safety-adjacent hazard in its own right — a report finalized through the legacy `usg-reports` path and one finalized through the canonical `patient-reports` path may not be equally discoverable to whoever looks up a patient's report history later. This needs a deliberate reconciliation decision (doc 09 Phase 4), not indefinite coexistence.

### 4. The build order matters more than the build architecture.

Given a second developer/agent is verifiably, actively working in the exact files a USG implementation would most want to touch (doc 09 Part A — this is not hypothetical, it is happening as of this audit), the practical risk to a USG project over the next few months is far more about **sequencing and coordination** than about **getting the abstraction right**. The abstraction is already mostly right. The roadmap in doc 09 is deliberately ordered to spend the first several phases almost entirely in USG-specific, currently-unowned files, and to defer the one genuinely-shared, currently-hot-file-adjacent piece (structured-report catalog wiring) to a point where it's easier to check the concurrent branch's state before touching it.

### 5. What I would NOT do

- I would not build a parallel/independent USG reporting page, workspace, or "engine" — doc 01 shows this codebase has already tried that (multiple times, across multiple eras) and every one of those attempts became exactly the kind of disconnected, duplicated surface this audit had to catalogue and untangle.
- I would not do a defensive, big-bang `reporting-core/` file-tree extraction before starting USG content work — doc 07 and doc 08 show it buys nothing runtime-visible today and carries real regression/merge risk against a codebase under active concurrent development.
- I would not treat any of the June-2026-era audit/roadmap documents (doc 02, Part 4) as current guidance — several were already outdated within weeks of being written, and using them to plan new work risks re-fighting battles that are already settled.
- I would not let "getting the architecture right" become an excuse to defer the two correctness bugs above — they're independent of the architecture question and shouldn't wait for it.

### Summary verdict

**Build USG on the existing platform. Fix what's broken first. Reconcile what's duplicated deliberately. Don't build a second platform — for USG, or for whatever comes after USG.** The codebase's own recent history already demonstrates this is the right call; this audit's job was to verify that demonstration holds up under scrutiny, and it does.
