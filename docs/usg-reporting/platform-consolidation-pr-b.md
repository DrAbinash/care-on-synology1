# PR B — USG Platform Consolidation: Deliverables

**Status: implemented.**
**Scope: sidebar navigation, USG Worklist, General USG Reporting workspace configuration, six USG Copilot modules, a Quick Select / Protocol / Clinical History content seed migration, a client-side PCPNDT finalize-block safety guard, and — completing the protection — a server-side PCPNDT finalize guard (see §8's "PCPNDT finalize guard" subsections and §17.1/§18.1).**
**Builds on:** [`docs/usg-reporting-audit/`](../usg-reporting-audit/) (the prior architecture audit, as-of commit `15ed9dfc`) and [`docs/usg-reporting/fetal-usg-calculation-correction.md`](./fetal-usg-calculation-correction.md) ("PR A", commit `a1f8c9e6`).
**As-of commit at audit time:** `84638b89` (branch `claude/usg-platform-consolidation-gv58pu`, based on `feature/website-login-redirection`).

> **Safety addendum 1 (post-review):** the version of this PR first opened shipped the PCPNDT gap (§17.1) as a Copilot reminder only — advisory, not blocking. A follow-up safety review correctly identified that as insufficient, since it left the canonical workspace able to finalize an obstetric/fetal USG report with zero compliance check. That revision added a real, tested, hard client-side finalize-block for PCPNDT-relevant studies. It also corrected an assumption implicit in the original review request: **Fetal USG (`FetalUsgLevel4.tsx`) is *not* PCPNDT-compliant either** — verified by reading its `final-sign` route, which checks only report-review status and critical-alert acknowledgement, no Form F. The only genuinely compliant path in the codebase today is the legacy `UsgReporting.tsx` + `/usg-reports` API pipeline.
>
> **Safety addendum 2 (completing the protection):** the client-side guard alone could still be bypassed by a direct API call — a real gap, explicitly flagged in addendum 1 as the next step. This revision closes it: **both** server-side write paths a canonical finalize can take — `POST /api/patient-reports` (the content-persisting write) and `POST /api/internal/radiology/report-status` (the worklist REPORT_FINAL transition, the only write that happens for an unbilled study) — now independently reject an obstetric/fetal ultrasound study with `409 pcpndt_compliance_required`, resolved from the DB-authoritative `radiology_worklist` row, never from client-supplied values. See §8's new subsection and §17.1/§18.1, now updated to reflect this as done rather than pending.

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
| PCPNDT Form F gate | **Finalize blocked, client- and server-side (interim, not the full migration)** | Confirmed: the canonical workspace's `finalizeReport()` had **zero** PCPNDT check, and — verified in the follow-up safety review — neither does `FetalUsgLevel4.tsx`'s `final-sign` route. Only the legacy `usgReports.ts` route performs the real Form F verification. This PR does not port that verification logic itself (see §17.1) — instead, an obstetric/fetal study is now blocked from finalizing through the canonical workspace at every layer: client-side (`finalizeReport()` hard-blocks with a persistent UI notice and a Copilot reminder) AND server-side (`POST /api/patient-reports` and `POST /api/internal/radiology/report-status` both independently reject with `409 pcpndt_compliance_required`, classified from the DB-authoritative worklist row) — directing the user to the actually-compliant legacy page (§8). |

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
| `usg-obstetric` | `copilotUsgObstetricModule.ts` | US + obstetric-pattern study | GA/EDD, placenta, liquor statement completeness; PCPNDT Form F reminder — paired with a real, hard finalize block, not advisory-only (see below) |
| `usg-thyroid` | `copilotUsgThyroidModule.ts` | US + thyroid-pattern study | TI-RADS on a described nodule, isthmus, cervical nodes |
| `usg-breast` | `copilotUsgBreastModule.ts` | US + breast-pattern study | BI-RADS on a described lesion, laterality, axilla |
| `usg-scrotum` | `copilotUsgScrotumModule.ts` | US + scrotal-pattern study | Vascularity assessment on a described lesion, laterality |
| `usg-doppler` | `copilotUsgDopplerModule.ts` | US + Doppler-pattern content | PSV/EDV pairing, missing RI/S-D ratio, waveform description (grounded in `docs/usg-reporting-audit/06-measurements-and-calculations.md` §4's findings) |

`RadiologyReportingWorkspace.tsx` gained six side-effect `import` lines alongside the three pre-existing ones. Zero edits to `copilotModules.ts`/`copilotOrchestrator.ts`/`CareCopilotPanel.tsx`. 43 unit tests (one file per module) plus the 3 pre-existing Copilot test files all pass (94/94 total).

### PCPNDT finalize guard, client-side (added in the first safety-review follow-up)

A reminder in the Copilot panel is advisory — a radiologist can ignore it and finalize anyway. This PR adds a real block, not just visibility:

- **Classification**: `isObstetricUsgStudy(modality, studyDescription)`, a pure function in `lib/usgModality.ts`, alongside the existing `isUltrasoundModality`/`normalizeModality`. It is `true` only when the study is ultrasound **and** its worklist study description matches an obstetric/fetal pattern (pregnancy, fetal, gestation, nuchal, NT scan, anomaly scan, growth scan, TIFFA, etc.) — the same pattern the `usg-obstetric` Copilot module already used, now extracted to one shared, tested location instead of two independently-maintained regexes (avoids duplicating the classification, per the Hard Rule against duplicating the PCPNDT engine).
- **Enforcement point**: `RadiologyReportingWorkspace.tsx`'s `finalizeReport()` — the single function every finalize path calls (the toolbar button, the Ctrl+Enter shortcut, and the Command Palette's `finalize` command all dispatch through it). A guard, placed alongside the existing `lockedByOther`/`lockLost` early-return guards, blocks with a `toast()` and returns before any network call when `isPcpndtRelevantUsg` is true. This is a **client-side** guard — it stops the normal UI/keyboard/palette paths, but on its own does not stop a maliciously-crafted direct API call. That gap is closed by the server-side guard below, added in a second follow-up.
- **What stays available**: draft save, print, preview, and the AI-review panel are completely unaffected — only the Finalize action is gated. Non-obstetric USG (Whole Abdomen, KUB, Thyroid, Breast, Scrotum, Doppler, ...) and every non-ultrasound modality (MRI, CT, ...) are unaffected — `isObstetricUsgStudy()` returns `false` for all of them, verified by unit test.
- **Visibility**: three layers, not one — (1) the Finalize button itself is `disabled` and its tooltip explains why, (2) a persistent red inline notice sits next to the button whenever a PCPNDT-relevant study is open (visible before the user even attempts to click Finalize, unlike a toast), and (3) the `usg-obstetric` Copilot module's reminder, updated to describe the block rather than merely suggest checking Form F.
- **Where it points**: the legacy `UsgReporting.tsx` page (`/usg/reporting`) — the only pipeline in the codebase with a real, server-enforced Form F lock (`usgReports.ts:464-503`) — plus the existing "Review & Map to Form F" button (already in the Measurements tab, unchanged) and `/form-f` directly. **Not** to Fetal USG: verified in this follow-up review that `FetalUsgLevel4.tsx`'s `final-sign` route has no PCPNDT check either (only report-status and critical-alert-acknowledgement checks) — routing users there would have created a false impression of compliance.
- **Tests**: `usgModality.test.ts` (frontend) gained a dedicated `isObstetricUsgStudy` suite (11 cases) covering: every non-ultrasound modality returns `false` regardless of description (MRI/CT never blocked); every non-obstetric USG study description (Whole Abdomen, KUB, Thyroid, Breast, Scrotum, Carotid Doppler, TVS, Pelvis, Prostate) returns `false` (general USG finalizes normally); every obstetric/fetal description variant seen in practice returns `true` across multiple US-family modality spellings; case-insensitivity; and null/undefined/empty description handled without throwing. `finalizeReport()` itself is not independently unit-tested — consistent with this file's existing convention (its sibling guards, `lockedByOther`/`lockLost`, aren't either) — its ~10-line guard is a direct, by-inspection wiring of the fully-tested predicate, not new logic of its own. Fetal USG's non-regression is demonstrated by its own pre-existing test suite (`fetalUsgLevel4.test.ts`, 14 tests + `obstetricCalculations.test.ts`, 57 tests — 71/71 passing, unchanged, since neither `FetalUsgLevel4.tsx` nor its routes were touched by this guard).

### PCPNDT finalize guard, server-side (completes the protection — second safety-review follow-up)

The client-side guard above stops the normal application UI but not a direct, hand-crafted API call — an honest limitation flagged explicitly when it shipped. This follow-up closes that gap with real backend enforcement, without duplicating the PCPNDT engine itself (the Form F check stays solely in `routes/usgReports.ts`).

- **Classification, reused not duplicated**: `isObstetricUsgStudy(modality, studyDescription)` was mirrored into `artifacts/api-server/src/lib/usgModality.ts` — the backend package's existing, already-established mirror of the frontend's `usgModality.ts` (its own header comment already documents this pattern: "the two packages don't share a lib, so this is a deliberate, documented duplicate" of the *classification*, not of any compliance-checking logic). A configuration-driven `requiresPCPNDT` column/table was considered (per the review request's stated preference) and deliberately not built: the only place it could live without a broader schema change is `radiology_worklist`/`radiology_protocols`, and adding a column there — plus the settings UI to manage it — is a bigger surface change than "one final backend enforcement layer" calls for. The regex-based classifier is already a single, easily-editable source of truth shared by three call sites (two backend, one frontend); promoting it to an admin-editable config table is recommended as later follow-up (§18.1), not attempted here.
- **Two independent enforcement points, not one** — found by tracing the actual write path (`radiologyReportLifecycle.ts`'s `finalizeRadiologyReport()`), not assumed:
  1. **`POST /api/patient-reports`** (`routes/patient-reports.ts`) — the actual content-persisting write. This is where a report's `body`/`impression` are stored and, for the D5 structured path, auto-signed. Blocking *only* the later status-flip endpoint would still let an obstetric study's full report content be created and signed — worse than the pre-guard state, since it would leave a signed clinical document in the database for a non-compliant study. The guard runs immediately after `type` (`"radiology"` vs `"pathology"`) is computed, before the D5 structured-finalize transaction or the legacy insert. Scoped strictly to `type === "radiology"` with a resolvable worklist row — pathology/lab reports (which share this same generic endpoint) and every non-radiology report are untouched by construction.
  2. **`POST /api/internal/radiology/report-status`** (`routes/internal-radiology.ts`) — the worklist `REPORT_FINAL` transition. Necessary as a *second*, independent guard because an **unbilled** study (no `patientId`) never calls endpoint 1 at all in `finalizeRadiologyReport()` — this status flip is the *only* finalize-adjacent write that happens for it. The guard runs right after the worklist row is resolved (the same lookup the endpoint already performs by `studyInstanceUID`/`accessionNumber`/`studyId`), before the lock check and before any `update()`.
  - Both endpoints classify from the **DB-authoritative** `radiology_worklist.modality`/`studyDescription` columns — never from client-supplied request-body values (the `POST /api/patient-reports` payload's `parameters` field is client-supplied, opaque JSON and is deliberately never trusted for this check; endpoint 1 instead resolves the real worklist row itself via `studyId`, trying it first as `radiology_worklist.id` then as `radiology_worklist.studyId`, mirroring the ambiguity `radiologyReportLifecycle.ts` already documents in that field). This is what makes the guard resistant to a client that lies about modality/description in a hand-crafted request — proven directly by a dedicated test (see below).
  - Both return `409 Conflict` with `{ error: "pcpndt_compliance_required", message: "...finalize this study through USG Reporting..." }` when triggered.
  - Both are `type`/status-scoped narrowly (radiology only; `REPORT_FINAL` transitions only) — MRI, CT, non-obstetric USG, pathology/lab reports, and non-final worklist status changes (e.g. `REPORT_IN_PROGRESS`) for an obstetric study are all completely unaffected, proven by test, not just by inspection.
- **Legacy compliant workflow untouched**: `routes/usgReports.ts` and `UsgReporting.tsx` were not modified — they are a structurally separate route/table (`usg_report_drafts` / `/api/usg-reports`), so their existing, real PCPNDT Form F lock (`usgReports.ts:464-503`) continues to function exactly as before.
- **Integration tests** (24 new, all passing): `artifacts/api-server/src/lib/usgModality.test.ts` (5 — backend classifier parity with the frontend one), `artifacts/api-server/src/routes/patient-reports.pcpndt.test.ts` (10 — route-level, exercising the real Express handler against a mocked DB) and `artifacts/api-server/src/routes/internal-radiology.pcpndt.test.ts` (9 — same, for the status-flip endpoint). Together they prove: non-obstetric USG (every study type: Whole Abdomen, KUB, Thyroid, Breast, Scrotum, Carotid Doppler, TVS) finalizes normally through both endpoints; MRI and CT are completely unaffected; pathology/lab report creation against the *same* obstetric worklist row is unaffected (endpoint 1 is `type`-scoped); a client that lies about modality in the `parameters` blob is still blocked (endpoint 1 reads the DB row, not the request body); obstetric/fetal USG under every US-family modality spelling is rejected with `409 pcpndt_compliance_required` and, critically, **no report row is created** and **the worklist status is never flipped**; a study that can't be classified at all (no resolvable worklist row) fails open rather than blocking indiscriminately, since this same generic endpoint also serves every other modality and report type; and the pre-existing `patient-reports.d5`–`.d9` test suites (98 tests) still pass unchanged, confirming no regression to D5 structured-finalize, amendments, verification, or countersigning.

## 9. Template integration

No new template engine. USG templates continue to come from `usgReportTemplates.ts` (13 templates, live catalog feeding the canonical workspace's quick-select) and now additionally from the new `radiology_protocols` rows (§14), which surface through the same Protocol Engine UI/mechanism MRI already uses. The duplicate-store situation (§5.2) is documented, not consolidated — consolidating `radiologyMasterTemplates.ts` (dead code) or wiring the YAML catalog are template-authority decisions the task spec explicitly defers ("Audit duplicate template stores. Recommend consolidation. Do NOT migrate historical reports.") — see §18.

## 10. Smart Findings integration

No new Smart Findings engine. Thirty-six new `radiology_quick_findings` rows were added across 13 USG study tabs (Whole Abdomen, KUB, Pelvis, TVS, Obstetric, Growth, Anomaly, NT, Thyroid, Breast, Scrotum, Doppler, Soft Tissue) — a representative starter set per study type, not an exhaustive clinical catalog (see §17). Nine of the thirty-six are structured findings using the existing `{key}`/`questions_json` mechanism (Follicle Tracking, Renal Calculus, Hydronephrosis, Fibroid Uterus, Ascites grading, NT Measurement, Thyroid Nodule, Solid Breast Lesion, Varicocele). `anatomical_section` is deliberately left blank on every row (see §14's rationale) since no USG study type has a DB-backed `structured_report_templates` entry yet for the Smart Findings section-flip mechanism to target.

## 11. Measurement integration

No new measurement engine was built or planned — out of scope for a workspace-configuration PR (see PR A's own explicit deferral of `usgMeasurementEngine.ts`/`radiologySmartEngine.ts` repair, and doc 06's recommendation that this needs a dedicated, separately-scoped correctness pass). The existing `UsgMeasurementReviewPanel` continues to be the live measurement surface, unmodified. New structured findings (§10) let a radiologist type a measurement value (e.g. NT mm, nodule size mm) directly into a finding's generated text via the existing Structured Finding Assistant, which is the same mechanism MRI's structured findings already use to carry a measurement into the report/impression — no separate "map measurement to report" pipeline was added.

## 12. Settings integration

No new settings page. "USG Settings" in the sidebar links to the existing `/settings/radiology-quick-select` (`RadiologyQuickSelectSettings.tsx`), which already provides admin CRUD for Study Tabs, Quick Findings, Quick Measurements, Protocols, and Clinical History Chips — five of the task spec's nine listed settings concerns, already unified in one page before this PR. (Templates/Copilot/Recommendations/Study-tab-permissions live in other existing, unmodified settings surfaces — `ReportTemplates.tsx`, `RadiologySettingsCenter.tsx`, and the general permission system — none of which needed a change for this PR.)

## 13. Files modified / added

**Modified (8):**
- `artifacts/diagnostic-erp/src/components/Layout.tsx` — nested USG Reporting subgroup, one-level nested-group rendering support.
- `artifacts/diagnostic-erp/src/pages/RadiologyWorklist.tsx` — `?modality=` lazy-init for `modalityFilter`.
- `artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx` — `?modality=` lazy-init for `modalityFilter`; six new Copilot module side-effect imports; client-side PCPNDT finalize guard (block + disabled button + persistent notice, see §8).
- `artifacts/diagnostic-erp/src/lib/usgModality.ts` — added `isObstetricUsgStudy()` (first safety-review follow-up).
- `artifacts/diagnostic-erp/src/lib/copilotUsgObstetricModule.ts` — refactored to consume the shared `isObstetricUsgStudy()` instead of its own local regex; updated reminder text (first safety-review follow-up).
- `artifacts/api-server/src/lib/usgModality.ts` — added `isObstetricUsgStudy()`, mirroring the frontend (second safety-review follow-up).
- `artifacts/api-server/src/routes/patient-reports.ts` — server-side PCPNDT guard in `POST /` (second safety-review follow-up).
- `artifacts/api-server/src/routes/internal-radiology.ts` — server-side PCPNDT guard in `POST /radiology/report-status` (second safety-review follow-up).

**Added (16):**
- `artifacts/diagnostic-erp/src/lib/copilotUsgAbdomenModule.ts` (+ `.test.ts`)
- `artifacts/diagnostic-erp/src/lib/copilotUsgObstetricModule.test.ts`
- `artifacts/diagnostic-erp/src/lib/copilotUsgThyroidModule.ts` (+ `.test.ts`)
- `artifacts/diagnostic-erp/src/lib/copilotUsgBreastModule.ts` (+ `.test.ts`)
- `artifacts/diagnostic-erp/src/lib/copilotUsgScrotumModule.ts` (+ `.test.ts`)
- `artifacts/diagnostic-erp/src/lib/copilotUsgDopplerModule.ts` (+ `.test.ts`)
- `migrations/zz_add_usg_platform_content_pack.sql`
- `artifacts/api-server/src/lib/usgModality.test.ts` (backend classifier — this file had no tests at all before)
- `artifacts/api-server/src/routes/patient-reports.pcpndt.test.ts`
- `artifacts/api-server/src/routes/internal-radiology.pcpndt.test.ts`
- `docs/usg-reporting/platform-consolidation-pr-b.md` (this file)

(`artifacts/diagnostic-erp/src/lib/usgModality.test.ts` was extended, not added — see §15.)

No file was deleted. No existing test was modified — only extended (frontend `usgModality.test.ts` gained the `isObstetricUsgStudy` suite).

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

- **Root workspace typecheck** (`pnpm run typecheck`, covers `lib/*` + all `artifacts/*` packages + `scripts`): **clean, 0 errors** — re-verified after each follow-up (the client-side guard, the merge that pulled in MRI PR 3/4 after PR #88's base branch moved and conflicted, and the server-side guard).
- **`diagnostic-erp` full test suite**: **660/660 passing** (48 from this PR: 43 across the six Copilot module test files + 5 `isObstetricUsgStudy` cases in `usgModality.test.ts`; the rest of the growth from the original 622 is MRI PR 3/4's own new tests, pulled in by the merge — zero regressions either way).
- **`api-server` PCPNDT-specific suite**: **24/24 passing** — `usgModality.test.ts` (backend classifier, 5), `patient-reports.pcpndt.test.ts` (10, route-level), `internal-radiology.pcpndt.test.ts` (9, route-level). The pre-existing `patient-reports.d5`–`.d9` suites (98 tests, covering structured-finalize, amendments, verification, countersigning on the SAME route file this guard touches) re-run and pass unchanged.
- **Full monorepo test suite** (`vitest run --root .`, with `DATABASE_URL` pointed at a throwaway local Postgres to unblock the handful of files that import DB-backed modules at module-load time): **2087/2087 passing**, 138/138 test files — tracked at each stage (2020 pre-PR → 2025 after the client-side guard → 2063 after merging in MRI PR 3/4 from the moved base branch → 2087 after the server-side guard), zero regressions introduced at any stage.
- **Fetal USG non-regression, explicitly**: `fetalUsgLevel4.test.ts` (14 tests) and `obstetricCalculations.test.ts` (57 tests) re-run in isolation after both PCPNDT follow-ups — **71/71 passing, unchanged** — confirming Fetal USG remains fully available and functional (neither its page nor its routes were touched by either guard).
- **`diagnostic-erp` production build** (`pnpm run build`): succeeds at every stage, including a `RadiologyReportingWorkspace`/`RadiologyWorklist` chunk with no new build warnings.
- **`api-server` typecheck**: clean, 0 errors, including the new route-level test files (one narrow TS control-flow-narrowing false positive inside a test's `for` loop was found and fixed with a local cast — not a real type error, a TS inference limitation on a `let`-reassigned nullable object).
- **Migration**: applied live against a real ephemeral PostgreSQL 16 database (schema materialized via `drizzle-kit push` from the current live schema, then the migration applied via `psql`) — see §14 for the specific checks performed. This exceeds the verification depth possible in a database-less sandbox.
- **Browser-level sanity check**: the Vite dev server was started and the app loaded in headless Chromium (Playwright, pre-installed in this environment). The bundle — including the modified `Layout.tsx` — compiled and executed with **zero JS `pageerror`/uncaught exceptions**; the app correctly redirected to `/portal` (no session), confirming the whole React tree (Layout, App, routing) mounts cleanly with the new nav code in place.

## 16. Screenshots

**Not produced.** A fully authenticated walkthrough (login → sidebar → USG Worklist → General USG Reporting → Fetal USG → Fetal Echo → Doppler Reporting) requires a seeded staff account, clinic settings, and a running `api-server` against a fully-migrated database with auth secrets configured — none of which are documented or available in this sandbox (no `.env.example`, no staff-seed script found). This mirrors the exact limitation PR A recorded in this same repository ("Screenshots of the corrected UI in a live browser/database environment could not be produced from this sandbox"). In its place, §15 documents the concrete, live verification that was performed instead (types, 2020 tests, production build, a live-DB migration apply with idempotency/consistency checks, and a headless-browser load with zero JS errors).

## 17. Known limitations

1. **PCPNDT Form F gate: client- AND server-blocked in the canonical workspace, but still not the real compliance check.** Neither the canonical workspace's finalize path nor `FetalUsgLevel4.tsx`'s `final-sign` route performs the actual Form F verification (ID card check, husband/father name, address, consent date) — only the legacy `UsgReporting.tsx`/`usgReports.ts` does that (`usgReports.ts:464-503`). What this PR now guarantees, both client-side (§8, first follow-up) and server-side (§8, second follow-up, `POST /api/patient-reports` + `POST /api/internal/radiology/report-status`), is that an obstetric/fetal ultrasound study **cannot reach a finalized state through the canonical workspace at all** — via the UI, keyboard shortcut, Command Palette, or a direct API call. This is a real, verified, defense-in-depth block, not merely advisory visibility. What it is **not**: a substitute for actually performing the Form F check within the canonical workflow — that would require either porting the real verification logic there (a second implementation of the same regulatory check, which duplicates rather than reuses the PCPNDT engine, and needs careful reconciliation with the legacy pipeline first) or retiring the legacy pipeline in favor of routing all obstetric finalizes through it. `FetalUsgLevel4.tsx`'s `final-sign` route still has no Form F check and was not touched by this guard (it's a separate route entirely, pre-dating this PR — see §18.1).
2. **Content is representative, not exhaustive.** 36 Quick Findings and 13 Protocols across 13 study types is a real starting catalog, not full coverage of the ~37 study types the prior audit (doc 05) catalogued. Gynaecology beyond TVS (follicular monitoring detail, infertility workup), exotic Doppler vessels (renal/portal/hepatic/penile/AV fistula), and Hernia/PVR/Appendix as standalone studies remain thin or absent, exactly as doc 05 found before this PR.
3. **Copilot content overlap.** The new `usg-doppler` and `usg-abdomen` modules can produce advisory items alongside `radiologyCoPilotEngine.ts`'s pre-existing hardcoded USG Doppler reminder (`id: "rem-usg"`) and abdomen organ checklist for the same study — both surfaces are additive (no dedup by design across the whole Copilot system, confirmed for the pre-existing modules too), so this is redundancy, not a bug, but worth reconciling later.
4. **No live-authenticated browser verification** (§16).
5. **`anatomical_section` is unset on every new USG finding** (§10/§14) — a deliberate choice, not an oversight, given no DB-backed structured template exists yet for any USG study type.
6. **Measurement-calculation correctness bugs are unchanged.** `usgMeasurementEngine.ts` and `radiologySmartEngine.ts` still contain their own, independently-wrong GA/biometry formulas (distinct from PR A's corrected `obstetricCalculations.ts`, which only covers the Fetal USG Level-4 module). Out of scope for this PR.

## 18. Recommended future migration plan

Ordered by the same reasoning the prior audit used (touch hot/shared files last, safest-file-first):

1. **PCPNDT reconciliation** (doc 09 Phase 4, still the single highest-stakes item — now narrower, not eliminated). Both the client- and server-side *blocks* are done (§8) — an obstetric/fetal USG study genuinely cannot be finalized through the canonical workspace, by any path, today. What remains is the *positive* half of the decision: (a) port the real Form F verification logic itself (not just a block) into the canonical finalize path — this means either calling into `usgReports.ts`'s check as a shared function, or building a properly-scoped, single second implementation and formally retiring the check in `usgReports.ts` so there is exactly one PCPNDT engine, never two live ones — with real route-level tests against a live-migrated test database (this session's ephemeral-Postgres technique, demonstrated in §14/§15, is directly reusable for that); or (b) retire the legacy `usg-reports` pipeline in favor of routing all obstetric finalizes through the canonical path once (a) is live. Whichever is chosen, the same decision should also add a Form F check to `FetalUsgLevel4.tsx`'s `final-sign` route, which this review confirmed has none either, and should revisit whether `isObstetricUsgStudy()`'s regex-based classification ought to become the config-driven `requiresPCPNDT` property considered (and deliberately deferred, see §8) in this follow-up — most naturally as a column on `radiology_protocols`/`radiology_study_tabs` once those are wired to USG's canonical content (§18.2), rather than a new standalone table.
2. **Template-authority decision** (doc 05's recommendation, still open): pick one authoritative USG template source — `usgReportTemplates.ts` (current interim renderer, real and live) vs. the YAML content-pack catalog (doc 05/06's recommended long-term shared measurement+finding store, currently unwired) — and either wire the YAML loader or formally deprecate it; either way, delete the confirmed-zero-importer `radiologyMasterTemplates.ts` and the flag-gated, also-zero-live-callers `radiologyReportAssembler.ts` once their content (if any is still wanted) is migrated into the chosen authority. **✅ Partially resolved — see [`usg-template-store-consolidation.md`](./usg-template-store-consolidation.md):** the canonical `structured_report_templates` table is now the authority for the 13 live USG auto-generate skeletons (seeded via the existing `/seed` preset endpoint, DB-first with fail-open code fallback; auto-fill safety bindings stay code-owned; byte-identical default rendering proven by committed golden fixtures). Still open from this item: the YAML catalog wire-or-deprecate decision, and the `radiologyMasterTemplates.ts` deletion (blocked on extracting `criticalWatchListFor`, which the canonical workspace still imports).
3. **Expand the content pack** (§17.2) toward doc 05's full 37-study-type coverage — Gynaecology (follicular monitoring, infertility workup) and the remaining Doppler vessels are the largest gaps.
4. **Wire `anatomical_section`** for USG findings once (or if) a DB-backed `structured_report_templates` row exists for a given USG study type, enabling the Smart Findings section-flip mechanism for USG the same way it already works for MRI.
5. **Repair the measurement-calculation layer** (doc 06's recommendation, unchanged by this PR or by PR A, which was explicitly scoped to Fetal USG Level-4 only): finish wiring `structuredReport`'s catalog+validator as the shared measurement store, salvage `usgMeasurementEngine.ts`'s correct ellipsoid/RI formulas into it, and delete/replace its incorrect GA formulas and `radiologySmartEngine.ts`'s duplicate set.
6. **Reconcile Copilot content overlap** (§17.3) between the new modular USG advisories and the pre-existing hardcoded core reminders, once the modular additions have been in production long enough to know which framing radiologists actually prefer.

No step above requires — or should become — a second Reporting Workspace, Smart Findings engine, Template engine, Copilot, Report lifecycle, Measurement engine, or Settings page. Each is content, configuration, or a narrowly-scoped extension of an existing shared mechanism, consistent with this PR's own approach.
