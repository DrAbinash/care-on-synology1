# CARE USG Companion — Phase 1

**Voluson Smart Reporting Foundation (no AI vision).** A workflow-automation
layer that turns the machine information the Voluson/DICOM pipeline already
extracts into a structured pre-report snapshot **inside the existing Reporting
Workspace** (`RadiologyReportingWorkspace.tsx`). Not a new page, not a new
workflow, not a new engine.

> Goal: reduce reporting time for Dr. Sugandha by presenting a recognised study,
> the right template + protocol, suggested history, imported measurements, a
> readiness score and a previous-study check *before* the radiologist starts
> typing — all composed from infrastructure that already exists.

---

## 1. Audit summary (current state, verified against code)

A fresh audit of the live code (not prior docs) confirmed the platform is
mature and the Companion is a **composition + presentation** problem, not a
build-new-engines problem.

| Subsystem | Status today | Key entry points |
|---|---|---|
| Voluson / DICOM ingest | Auto-fires USG extraction on study intake | `internal-radiology.ts` `POST /studies` (auto `runUsgExtraction`), `radiology_worklist` (live study row), `GET /api/internal/radiology/worklist/:id` |
| Measurement extraction | DICOM SR → GE private tags → Gemini OCR, persisted | `usgExtractor.ts` `runUsgExtraction()`, tables `usg_measurements` / `usg_doppler_measurements` / `usg_extraction_logs` |
| Measurement Review Panel | Accept / Reject / Trace + confidence & source badges | `UsgMeasurementReviewPanel.tsx` (+ `PATCH /measurements/:id/{approve,reject,field}`) |
| Study recognition | Canonical USG taxonomy + regex classifier | `usgReportTemplates.ts` `suggestTemplate()` → `UsgTemplateId`; `studyRegion.ts` `matchStudyRegion()` |
| Template engine | Auto-fill from approved measurements | `autoGenerateReport()`, `POST /api/usg-reports/{suggest-template,auto-generate}` |
| Protocol engine | Region-scoped presets w/ `isDefault` | `radiology_protocols`, `GET /api/radiology/quick-select`, workspace `applyProtocol()` |
| Clinical history | Non-destructive chips | `clinicalHistoryText.ts` `hasPhrase/appendClinicalPhrase/removeClinicalPhrase` |
| Quick / Smart findings | Deterministic suggestion + merge | `QuickFindingsPanel.tsx`, `applySectionContribution()` |
| Viewer measurement bridge | Shared TanStack cache | `useViewerMeasurements()` + `/api/radiology-lesions/viewer-measurements` |
| Copilot | Deterministic core + local/AI modules | `analyzeCopilot()` + `runLocalModules()`; `CopilotContext` (already carries `viewerMeasurements`, `prior`, `missingRequiredMeasurements`) |
| Previous comparison | Pure diff engine + panel | `radiologyComparison.ts`, `ComparisonPanel.tsx` |
| Quality score | Text-quality score (0-100) | `reportValidator.computeQualityScore()` |
| Reliability | Offline guard + backoff retry | `reliability.ts`, `useOnlineStatus()`, `ModuleErrorBoundary` |

Two findings shaped the design: (a) `CopilotContext` **already** has a
measurement channel, so "Copilot integration" means *feeding* it, not building a
second Copilot; (b) the Measurement Review Panel already had Accept/Reject/Trace
but **not** an inline **Modify** (its backend `PATCH /measurements/:id/field`
existed with zero callers) nor an **Edited** state — the only real measurement
gap, filled here by wiring the existing endpoint.

---

## 2. Existing infrastructure reused (no V2 of anything)

| Companion feature | Reused as-is |
|---|---|
| Study detection | `suggestTemplate()` (`usgReportTemplates.ts`) |
| Template selection | `USG_TEMPLATES` / `suggestTemplate` / `autoGenerateReport` |
| Protocol selection | `radiology_protocols` + workspace `requestProtocolChange()` (auto-applies the existing `isDefault`) |
| Clinical history | `hasPhrase` / `appendClinicalPhrase` (never overwrites user text) |
| Measurement storage | `usg_measurements` / `usg_doppler_measurements` (read-only projection; no new measurement table) |
| Measurement review | `UsgMeasurementReviewPanel` (extended, not replaced) |
| Viewer measurements | `useViewerMeasurements()` shared cache |
| Copilot | existing `CopilotContext` + one registered local module |
| Previous study | existing `patient_reports` / `usg_report_drafts` data |
| Reliability | `reliability.ts` + `ModuleErrorBoundary` |
| Quality score | `computeQualityScore()` shown alongside (untouched) |

---

## 3. New components (minimal surface)

**Server**
- `lib/db/src/schema/usgCompanion.ts` — `companion_runs` **telemetry** table (one row/study; no measurement duplication).
- `migrations/add_usg_companion_runs.sql` — idempotent, auto-discovered.
- `artifacts/api-server/src/lib/usgCompanion.ts` — pure assembly helpers (expected-measurement map per study type, `summarizeMeasurements`, `extractMachine`, time-saved estimate).
- `artifacts/api-server/src/routes/careUsgCompanion.ts` — `GET /study/:uid` (assembly, never 500s), `POST /runs` (telemetry upsert), `GET /dashboard-stats`.

**Client**
- `lib/usgCompanionReadiness.ts` — `computeReadinessScore()` + `buildCompanionTimeline()` (pure; a **sibling** of `computeQualityScore`, not an extension).
- `lib/usgCompanionTypes.ts` — shared payload types.
- `lib/copilotUsgCompanionModule.ts` — one registered advisory Copilot module.
- `components/radiology/UsgCompanionPanel.tsx` — the Companion (Study Summary, Readiness ring + axes, Timeline, machine measurements, previous studies, one-click actions, warnings).
- Extended `UsgMeasurementReviewPanel.tsx` (inline **Modify** + **Edited** badge), `RadiologyReportingWorkspace.tsx` (mount + Copilot feed), `RadiologyOperationsDashboard.tsx` (**Companion Status** card), `copilotOrchestrator.ts` (`CopilotContext.usgCompanion`).

The Companion mounts once, top of the USG report editor, gated by
`isUltrasound && entry` and wrapped in `ModuleErrorBoundary` — an error there can
never break reporting.

---

## 4. Workflow

```
Patient → Voluson → DICOM push → Study detected (radiology_worklist)
  → Patient matched → Images linked → Measurements extracted (auto runUsgExtraction)
  → GET /api/care-usg-companion/study/:uid  (Companion assembly)
      ├─ Study Type detected      (suggestTemplate)
      ├─ Template + Protocol       (reused engines; one-click apply)
      ├─ Clinical History          (suggested chips, non-destructive)
      ├─ Measurements summarised   (detected / missing vs expected)
      ├─ Previous studies          (USG / MRI / CT)
      └─ Readiness + Timeline      (workspace live state)
  → Copilot reviews (existing Copilot + ctx.usgCompanion)
  → Radiologist edits → Finalize
  → POST /runs (telemetry) → Dashboard "Companion Status" card
```

---

## 5. Report Readiness Score (pure workflow, not AI)

`0-100` from six equally-honest axes: measurements (25, proportional; auto-
complete when a study type has none), template (15), protocol (15), clinical
history (15), quick findings (15), Copilot review (15). Shown as a ring + a
per-axis checklist next to the existing text-quality score.

---

## 6. Tests

- `artifacts/api-server/src/lib/usgCompanion.test.ts` — study detection, measurement summary (found/missing, doppler, extras, provenance source, graceful no-data), machine extraction (measurement cols / flat / nested DICOM-JSON / malformed), time-saved. (13 cases)
- `artifacts/diagnostic-erp/src/lib/usgCompanionReadiness.test.ts` — readiness scoring (full / empty / proportional / no-measurement study types / clamp) + timeline. (7 cases)
- Verified: full workspace + api-server typecheck clean; no regression in the existing suite.

---

## 7. Performance & reliability

- One study-scoped `GET` per study (`staleTime 30s`), cacheable by the service worker (shared resource, not identity-scoped).
- Assembly degrades per-section (`degraded: true`) and never 500s; the panel renders a quiet fallback on error and never blocks save/finalize.
- Telemetry is fire-and-forget with `retryWithBackoff`; dashboard stats tolerate a pre-migration table (returns zeros).

---

## 8. Remaining automation opportunities (future phases)

- Auto-apply the detected template on assembly (today: one-click; the auto-select effect already exists for structured templates).
- Seed USG `radiology_protocols` defaults per study type (none exist yet), so "Protocol loaded" is automatic.
- Repair the dead `GET /api/radiology-copilot/prior-studies` endpoint so `ComparisonPanel` gets full cross-modality priors (Companion currently self-serves priors).
- Extend `usg_audit_log` with Companion action values for a fully server-derived timeline.
- Provider-fallback (Ollama-first) for USG OCR, mirroring the ID-card `ocrProviderResolver`.

---

## HARD RULES compliance

No USG Workspace V2, Measurement Engine V2, Template Engine V2, Protocol Engine
V2 or Copilot V2. Every capability is a read-only projection or a thin extension
of existing infrastructure. The only new persistence is a telemetry table; the
only new engine-adjacent code is a pure workflow-completeness score explicitly
separate from the existing quality score.
