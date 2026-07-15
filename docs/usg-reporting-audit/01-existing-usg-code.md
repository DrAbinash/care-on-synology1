# 01 — Existing USG Code Inventory

*Audit-only document. No code was modified to produce this report. As-of commit: `15ed9dfc` (origin/feature/website-login-redirection, merge of PR #80).*

## Executive summary

There are effectively **two parallel USG reporting systems** living in this codebase side by side:

1. **The canonical path** — `RadiologyReportingWorkspace.tsx` (routed at `/radiology/reporting-workspace` and `/radiology/report/:studyId`, reached via the nav-linked Worklist Hub → `RadiologyWorklist.tsx`), which embeds a shared `UsgMeasurementReviewPanel` as an ultrasound-only tab, and saves/finalizes reports through the generic `patient-reports.ts` API (`/api/patient-reports/*`). This is the actively developed, nav-reachable, production system, and per the R2.0 initiative (see doc 02) USG was explicitly *folded into* this single page rather than getting its own.
2. **A self-contained "USG / Doppler module"** — `UsgDoppler.tsx` (hub at `/usg`) plus `UsgReporting.tsx`, `UsgDopplerReporting.tsx`, `UsgKeyImagesGallery.tsx`, `UsgCriticalAlerts.tsx`, `UsgAnalytics.tsx`, `UsgAdminSettings.tsx` — a fully-built, fully-wired, independently-tested draft/verify/finalize/amend workflow backed by its own `/api/usg-reports` API and its own `usg_report_drafts` table. Every route exists, every endpoint is real and registered, and the backend logic (PCPNDT Form F lock, quality checks, audit log, amendment chain, SHA-256 finalize hash) is genuinely production-grade. **But none of it has a sidebar/nav entry point** — it is reachable only by typing the URL directly (or via one fallback link from the Worklist table). This is not oversight-level dead code; per R2.0's own audit it was deliberately kept "legacy, preserved" because its PCPNDT compliance-lock machinery is more advanced than what the canonical workspace currently has, and merging it was deferred rather than done.

Separately, `FetalUsgLevel4.tsx` (nav-linked as "Fetal USG") is a third, independent obstetric-USG system with its own DB tables — it is the one page in this whole area that a normal user will actually find via the sidebar, but it has two concrete bugs (a hardcoded `patientId:1/studyId:1` on study creation, and a dead/unreachable duplicate route for DICOM SR extraction) and, separately, serious gestational-age calculation bugs (see doc 06).

The DICOM/Voluson "hardware integration" is real but narrow: it is AE-Title-based recognition of studies pushed by the physical GE Voluson E9 machine (seeded IP `172.16.1.46`, AE title `Voluson`, via Conquest PACS watch-folder/C-STORE) plus DICOM-SR/GE-private-tag parsing of already-ingested metadata — not a live socket/DIMSE connection to the machine. A separate `artifacts/local-dicom-bridge/` service now exists specifically to solve the SSRF/private-network-reachability problem earlier audits (June 2026) found blocking this connection. USG-specific OCR is real (Gemini Vision OCR on WADO frames as a fallback when SR/tags are missing), separate from Form F ID-card OCR.

---

## Frontend pages

### `artifacts/diagnostic-erp/src/pages/UsgReporting.tsx`
**Classification: WORKING but DISCONNECTED-FROM-NAV (functionally a DUPLICATE of the canonical reporting workflow)**

- What it does: a full draft-lifecycle USG report editor — create draft (auto-filled from approved measurements), edit, regenerate, verify, quality-check, finalize (with mandatory QC + PCPNDT Form F lock for OB templates), force-finalize (super-admin), amend, prior-report comparison, quick findings/macros, PDF/print settings. 1,094 lines, genuinely feature-complete.
- Routed: yes, `App.tsx:521` (`/usg/reporting` → `UsgReporting`).
- Nav-linked: **no**. `Layout.tsx` has no entry for `/usg/reporting` anywhere (only "Fetal USG" and "Fetal Echo" appear under Radiology & Imaging). Only reachable via direct URL or by clicking through the `/usg` hub, which is itself not nav-linked.
- Backend: hits real, fully implemented endpoints on `/api/usg-reports/*` (`usgReports.ts`, registered at `routes/index.ts:548`) — `POST /`, `POST /auto-generate`, `PATCH /:id`, `POST /:id/regenerate`, `POST /:id/verify`, `POST /:id/quality-check`, `POST /:id/finalize`, `POST /:id/finalize-force`, `POST /:id/amend`, `GET /prior/by-patient/:id` all exist and are non-trivial. No stubs.
- Duplicate concern: `UsgReporting.tsx` implements the *same* job (draft → verify → finalize → amend, with quality gating) that `RadiologyReportingWorkspace.tsx` already does for every modality including USG, but through a **completely separate table/API** (`usg_report_drafts` / `/api/usg-reports`) rather than the canonical `patient-reports` table/API that the nav-linked Workspace uses (`RadiologyReportingWorkspace.tsx` calls `/api/patient-reports/:id/verify`, not `/api/usg-reports`). Two independent, fully-working finalize pipelines exist for the same clinical task.

### `artifacts/diagnostic-erp/src/pages/UsgDoppler.tsx`
**Classification: WORKING but DISCONNECTED FROM NAV**

- What it does: this is actually the **module dashboard/hub** for the whole "USG / DOPPLER" area (despite the filename), not a Doppler-reporting page. Cards link to Worklist, Measurements, Reporting, Key Images, Doppler Reporting, Prior Comparison, Pregnancy Dashboard, Analytics, Critical Alerts, and (owner-only) Extraction Settings. Pulls live stats from `/api/usg-extraction/stats`, `/api/usg-critical/alerts?status=active`, `/api/usg-critical/productivity?days=7` — all real, registered endpoints.
- Routed: yes, `App.tsx:517` (`/usg` → `UsgDoppler`).
- Nav-linked: **no**. There is no sidebar entry pointing at `/usg` anywhere in `Layout.tsx`. The entire card-based module hub — and everything it links to — is invisible to a normal user browsing the sidebar; it can only be found by typing `/usg` in the URL bar.

### `artifacts/diagnostic-erp/src/pages/UsgDopplerReporting.tsx`
**Classification: WORKING but DISCONNECTED FROM NAV**

- What it does: structured Doppler velocimetry entry/review (PSV, EDV, RI, PI, S/D ratio) per vessel, with vessel presets, confidence display, approve/reject, print/PDF.
- Routed: yes, `App.tsx:522` (`/usg/doppler`). Nav-linked: no.
- Backend: calls `/api/usg-doppler` (GET/POST) and `/api/usg-doppler/:id` — real, registered in `usgDoppler.ts` (`routes/index.ts:545`), with full CRUD including approve/reject.

### `artifacts/diagnostic-erp/src/pages/FetalUsgLevel4.tsx`
**Classification: PARTIALLY WORKING (routed, nav-linked, mostly real — but has two real bugs)**

- What it does: standalone Level-4 obstetric ultrasound module — its own worklist, per-study measurements (CRL/NT/biometry/Doppler/BPP/twins), anatomy checklist, findings/impression/recommendation report, AI-assisted draft generation, critical-alert acknowledgement, PACS viewer launch, PDF/print, WhatsApp/email send, follow-up suggestions, template preferences, and a dashboard.
- Routed: yes, `App.tsx:542-544` (`/fetal-usg`, `/fetal-usg/:studyId`).
- **Nav-linked: yes** — `Layout.tsx:165` ("Fetal USG"), the one USG-family page with an actual sidebar entry.
- Backend registered: yes, `routes/index.ts:552` (`/fetal-usg` → `fetalUsgLevel4Router`).
- Bugs found:
  - `createStudy()` hardcodes `{ patientId: 1, studyId: 1, studyType: "early" }` when the "New Study" button is clicked. Every study created through this UI attaches to patient/study ID 1 regardless of who the user actually intended — a real, load-bearing bug, not cosmetic.
  - `POST /:studyId/extract-measurements` is **registered twice** in `fetalUsgLevel4.ts`: once early as an explicit stub (`res.json({ ok: true, message: "DICOM SR extraction not yet available." })`), and again — more fleshed out but still unimplemented — later ("Placeholder: actual DIMSE query would go here via dicomConnectors"). Because Express dispatches to the first matching handler and that handler already responds, the second, more-developed handler is dead code that can never execute. DICOM-SR auto-population is not implemented for this module.
  - Everything else (worklist, load, save-measurements, checklist, save-draft, generate-draft, review, final-sign, acknowledge-critical, follow-up-suggestion, pacs-viewer) is real and wired to genuine DB tables (`fetal_usg_studies`, `fetal_usg_measurements`, etc., `lib/db/src/schema/fetalUsgLevel4.ts`).

### `artifacts/diagnostic-erp/src/pages/UsgAdminSettings.tsx`
**Classification: WORKING but DISCONNECTED FROM NAV**

- What it does: admin console for the extraction pipeline — OCR/AI-normalize toggles, SR-priority mode, confidence thresholds, auto-reject, GE Voluson AE title/IP/port configuration, a Voluson E9 pairing checklist, push-log monitor, and a sample-test harness.
- Routed at two paths: `App.tsx:515` (`/radiology/usg-admin-settings`) and `App.tsx:525` (`/usg/settings`). Nav-linked: **no** — neither path appears in `Layout.tsx`.
- Backend: `/api/usg-extraction/settings` (GET/PUT), `/stats`, `/push-monitor`, `/sample-test` all real and registered (`usgExtraction.ts`, mounted `routes/index.ts:542`).

### `artifacts/diagnostic-erp/src/pages/UsgAnalytics.tsx`
**Classification: WORKING but DISCONNECTED FROM NAV**

- What it does: workforce productivity dashboard — TAT, template usage, amendment rate, per-radiologist and per-template breakdowns.
- Routed: `App.tsx:526` (`/usg/analytics`). Nav-linked: no.
- Backend: `/api/usg-analytics/dashboard`, `/by-radiologist`, `/by-template` — all real, mounted `routes/index.ts:550`.

### `artifacts/diagnostic-erp/src/pages/UsgCriticalAlerts.tsx`
**Classification: PARTIALLY WORKING, DISCONNECTED FROM NAV**

- What it does: USG critical-findings feed, TAT/productivity dashboard, full audit log, alert acknowledge/resolve/escalate.
- Routed: `App.tsx:524` (`/usg/critical`). Nav-linked: no.
- Backend: `/api/usg-critical/alerts`, `/productivity`, `/audit`, `/alerts/:id/acknowledge|resolve|escalate` — all real, mounted `routes/index.ts:549`, and it correctly reuses the **shared** `criticalFindingsAlertsTable` (also used by `pacsEnterprise.ts`), not a forked duplicate table.
- Real gap: the escalate action's notification delivery is a no-op — state changes persist in the DB but nobody actually gets paged (`notifyEscalation()` only logs a placeholder).

### `artifacts/diagnostic-erp/src/pages/UsgKeyImagesGallery.tsx`
**Classification: WORKING but DISCONNECTED FROM NAV**

- Gallery of curated key frames selected for report inclusion. Routed: `App.tsx:523` (`/usg/key-images`). Nav-linked: no. Backend real (`usgExtraction.ts`).

### `artifacts/diagnostic-erp/src/pages/UsgMeasurementReview.tsx`
**Classification: WORKING — genuinely reachable through the canonical flow, not a dead duplicate**

- A "thin wrapper" — resolves `studyInstanceUID`, keeps page chrome plus Key Images/Extraction History sections, and delegates all measurement review/approve/insert to the **shared** `UsgMeasurementReviewPanel` — explicitly "the SAME component the canonical RadiologyReportingWorkspace embeds as a sidebar tab" per its own header comment.
- Routed at `App.tsx:513-514, 519-520`. Nav-linked: no, **but genuinely reachable in-app**: `RadiologyWorklist.tsx` (the nav-linked canonical worklist) navigates here as an explicit fallback whenever a USG row's own worklist `id` is missing — a real, live click target from production UI, not orphaned.

### `artifacts/diagnostic-erp/src/components/radiology/UsgMeasurementReviewPanel.tsx`
**Classification: PRODUCTION-READY — this is the real, canonical piece of USG infrastructure**

- Decomposes the wide `usg_measurements` row plus any `usg_doppler_measurements` rows for a study into an approve/reject/insert measurement list, with provenance (DICOM SR / OCR / manual), "pin as key image," an OHIF viewer launch, and a "Review & Map to Form F" action. Self-documented as "R2.0 Canonical Ultrasound Integration."
- Used in two places, both real: embedded as the "Measurements" tab in `RadiologyReportingWorkspace.tsx` (gated on `isUltrasound`), and in the standalone `UsgMeasurementReview.tsx` above.

### `artifacts/diagnostic-erp/src/pages/UsgWorklist.tsx`
**Classification: DISCONNECTED / OBSOLETE (dead code, never reachable)**

- Lazy-imported but **never assigned to any `<Route component={...}>`**. The only route that could have used it, `/usg/worklist`, is instead wired to `RedirectToUnifiedWorklist`, which immediately navigates to `/radiology/worklist`. `App.tsx` documents this explicitly: *"Phase C (Radiology V2): the unified Radiology Worklist at /radiology/worklist is the single staff-facing worklist. Old worklist routes redirect here. The old page components are PRESERVED in the codebase (not deleted)."*
- The component code also contains a stale artifact confirming it predates a routing refactor: it navigates to `` `/erp/usg/measurements/${uid}` `` — an `/erp/` prefix that doesn't match any current route. Safe to delete; 100% unreachable via the UI today.

---

## Frontend lib

### `artifacts/diagnostic-erp/src/lib/usgModality.ts` (+ `usgModality.test.ts`)
**Classification: PRODUCTION-READY**

Normalizes free-text/vendor modality strings ("US", "USG", "OB US", "Doppler", "4D US", etc.) into a single "US" bucket, fixing a real historical bug where non-exact-"US" spellings silently fell out of ultrasound filters. Used by `RadiologyReportingWorkspace.tsx`, `RadiologyWorklist.tsx`, `MeasurementAssistantPanel.tsx` — i.e. by the canonical, nav-linked pages. Fully tested.

---

## Backend lib

### `artifacts/api-server/src/lib/usgModality.ts`
**Classification: PRODUCTION-READY, deliberate duplicate**

Byte-for-byte mirror of the frontend version. The header comment explicitly documents this as intentional (no shared lib between the two packages), not accidental drift.

### `artifacts/api-server/src/lib/usgExtractor.ts` (+ `.test.ts`)
**Classification: PRODUCTION-READY**

Real 4-tier extraction pipeline: DICOM Structured Report parsing → DICOM tag values → Gemini Vision OCR on WADO burned-in-text frames → Gemini text-normalization fallback. Never auto-finalizes; everything lands in `pending_review` until a human approves. Genuinely parses **GE private DICOM tags** and DICOM SR items — i.e. extracts from *already-ingested DICOM metadata*, not from a live socket connection to the machine. **Auto-triggered on intake**: `internal-radiology.ts` calls `runUsgExtraction()` fire-and-forget whenever a PACS-pushed study's modality normalizes to ultrasound — a live, production-wired pipeline. A real, seeded physical-machine configuration backs this (AE title `Voluson`, IP `172.16.1.46`, Conquest PACS, watch-folder) — real infrastructure for actual clinic hardware, but passive DICOM ingestion recognition, not an active DIMSE query/retrieve driver.

### `artifacts/api-server/src/lib/usgMeasurementEngine.ts` (+ `.test.ts`)
**Classification: PRODUCTION-READY (as a formula library) — but see doc 06 for a critical caveat: some of its outputs are correct, some are numerically broken, and its correct outputs are currently discarded by every caller.**

Derives calculated values from raw numeric measurements: kidney/prostate/thyroid/ovary/uterus volumes (ellipsoid formula, correct), resistive index (correct), gestational age from CRL/FL (broken — see doc 06). Consumed by `normalizeAndCalculate()` inside `usgExtraction.ts` — a live call site — but that call site only destructures `normalizedFields`, discarding `.calculations` entirely (see doc 06 §0/§1).

### `artifacts/api-server/src/lib/usgQualityCheck.ts`
**Classification: WORKING (rule-based, not actually "AI" despite the doc comment)**

Header says "AI Quality Check Service" but the implementation is pure regex/string-heuristic checking (impression present, empty findings placeholders, left/right mismatch, sex/anatomy mismatch, template-specific required measurements, critical-finding acknowledgement, contradiction detection, referring-doctor/patient-name completeness) — no LLM call anywhere in this file. Genuinely wired: used by both `usgReports.ts` (finalize gate) and `smartRadiology.ts`.

### `artifacts/api-server/src/lib/usgReportTemplates.ts`
**Classification: WORKING**

Defines 13 real template descriptors (OB Early/Growth/Anomaly, Pelvis Female, Whole Abdomen, KUB, Prostate, Scrotum, Thyroid, Breast, Arterial/Venous/Carotid Doppler) plus `suggestTemplate()` and `autoGenerateReport()`. Consumed exclusively by `usgReports.ts` — a fully closed, working loop, just one that lives outside the nav. Also used by the canonical Workspace's USG-mode Quick-select shortcuts (`Ctrl+1..6`).

### `artifacts/api-server/src/lib/structuredReport/__fixtures__/example4UsgAbdomen.json` and `example5DopplerCarotid.json`
**Classification: WORKING (as part of a general, shared engine — not a standalone USG pipeline)**

Golden fixtures for the *generic* structured-report engine, genuinely consumed by the canonical reporting stack. There is **no dedicated "USG structured report" UI** consuming these specific fixtures directly — they exist to prove the general engine handles USG content packs correctly.

---

## Backend routes

| Route file | Mounted? | Notes |
|---|---|---|
| `fetalUsgLevel4.ts` | Yes — `routes/index.ts:552` (`/fetal-usg`) | Real, mostly working; DICOM SR extraction is a dead-duplicate stub. |
| `usgAnalytics.ts` | Yes — `routes/index.ts:550` (`/usg-analytics`) | Real, all 4 endpoints implemented. |
| `usgCriticalAlerts.ts` | Yes — `routes/index.ts:549` (`/usg-critical`) | Real DB logic; escalation notification is a logging no-op. |
| `usgDoppler.ts` | Yes — `routes/index.ts:545` (`/usg-doppler`) | Real, full CRUD + approve/reject. |
| `usgExtraction.ts` | Yes — `routes/index.ts:542` (`/usg-extraction`) | Real, largest of the six, auto-triggered from intake. |
| `usgReports.ts` | Yes — `routes/index.ts:548` (`/usg-reports`) | Real, most sophisticated of the six — full draft lifecycle, PCPNDT Form F lock, audit, amendment chain. Backs the nav-disconnected `UsgReporting.tsx`. |

All six route files are correctly imported and mounted — none are dead at the registration level. The dead code in this area is at the *frontend routing* and *duplicate-handler* level, not missing backend registration.

---

## DB schema

- **`lib/db/src/schema/fetalUsgLevel4.ts`** — WORKING. Real, detailed Postgres tables (`fetal_usg_studies`, `fetal_usg_measurements`, plus checklists/reports/audit/alerts/template-preferences) backing `FetalUsgLevel4.tsx`. Foreign-keyed to `radiologyStudiesTable`.
- **`lib/db/src/schema/usgMeasurements.ts`** — WORKING. A wide, real table (428 lines) with per-field confidence columns for OB, gynae (uterus/ovaries), and abdominal (liver/kidney/prostate) measurements, plus the structured numeric fields consumed by `usgMeasurementEngine.ts`. Backs `usgExtraction.ts`, `usgReports.ts`, and `UsgMeasurementReviewPanel.tsx`.

---

## Cross-cutting findings

**OCR**: USG-specific OCR is real and distinct from Form F ID-card OCR — Gemini Vision OCR run on WADO image frames as tier 3 of the extraction pipeline, used only when DICOM SR/tags don't yield values.

**Voluson/DICOM hardware integration**: real but modest — AE-title-based recognition of a specific, seeded physical machine, feeding a DICOM-SR/private-tag parser plus OCR fallback. Not a live DIMSE query/retrieve driver.

**Structured reporting**: the USG fixtures are proof-of-correctness for a shared, actively-used engine, not evidence of a standalone USG structured-report feature.

**Duplicate finalize systems**: the most consequential finding for planning a new USG Reporting Workspace — `usg_report_drafts` (via `usg-reports` API, driving `UsgReporting.tsx`) and the generic report table (via `patient-reports` API, driving `RadiologyReportingWorkspace.tsx`) are two independent, fully-functional draft/verify/finalize/amend pipelines for the same clinical artifact. A new workspace needs an explicit decision about which one to build on, or whether/how to retire `usg-reports`/`UsgReporting.tsx` and the surrounding disconnected module.

**Provenance**: no `Replit` string references were found inside any USG-specific source file; git history for these files shows only in-repo commits.

---

## Summary table

| File | Classification | One-line reason |
|---|---|---|
| `pages/UsgReporting.tsx` | WORKING / DUPLICATE (disconnected from nav) | Full draft→finalize workflow, real `/api/usg-reports` backend, but no nav link and duplicates the canonical Workspace's `patient-reports` finalize pipeline. |
| `pages/UsgDoppler.tsx` | WORKING (disconnected from nav) | Real module-hub dashboard at `/usg`, hits real stats endpoints, zero sidebar entry. |
| `pages/UsgDopplerReporting.tsx` | WORKING (disconnected from nav) | Real Doppler CRUD against `/api/usg-doppler`, routed but not nav-linked. |
| `pages/FetalUsgLevel4.tsx` | PARTIALLY WORKING | Routed, nav-linked, mostly real; hardcoded `patientId:1/studyId:1` bug on create, and DICOM SR extraction endpoint is dead-duplicate stub. |
| `pages/UsgAdminSettings.tsx` | WORKING (disconnected from nav) | Real settings CRUD + Voluson pairing checklist, routed twice, never in nav. |
| `pages/UsgAnalytics.tsx` | WORKING (disconnected from nav) | Real analytics endpoints, no nav entry. |
| `pages/UsgCriticalAlerts.tsx` | PARTIALLY WORKING (disconnected from nav) | Real DB-backed alerts/audit; escalation notification is a logging no-op. |
| `pages/UsgKeyImagesGallery.tsx` | WORKING (disconnected from nav) | Real key-image CRUD, no nav entry. |
| `pages/UsgMeasurementReview.tsx` | WORKING | Thin wrapper around the shared canonical panel; genuinely reached via a Worklist fallback link. |
| `pages/UsgWorklist.tsx` | DISCONNECTED / OBSOLETE | Never assigned to any route; `/usg/worklist` redirects elsewhere; contains a stale broken internal path. |
| `components/radiology/UsgMeasurementReviewPanel.tsx` | PRODUCTION-READY | The real, shared canonical USG measurement panel used by both the Workspace tab and the standalone review page. |
| `lib/usgModality.ts` (frontend) | PRODUCTION-READY | Tested, fixes a real modality-matching bug, used by canonical nav-linked pages. |
| `lib/usgExtractor.ts` (backend) | PRODUCTION-READY | Real 4-tier extraction pipeline, auto-triggered on DICOM intake, backed by real seeded Voluson machine config. |
| `lib/usgMeasurementEngine.ts` (backend) | PRODUCTION-READY as formula library / DEAD CODE as wired output; some formulas broken | Real volume/GA/RI calculation code exists, but outputs are discarded at the only live call site, and several formulas are numerically wrong (see doc 06). |
| `lib/usgModality.ts` (backend) | PRODUCTION-READY | Intentional, documented mirror of the frontend copy; live call sites. |
| `lib/usgQualityCheck.ts` (backend) | WORKING | Real heuristic QC gate used by finalize flow (misnamed "AI" — it's pure rules). |
| `lib/usgReportTemplates.ts` (backend) | WORKING | Real 13-template catalog; consumers include the disconnected `usg-reports` API and the canonical Workspace's USG quick-select shortcuts. |
| `structuredReport/__fixtures__/example4UsgAbdomen.json`, `example5DopplerCarotid.json` | WORKING (as shared-engine test fixtures) | Prove the general structured-report engine (used by canonical reports) handles USG content; no dedicated USG UI consumes them directly. |
| `routes/fetalUsgLevel4.ts` | PARTIALLY WORKING | Registered and real, except duplicate/dead extract-measurements handler. |
| `routes/usgAnalytics.ts` | WORKING | Registered, all endpoints real. |
| `routes/usgCriticalAlerts.ts` | PARTIALLY WORKING | Registered, real DB logic, fake escalation notification. |
| `routes/usgDoppler.ts` | WORKING | Registered, full real CRUD. |
| `routes/usgExtraction.ts` | WORKING | Registered, largest/most-used route file, auto-triggered pipeline. |
| `routes/usgReports.ts` | WORKING (feeds a disconnected page) | Registered, most sophisticated of the six, backs nav-disconnected `UsgReporting.tsx`. |
| `lib/db/src/schema/fetalUsgLevel4.ts` | WORKING | Real, detailed tables backing `FetalUsgLevel4.tsx`. |
| `lib/db/src/schema/usgMeasurements.ts` | WORKING | Real, wide table backing extraction/review/report pipelines. |
