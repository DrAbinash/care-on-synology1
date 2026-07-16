# PR B — USG Platform Consolidation: Deliverables

**Status: implemented.**
**Scope: sidebar navigation, USG Worklist, General USG Reporting workspace configuration, six USG Copilot modules, and a Quick Select / Protocol / Clinical History content seed migration.**
**Builds on:** [`docs/usg-reporting-audit/`](../usg-reporting-audit/) (the prior architecture audit, as-of commit `15ed9dfc`) and [`docs/usg-reporting/fetal-usg-calculation-correction.md`](./fetal-usg-calculation-correction.md) ("PR A", commit `a1f8c9e6`).
**As-of commit at audit time:** `84638b89` (branch `claude/usg-platform-consolidation-gv58pu`, based on `feature/website-login-redirection`).

This PR is an **architectural consolidation**, not a rewrite. Per the Hard Rules in the task spec, it does not create a second Reporting Workspace, Smart Findings engine, Template engine, Copilot, Report lifecycle, Measurement engine, or Settings page. Every change below either (a) adds configuration/content rows to an existing shared table, (b) adds a plug-in to an existing registry, or (c) adds/edits a nav entry or a `?modality=` query-param read on an existing page.

---

## 1. Audit summary

The repository was re-audited against current `HEAD` (`84638b89`) before any code was written, because the prior audit (`docs/usg-reporting-audit/`, as-of `15ed9dfc`) predates 13 merged commits: CARE Copilot Phases 2–4, MRI PR 1 (previous-study comparison) and PR 2 (viewer-measurement completeness Copilot module), the A5 print-quality PR, several Clinical History Chips PRs, and PR A (obstetric GA/EFW calculation fix). The re-audit used five parallel research passes (Copilot plug-in architecture, Clinical History/Quick Findings data shape and content, Worklist filtering + MRI PR1/PR2 modality-gating, Template/Protocol/Settings surfaces, Doppler/PCPNDT/report-lifecycle maturity) plus direct reads of the prior audit's ten documents and the live source. Every finding below was verified against current source with file:line evidence, not assumed from the prior audit.

**Headline finding, confirmed unchanged from the prior audit:** the architectural decision this PR is asked to execute was already made and is already ~85–95% built. `RadiologyReportingWorkspace.tsx` already has an `isUltrasound` mode (`lib/usgModality.ts`'s normalizer), already embeds `UsgMeasurementReviewPanel` as a USG-only tab, already fetches a USG template catalog, and the Worklist/draft/finalize/print/audit/settings/Command-Palette/Copilot mechanisms are already modality-generic. What was **not** done yet, and is what this PR delivers: a real nested "USG Reporting" sidebar entry point, a URL-driven USG-scoped worklist/workspace, USG-specific Copilot modules, and — because zero rows existed for any USG study type — the first Quick Findings / Clinical History / Protocol content for USG.

---

## 2. Module classification

| Module | Classification | Evidence |
|---|---|---|
| `RadiologyReportingWorkspace.tsx` (canonical workspace) | **Canonical** | Already modality-parameterized (`isUltrasoundModality(entry?.modality)`), already the single reporting surface for MRI/CT/USG. Unmodified except two additive lines (see §7). |
| `RadiologyWorklist.tsx` (canonical worklist) | **Canonical** | Already carries USG-specific fields (`usgMeasurementCount`, etc.) and an "US" modality filter bucket. Unmodified except one additive lazy-init (see §6). |
| `UsgMeasurementReviewPanel.tsx` | **Canonical / production-ready** | The real, shared USG measurement panel, embedded in the canonical workspace. Untouched. |
| `copilotModules.ts` / `copilotOrchestrator.ts` / `CareCopilotPanel.tsx` | **Canonical (Copilot core)** | Untouched — zero edits, per Hard Rules. |
| `radiology_quick_findings` / `radiology_clinical_history_chips` / `radiology_protocols` / `radiology_study_tabs` | **Canonical (shared config tables)** | Untouched schema; only new rows added (see §14). |
| `FetalUsgLevel4.tsx` | **Mature** | Nav-linked, most feature-complete single obstetric-USG module in the codebase; GA/EFW bugs and the hardcoded-patient-ID bug already fixed in PR A. Preserved exactly, unmoved except its sidebar position (moved into the new USG Reporting submenu, same route). |
| `FetalEcho.tsx` | **Mature** | 511-line dedicated fetal echocardiography page, already nav-linked and routed at `/fetal-echo`. Preserved exactly, unmoved except sidebar position. |
| `UsgDopplerReporting.tsx` + `routes/usgDoppler.ts` | **Mature, newly exposed** | Verified: no TODO/stub markers, real CRUD (list/create/approve/reject/update/delete) against `usg_doppler_measurements`, no mocked data. Was reachable only by typing `/usg/doppler` — zero nav entry anywhere. Now exposed as "Doppler Reporting" under USG Reporting (see §16). |
| `UsgReporting.tsx` + `routes/usgReports.ts` (`usg_report_drafts` / `/api/usg-reports`) | **Duplicate, kept Legacy/Hidden** | A second, fully-working draft→verify→finalize→amend pipeline for the same clinical artifact as the canonical workspace's `patient-reports` pipeline, including a genuine PCPNDT Form F lock the canonical path does not have. Per §4 of the task spec ("General USG Reporting must use RadiologyReportingWorkspace... do NOT create UsgReportingWorkspace"), this PR does **not** add a nav entry for it — doing so would re-legitimize the duplicate finalize pipeline the task explicitly says not to build. Route, table, and page are untouched and still reachable by direct URL (deep links preserved). |
| `UsgDoppler.tsx` (hub at `/usg`), `UsgAdminSettings.tsx`, `UsgAnalytics.tsx`, `UsgCriticalAlerts.tsx`, `UsgKeyImagesGallery.tsx` | **Legacy, Hidden** | Real, working, but disconnected-from-nav pages backing the legacy `usg-reports` pipeline. Left exactly as-is; no nav entry added (would surface the duplicate pipeline). Routes untouched. |
| `UsgMeasurementReview.tsx` | **Mature (thin wrapper)** | Genuinely reachable — `RadiologyWorklist.tsx` navigates here as a fallback when a USG row's own worklist id is missing. Untouched. |
| `UsgWorklist.tsx` | **Dead** | Lazy-imported but never assigned to any route (`/usg/worklist` is wired to `RedirectToUnifiedWorklist`); confirmed unreachable, contains a stale `/erp/...` path. Not deleted (Hard Rule: do not delete existing pages), not touched. |
| `usgMeasurementEngine.ts` (backend) | **Legacy, needs future repair** | Correct ellipsoid-volume/RI formulas but its output is discarded at every live call site; separate, differently-wrong GA-from-CRL/FL formulas than `obstetricCalculations.ts` (PR A's authoritative module). Untouched — out of this PR's scope (workspace-config PR, not a formula-repair PR). |
| `radiologyCoPilotEngine.ts` (hardcoded core reminders, incl. a hardcoded USG Doppler reminder and abdomen checklist) | **Canonical (core, pre-existing)** | Untouched. The new USG Copilot modules (§8) are additive and can overlap in spirit with a couple of these pre-existing hardcoded reminders — flagged as a reconciliation opportunity in §17, not fixed here (touching Copilot core is explicitly out of scope). |
| Voluson integration (`usgExtractor.ts`, `local-dicom-bridge`) | **Mature, out of scope** | Real DICOM-SR/GE-private-tag/OCR extraction pipeline, auto-triggered on intake. Not touched — no workspace-config or nav change required or made. |
| `radiologyMasterTemplates.ts` (17 templates incl. 5 USG) | **Dead code (zero importers)** | Confirmed via `grep`: no file imports `ALL_MASTER_TEMPLATES`/`findMasterTemplateById`/`assembleReport` except the file itself. A duplicate template store (see §5); not touched or wired in this PR — wiring it is a template-authority decision the task spec explicitly defers ("Recommend consolidation. Do NOT migrate historical reports."). |
| `radiologyReportAssembler.ts` | **Dead code / Experimental** | A second, independent "assemble multiple templates" implementation, gated behind a feature flag that is off by default and wired nowhere live. Not touched. |
| `seeds/radiology/content-packs/v1/*.yaml` (rich structured-finding catalog) | **Experimental / unwired** | Only `usg_abdomen.yaml`/`usg_kub.yaml` exist for USG; per the prior audit and this re-audit, this catalog has no loader anywhere in `api-server/src` — a genuine "foundation only" system. Not touched; this PR's content pack (§14) goes into the *live*, wired tables instead. |
| PCPNDT Form F gate | **Hidden gap, made visible (not fixed)** | Confirmed: the canonical workspace's `finalizeReport()` has **zero** PCPNDT check today; only the legacy `usgReports.ts` route enforces it. This PR does not touch the shared finalize transaction (see §17) — it surfaces the gap as a non-blocking Copilot reminder instead (§8). |

---

## 3. Existing modules reused

- **`RadiologyReportingWorkspace.tsx`** — General USG Reporting is this exact component, reached via `?modality=USG`. No `UsgReportingWorkspace`/`RadiologyReportingWorkspaceV2`/`ReportingCoreWorkspace` was created.
- **`RadiologyWorklist.tsx`** — USG Worklist is this exact component, reached via `?modality=USG`. No second worklist component was created.
- **CARE Copilot's plug-in registry** (`copilotModules.ts`, `registerCopilotModule`) — six new USG modules register into it exactly like the three pre-existing MRI-era modules (`copilotComparisonModule.ts`, `copilotMeasurementModule.ts`, `copilotAiModule.ts`). Zero edits to `copilotModules.ts`, `copilotOrchestrator.ts`, or `CareCopilotPanel.tsx`.
- **Structured Finding Assistant** (`{key}`/`[optional]` templating, `questions_json` on `radiology_quick_findings`) — reused verbatim for the new USG structured findings (Follicle Tracking, Renal Calculus, Hydronephrosis, Fibroid Uterus, NT Measurement, Thyroid Nodule, Solid Breast Lesion, Varicocele, Ascites grading). No new engine.
- **Quick Findings engine** (`radiology_quick_findings`, free-text mode) — reused for every other new finding.
- **Clinical History chip engine** (`radiology_clinical_history_chips`) — reused for the twelve new USG chips.
- **Protocol Engine** (`radiology_protocols`, incl. its checklist-coverage mechanism) — reused for the thirteen new USG protocols.
- **Report lifecycle** (draft/finalize/print/audit/amendment/versioning via `radiologyReportLifecycle.ts` and the `patient-reports` API) — used unmodified by General USG Reporting, exactly as it already is by MRI/CT.
- **Command Palette, Settings framework, DICOM/viewer pipeline** — unmodified, already modality-agnostic per the re-audit.

## 4. Existing modules preserved

Fetal USG, Fetal Echo, the legacy `UsgReporting`/`UsgDoppler`/`UsgDopplerReporting`/`UsgAdminSettings`/`UsgAnalytics`/`UsgCriticalAlerts`/`UsgKeyImagesGallery` pages, their backing tables (`usg_report_drafts`, `usg_measurements`, `usg_doppler_measurements`, `fetal_usg_*`), and every existing route are untouched. No page was deleted. No historical report or draft is migrated or altered.

## 5. Duplicate systems identified (not resolved — documented per task §19)

1. **Two finalize pipelines**: canonical (`patient-reports` API, used by `RadiologyReportingWorkspace.tsx`) vs. legacy (`/api/usg-reports`, used by `UsgReporting.tsx`), the latter carrying the only real PCPNDT Form F lock. Reconciliation is explicitly flagged by the prior audit (doc 09, Phase 4) as the single highest-stakes decision in this area and is **out of scope for this PR** — see §17/§18.
2. **Three template stores**: `usgReportTemplates.ts` (13 templates, live, feeds the canonical workspace's USG quick-select), `radiologyMasterTemplates.ts` (17 templates incl. 5 USG, zero importers — dead code), and the unwired `seeds/radiology/content-packs/v1/*.yaml` catalog (2 USG packs). This PR's content pack (§14) is a **fourth** surface by necessity (it targets the tables the live Quick Select / Protocol UI actually reads), but does not add a fifth template *renderer* — see §18 for the recommended consolidation.
3. **Duplicate GA/biometry formulas**: `usgMeasurementEngine.ts` and `radiologySmartEngine.ts` each still contain their own (differently wrong) GA formulas, independent of PR A's corrected `obstetricCalculations.ts`. Documented in PR A's own doc §6 as a known remaining duplicate; unchanged by this PR.

## 6. Navigation changes

`Layout.tsx`'s `Radiology & Imaging` group gained one nested, collapsible subgroup — **USG Reporting ▼** — inserted where the old flat "Fetal USG"/"Fetal Echo" entries were:

```
Radiology & Imaging
├── Worklist Hub
├── Reporting Workspace
├── Operations Dashboard / My Analytics / DICOM Match Center / PACS Viewer / …
├── USG Reporting ▼
│      ├── USG Worklist            → /radiology/worklist?modality=USG
│      ├── General USG Reporting   → /radiology/reporting-workspace?modality=USG
│      ├── Fetal USG               → /fetal-usg              (unchanged route)
│      ├── Fetal Echo              → /fetal-echo              (unchanged route)
│      ├── Doppler Reporting       → /usg/doppler              (newly exposed, unchanged route)
│      └── USG Settings            → /settings/radiology-quick-select (existing page, second entry point)
├── Templates / PACS / Voice Dictation / …
└── (unchanged remainder)
```

The nav data model (`NavGroup`/`NavLeaf`) gained one new type, `NavSubGroup`, supporting exactly one extra nesting level — not unbounded recursion, and not a rewrite of the nav renderer. All existing routes, permission checks (`canAccess`), feature flags, and deep links are unchanged; the two new query-string leaves are stripped of their query string before being passed to `canAccess()` (a `?modality=USG` suffix must never reach the permission check unstripped, or it silently bypasses the permission system — verified and guarded explicitly, see `pathOnly()` in `Layout.tsx`). Both desktop and mobile sidebar rendering, the collapsed icon-only mode, and the mobile header's "current module" label were all updated consistently.

No sidebar entry was added for the legacy `UsgReporting.tsx`/`UsgDoppler.tsx` hub/`UsgAnalytics.tsx`/`UsgCriticalAlerts.tsx`/`UsgKeyImagesGallery.tsx`/`UsgAdminSettings.tsx` pages — see §2/§5. Their routes remain registered and reachable by direct URL.

## 7. Workspace configuration

`RadiologyReportingWorkspace.tsx` reads an optional `?modality=` query parameter on mount and seeds the existing `modalityFilter` state (used by the Templates tab's picker, `t.modality === modalityFilter`) with it — two lines, no new state, no new component. When "General USG Reporting" is opened this way, the Templates tab defaults to the USG catalog instead of showing every modality's templates. Study tabs, Quick Findings, Clinical History chips, Protocols, Structured Finding Assistant, Measurements panel, and Copilot are already wired generically by `isUltrasound`/`entry.studyDescription`/`studyType` and did not need code changes — only the new content rows described in §14.

## 8. Copilot modules added

Six new local (deterministic) Copilot modules, each a standalone file implementing the existing `CopilotModule` interface and self-registering via `registerCopilotModule()` on import — the identical pattern MRI PR 1/PR 2 already established:

| Module id | File | Gate | What it checks |
|---|---|---|---|
| `usg-abdomen` | `copilotUsgAbdomenModule.ts` | US + Whole Abdomen/KUB-pattern study | Organ-coverage checklist, KUB post-void residue, ascites-in-impression |
| `usg-obstetric` | `copilotUsgObstetricModule.ts` | US + obstetric-pattern study | GA/EDD, placenta, liquor statement completeness; **non-blocking PCPNDT Form F reminder** (see §17) |
| `usg-thyroid` | `copilotUsgThyroidModule.ts` | US + thyroid-pattern study | TI-RADS on a described nodule, isthmus, cervical nodes |
| `usg-breast` | `copilotUsgBreastModule.ts` | US + breast-pattern study | BI-RADS on a described lesion, laterality, axilla |
| `usg-scrotum` | `copilotUsgScrotumModule.ts` | US + scrotal-pattern study | Vascularity assessment on a described lesion, laterality |
| `usg-doppler` | `copilotUsgDopplerModule.ts` | US + Doppler-pattern content | PSV/EDV pairing, missing RI/S-D ratio, waveform description (grounded in `docs/usg-reporting-audit/06-measurements-and-calculations.md` §4's findings) |

`RadiologyReportingWorkspace.tsx` gained six side-effect `import` lines alongside the three pre-existing ones. Zero edits to `copilotModules.ts`/`copilotOrchestrator.ts`/`CareCopilotPanel.tsx`. 43 new unit tests (one file per module) plus the 3 pre-existing Copilot test files all pass (94/94 total).

## 9. Template integration

No new template engine. USG templates continue to come from `usgReportTemplates.ts` (13 templates, live catalog feeding the canonical workspace's quick-select) and now additionally from the new `radiology_protocols` rows (§14), which surface through the same Protocol Engine UI/mechanism MRI already uses. The duplicate-store situation (§5.2) is documented, not consolidated — consolidating `radiologyMasterTemplates.ts` (dead code) or wiring the YAML catalog are template-authority decisions the task spec explicitly defers ("Audit duplicate template stores. Recommend consolidation. Do NOT migrate historical reports.") — see §18.

## 10. Smart Findings integration

No new Smart Findings engine. Thirty-six new `radiology_quick_findings` rows were added across 13 USG study tabs (Whole Abdomen, KUB, Pelvis, TVS, Obstetric, Growth, Anomaly, NT, Thyroid, Breast, Scrotum, Doppler, Soft Tissue) — a representative starter set per study type, not an exhaustive clinical catalog (see §17). Nine of the thirty-six are structured findings using the existing `{key}`/`questions_json` mechanism (Follicle Tracking, Renal Calculus, Hydronephrosis, Fibroid Uterus, Ascites grading, NT Measurement, Thyroid Nodule, Solid Breast Lesion, Varicocele). `anatomical_section` is deliberately left blank on every row (see §14's rationale) since no USG study type has a DB-backed `structured_report_templates` entry yet for the Smart Findings section-flip mechanism to target.

## 11. Measurement integration

No new measurement engine was built or planned — out of scope for a workspace-configuration PR (see PR A's own explicit deferral of `usgMeasurementEngine.ts`/`radiologySmartEngine.ts` repair, and doc 06's recommendation that this needs a dedicated, separately-scoped correctness pass). The existing `UsgMeasurementReviewPanel` continues to be the live measurement surface, unmodified. New structured findings (§10) let a radiologist type a measurement value (e.g. NT mm, nodule size mm) directly into a finding's generated text via the existing Structured Finding Assistant, which is the same mechanism MRI's structured findings already use to carry a measurement into the report/impression — no separate "map measurement to report" pipeline was added.

## 12. Settings integration

No new settings page. "USG Settings" in the sidebar links to the existing `/settings/radiology-quick-select` (`RadiologyQuickSelectSettings.tsx`), which already provides admin CRUD for Study Tabs, Quick Findings, Quick Measurements, Protocols, and Clinical History Chips — five of the task spec's nine listed settings concerns, already unified in one page before this PR. (Templates/Copilot/Recommendations/Study-tab-permissions live in other existing, unmodified settings surfaces — `ReportTemplates.tsx`, `RadiologySettingsCenter.tsx`, and the general permission system — none of which needed a change for this PR.)

## 13. Files modified / added

**Modified (3):**
- `artifacts/diagnostic-erp/src/components/Layout.tsx` — nested USG Reporting subgroup, one-level nested-group rendering support.
- `artifacts/diagnostic-erp/src/pages/RadiologyWorklist.tsx` — `?modality=` lazy-init for `modalityFilter`.
- `artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx` — `?modality=` lazy-init for `modalityFilter`; six new Copilot module side-effect imports.

**Added (13):**
- `artifacts/diagnostic-erp/src/lib/copilotUsgAbdomenModule.ts` (+ `.test.ts`)
- `artifacts/diagnostic-erp/src/lib/copilotUsgObstetricModule.ts` (+ `.test.ts`)
- `artifacts/diagnostic-erp/src/lib/copilotUsgThyroidModule.ts` (+ `.test.ts`)
- `artifacts/diagnostic-erp/src/lib/copilotUsgBreastModule.ts` (+ `.test.ts`)
- `artifacts/diagnostic-erp/src/lib/copilotUsgScrotumModule.ts` (+ `.test.ts`)
- `artifacts/diagnostic-erp/src/lib/copilotUsgDopplerModule.ts` (+ `.test.ts`)
- `migrations/zz_add_usg_platform_content_pack.sql`
- `docs/usg-reporting/platform-consolidation-pr-b.md` (this file)

No file was deleted. No existing test was modified.

## 14. Database changes

One new, purely additive, idempotent SQL migration: `migrations/zz_add_usg_platform_content_pack.sql`. No new table, no new column, no destructive change — it only inserts rows into four already-existing, already-live tables (`radiology_study_tabs`, `radiology_clinical_history_chips`, `radiology_quick_findings`, `radiology_protocols`), the same tables the MRI-side migrations already seed. Every `INSERT` uses `ON CONFLICT (...) DO NOTHING` against the same unique keys the base migrations defined.

**Verified live** (see §15) against a real, ephemeral PostgreSQL 16 instance in this sandbox — not just read for syntax:
- 13 study tabs, 12 clinical history chips, 36 quick findings (9 structured), 13 protocols inserted with zero SQL errors.
- Re-running the migration a second time produced 22× `INSERT 0 0` — confirmed idempotent.
- Every `questions_json` value parses as valid JSONB.
- Every `radiology_quick_findings.study_type` / `radiology_protocols.study_type` / `radiology_clinical_history_chips.study_type` value exactly matches a `radiology_study_tabs.name` row — zero orphaned references.
- At most one `is_default = true` protocol per `study_type` among the new USG rows.

`anatomical_section` is left at its default (`''`) on every new finding — see §10 for why, and §18 for the follow-up this implies.

## 15. Tests

- **Root workspace typecheck** (`pnpm run typecheck`, covers `lib/*` + all `artifacts/*` packages + `scripts`): **clean, 0 errors**.
- **`diagnostic-erp` full test suite**: **617/617 passing** (43 of them new, one file per new Copilot module), zero regressions.
- **Full monorepo test suite** (`vitest run --root .`, with `DATABASE_URL` pointed at a throwaway local Postgres to unblock the handful of files that import DB-backed modules at module-load time): **2020/2020 passing**, 131/131 test files — confirmed against the pre-PR baseline (same result), so this PR introduces zero regressions anywhere in the monorepo, not just in the files it touches.
- **`diagnostic-erp` production build** (`pnpm run build`): succeeds, including a `RadiologyReportingWorkspace` and `RadiologyWorklist` chunk with no new build warnings.
- **Migration**: applied live against a real ephemeral PostgreSQL 16 database (schema materialized via `drizzle-kit push` from the current live schema, then the migration applied via `psql`) — see §14 for the specific checks performed. This exceeds the verification depth possible in a database-less sandbox.
- **Browser-level sanity check**: the Vite dev server was started and the app loaded in headless Chromium (Playwright, pre-installed in this environment). The bundle — including the modified `Layout.tsx` — compiled and executed with **zero JS `pageerror`/uncaught exceptions**; the app correctly redirected to `/portal` (no session), confirming the whole React tree (Layout, App, routing) mounts cleanly with the new nav code in place.

## 16. Screenshots

**Not produced.** A fully authenticated walkthrough (login → sidebar → USG Worklist → General USG Reporting → Fetal USG → Fetal Echo → Doppler Reporting) requires a seeded staff account, clinic settings, and a running `api-server` against a fully-migrated database with auth secrets configured — none of which are documented or available in this sandbox (no `.env.example`, no staff-seed script found). This mirrors the exact limitation PR A recorded in this same repository ("Screenshots of the corrected UI in a live browser/database environment could not be produced from this sandbox"). In its place, §15 documents the concrete, live verification that was performed instead (types, 2020 tests, production build, a live-DB migration apply with idempotency/consistency checks, and a headless-browser load with zero JS errors).

## 17. Known limitations

1. **PCPNDT Form F gate is not enforced in the canonical workspace.** The canonical `finalizeReport()` path has no compliance check today (only the legacy, non-nav-linked `UsgReporting.tsx`/`usgReports.ts` enforces it server-side). This PR makes the gap **visible** — a non-blocking, always-on Copilot reminder for obstetric-USG studies (`usg-obstetric` module, §8) — rather than **fixed**, deliberately: the prior audit (doc 09, Phase 4) calls this "the single most architecturally significant remaining decision," recommends it be made *last, with full information*, and this PR's job (per the task's own Hard Rules) is workspace consolidation, not a live edit to the shared, `BEND-1`-frozen finalize transaction that every modality depends on, in a sandbox with no live database to test that specific change against. See §18 for the recommended path.
2. **Content is representative, not exhaustive.** 36 Quick Findings and 13 Protocols across 13 study types is a real starting catalog, not full coverage of the ~37 study types the prior audit (doc 05) catalogued. Gynaecology beyond TVS (follicular monitoring detail, infertility workup), exotic Doppler vessels (renal/portal/hepatic/penile/AV fistula), and Hernia/PVR/Appendix as standalone studies remain thin or absent, exactly as doc 05 found before this PR.
3. **Copilot content overlap.** The new `usg-doppler` and `usg-abdomen` modules can produce advisory items alongside `radiologyCoPilotEngine.ts`'s pre-existing hardcoded USG Doppler reminder (`id: "rem-usg"`) and abdomen organ checklist for the same study — both surfaces are additive (no dedup by design across the whole Copilot system, confirmed for the pre-existing modules too), so this is redundancy, not a bug, but worth reconciling later.
4. **No live-authenticated browser verification** (§16).
5. **`anatomical_section` is unset on every new USG finding** (§10/§14) — a deliberate choice, not an oversight, given no DB-backed structured template exists yet for any USG study type.
6. **Measurement-calculation correctness bugs are unchanged.** `usgMeasurementEngine.ts` and `radiologySmartEngine.ts` still contain their own, independently-wrong GA/biometry formulas (distinct from PR A's corrected `obstetricCalculations.ts`, which only covers the Fetal USG Level-4 module). Out of scope for this PR.

## 18. Recommended future migration plan

Ordered by the same reasoning the prior audit used (touch hot/shared files last, safest-file-first):

1. **PCPNDT reconciliation** (doc 09 Phase 4, still the single highest-stakes item): decide whether to (a) port a narrowly-scoped, obstetric-USG-only PCPNDT gate into the canonical finalize path (mirroring `usgReports.ts:464-503` almost verbatim, with real route-level tests against a live-migrated test database before merging), or (b) retire the legacy `usg-reports` pipeline once (a) is live and route `/usg/reporting`/`/usg/doppler` finalize actions through it instead. This PR's `usg-obstetric` Copilot reminder is a stopgap, not a substitute for this decision.
2. **Template-authority decision** (doc 05's recommendation, still open): pick one authoritative USG template source — `usgReportTemplates.ts` (current interim renderer, real and live) vs. the YAML content-pack catalog (doc 05/06's recommended long-term shared measurement+finding store, currently unwired) — and either wire the YAML loader or formally deprecate it; either way, delete the confirmed-zero-importer `radiologyMasterTemplates.ts` and the flag-gated, also-zero-live-callers `radiologyReportAssembler.ts` once their content (if any is still wanted) is migrated into the chosen authority.
3. **Expand the content pack** (§17.2) toward doc 05's full 37-study-type coverage — Gynaecology (follicular monitoring, infertility workup) and the remaining Doppler vessels are the largest gaps.
4. **Wire `anatomical_section`** for USG findings once (or if) a DB-backed `structured_report_templates` row exists for a given USG study type, enabling the Smart Findings section-flip mechanism for USG the same way it already works for MRI.
5. **Repair the measurement-calculation layer** (doc 06's recommendation, unchanged by this PR or by PR A, which was explicitly scoped to Fetal USG Level-4 only): finish wiring `structuredReport`'s catalog+validator as the shared measurement store, salvage `usgMeasurementEngine.ts`'s correct ellipsoid/RI formulas into it, and delete/replace its incorrect GA formulas and `radiologySmartEngine.ts`'s duplicate set.
6. **Reconcile Copilot content overlap** (§17.3) between the new modular USG advisories and the pre-existing hardcoded core reminders, once the modular additions have been in production long enough to know which framing radiologists actually prefer.

No step above requires — or should become — a second Reporting Workspace, Smart Findings engine, Template engine, Copilot, Report lifecycle, Measurement engine, or Settings page. Each is content, configuration, or a narrowly-scoped extension of an existing shared mechanism, consistent with this PR's own approach.
