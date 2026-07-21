# Phase P4 — Enterprise Interoperability & Clinical Exchange Report

**Scope:** Gates **G12–G22** from `V1.1_IMPLEMENTATION_CONSTITUTION.md` — the standards-based
exchange layer: DICOM Structured Report, encapsulated PDF, GSPS/SEG foundations, MPPS & Storage
Commitment status, HL7/FHIR backend interfaces, viewer synchronization deep-links, the immutable AI
timeline, the AI version-comparison view, the human feedback dataset, and the enterprise API surface.

**Nothing here redesigns or replaces the report.** SR / PDF / FHIR are **ADDITIONAL exports** linked
to `patient_reports`; GSPS/SEG are **foundations/storage interfaces only** (no overlay editor, no
segmentation engine); FHIR emits **resources into a log only — no external send**. The Strangler
Pattern holds throughout: byte-level DICOM/DIMSE runs through the **existing** DICOM agent + Orthanc
and the **existing** `dicom_sr_export_queue`; identity comes from the P0 canonical crosswalk; the
structured content source is the P1/P2 immutable provisional store. **No parallel implementations.**
AI still never signs, never writes `patient_reports`, and **never auto-learns** (the feedback dataset
is analytics/export only). Everything remains behind the P3 master flag + per-scope gating (default OFF).

---

## 1. Implementation summary

| Area | Gate | What shipped (reusing existing infra) | Status |
|---|---|---|---|
| DICOM SR (TID 1500) | G12 | Pure `buildSrContentTree` → `dicom_sr_documents`; DIMSE hand-off via the **existing** `dicom_sr_export_queue`. Additional export; never replaces the report. | ✅ |
| Encapsulated PDF | G13 | `encapsulated_pdf_exports` (versioned) storage/link table; encoding runs via the existing Orthanc path. | ◑ (storage + link) |
| GSPS foundation | G14 | `presentation_states` interface (overlay payload + referenced UIDs). **No overlay editor.** | ◑ (foundation) |
| SEG foundation | G15 | `segmentation_objects` storage interface (label + storage/PACS ref). **No segmentation engine.** | ◑ (foundation) |
| MPPS + Storage Commitment | G16 | `mpps_events` + `storage_commitments` status tables + status API. | ✅ (status layer) |
| HL7 / FHIR | G17 | Pure R4 mappers (`DiagnosticReport`/`ImagingStudy`/`Observation`/`ServiceRequest`) → `fhir_export_log`. **Resources only, no external send.** | ✅ |
| Viewer sync | G18 | Pure OHIF/Weasis deep-links anchored on G6 evidence (study→series→instance); **reuses** `studyLaunchService` base-URL selection. | ✅ |
| AI timeline | G19 | Pure `buildAiTimeline` over the immutable `ai_shadow_drafts` versions + feedback → ordered history. | ✅ |
| AI comparison | G20 | Pure `compareAiVersions` — added/removed/changed findings, measurement deltas, impression + model/prompt change. | ✅ |
| Feedback dataset | G21 | Pure `buildFeedbackDataset` — de-identified JSONL + stats. **Analytics/export only; no retraining.** | ✅ |
| Enterprise APIs | G22 | `/api/ai/interop` router — timeline, versions, comparison, evidence+links, status, SR/FHIR export, feedback dataset. Same gating; exports admin-only. | ✅ |

---

## 2. Gates completed (G12–G22)

- **G12 DICOM SR** — `srContentModel.buildSrContentTree` builds a **TID 1500 (Imaging Measurement Report)**
  content tree as structured JSON: a *Findings* container (TEXT per finding, laterality-prefixed, with
  `INFERRED FROM` IMAGE evidence refs), a *Measurement Group* container (NUM), an *Impression* TEXT, and a
  per-series **evidence UID map**. `interopService.exportStructuredReport` persists it to
  `dicom_sr_documents` and enqueues the DIMSE C-STORE via the **existing** `dicom_sr_export_queue` — no new
  queue/worker. SR is an *additional* SOP instance; the ERP report is untouched.
- **G13 Encapsulated PDF** — `encapsulated_pdf_exports` records each versioned PDF SOP instance + `pdf_sha256`;
  the byte encoding reuses the existing Orthanc create-DICOM path (storage/link layer shipped here).
- **G14 GSPS / G15 SEG foundations** — `presentation_states` and `segmentation_objects` are **interfaces only**:
  they store the referenced series/SOP UIDs, an overlay/segmentation payload or storage ref, and a status.
  No overlay editor and no segmentation engine are introduced (explicitly out of scope).
- **G16 MPPS + Storage Commitment** — `mpps_events` (IN_PROGRESS/COMPLETED/DISCONTINUED) and
  `storage_commitments` (requested/committed/failed) capture procedure-step and commitment status; surfaced by
  `getInteropStatus`.
- **G17 HL7 / FHIR** — `fhirMapping` emits FHIR **R4** `DiagnosticReport`, `ImagingStudy`, `Observation`
  (one per measurement), and `ServiceRequest`, logged to `fhir_export_log`. Pure + unit-tested. **No external
  send** — this is a backend interface producing resources for a future integration engine.
- **G18 Viewer sync** — `viewerDeepLinks` computes the **image-anchor fragment** (OHIF query params /
  Weasis `$dicom:get` args) that jumps an open viewer to the exact series/instance a finding was inferred
  from. It does **not** re-implement network selection — the workspace's canonical `studyLaunchService`
  supplies the base URL; this only adds the anchor. Findings without a series/instance are flagged
  `hasAnchor: false` so the UI disables "jump to image" rather than opening the wrong slice.
- **G19 AI timeline** — `buildAiTimeline` shapes the **immutable** history: every provisional version
  (`ai_shadow_drafts`, append-only), its snapshot revision + provenance, and every feedback event, ordered
  chronologically with deterministic tie-breaking.
- **G20 AI comparison** — `compareAiVersions` diffs two versions by stable finding `key` / measurement `id`:
  added / removed / changed findings (text/laterality/negation), measurement deltas, impression change, and
  model/prompt provenance change. **AI-vs-AI only** — it never diffs against `patient_reports`.
- **G21 Human feedback dataset** — `buildFeedbackDataset` shapes accept/edit/ignore/reject rows into a
  **de-identified** dataset (patient identity dropped) + aggregate stats + JSONL. It is a dataset **only**;
  the platform performs **no retraining** and **no auto-learning**.
- **G22 Enterprise APIs** — `routes/aiInterop.ts` exposes the read + export surface under `/api/ai/interop`,
  gated exactly like the P3 clinical router (master flag + per-scope visibility); write/export endpoints
  require a full-access role. Nothing here signs, writes a report, or retrains.

---

## 3. Files changed

**New — schema/migration:** `lib/db/src/schema/aiInterop.ts` (7 tables), `migrations/add_ai_interop.sql`.
**New — api-server `lib/ai/interop/` (pure unless noted):** `interopTypes.ts`, `srContentModel.ts`,
`fhirMapping.ts`, `viewerDeepLinks.ts`, `aiComparison.ts`, `aiTimelineShaping.ts`, `feedbackDataset.ts`,
`interop.test.ts` (21 cases), and the DB service `interopService.ts`. **New route:** `routes/aiInterop.ts`.
**Modified:** `lib/db/src/schema/index.ts` (export `aiInterop`), `lib/db/src/schema/aiClinicalConfig.ts`
(6 additive `ai_draft_feedback` columns for G21), `routes/index.ts` (mount `/api/ai/interop`),
`lib/ai/aiIsolation.test.ts` (recurse into `interop/` + cover the new route), `scripts/grounding.manifest.json`
(76 → 101 claims).

---

## 4. Database migrations

`migrations/add_ai_interop.sql` — 7 additive tables (`dicom_sr_documents`, `encapsulated_pdf_exports`,
`presentation_states`, `segmentation_objects`, `mpps_events`, `storage_commitments`, `fhir_export_log`)
+ 6 additive `ai_draft_feedback` columns (`reason`, `laterality`, `measurement_ref`, `confidence`,
`prompt_version`, `model_version`). All `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, idempotent.
Sorts alphabetically after `add_ai_clinical_config.sql` (which creates `ai_draft_feedback`), so the `ALTER`
always runs after that table exists — passes `check-migration-order.cjs`. No new foreign keys (the new
tables link by `report_id` / `study_instance_uid` values, not hard FKs) so there are no ordering hazards.

---

## API documentation (G22 enterprise surface)

All endpoints are mounted at `/api/ai/interop` behind `requireStaffAuth` + `requireStaffPermission("/radiology")`
and the same master-flag + per-scope gating as the clinical router. Reads return **204** when AI is not visible
to the user; write/export endpoints require a full-access (admin) role.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/ai/interop/timeline?studyInstanceUid=` | visible | Immutable AI history (versions + feedback), ordered (G19) |
| GET | `/api/ai/interop/versions?studyInstanceUid=` | visible | List provisional versions (metadata) |
| GET | `/api/ai/interop/comparison?studyInstanceUid=&from=&to=` | visible | Diff two AI versions (G20) |
| GET | `/api/ai/interop/evidence?studyInstanceUid=&ohifBase=&wadoBase=` | visible | Evidence anchors + OHIF/Weasis deep-links (G18) |
| GET | `/api/ai/interop/status?studyInstanceUid=` | visible | SR/PDF/MPPS/Storage-Commitment status (G13/G16) |
| POST | `/api/ai/interop/structured-report` `{studyInstanceUid}` | admin | Build SR (TID 1500) + enqueue DIMSE export (G12) |
| POST | `/api/ai/interop/fhir-export` `{studyInstanceUid}` | admin | Emit + log FHIR R4 resources (G17) |
| GET | `/api/ai/interop/feedback-dataset?studyInstanceUid=&action=` | admin | De-identified feedback dataset + stats (G21) |

Feedback **capture** reuses the existing P3 endpoint (Strangler — no parallel path), now extended with the
G21 structured fields: `POST /api/ai/draft/:id/feedback` `{studyInstanceUid, findingKey?, action,
editedText?, reason?, laterality?, measurementRef?, confidence?, promptVersion?, modelVersion?}`.

The existing measurements / structured-report / evaluation / study-timeline reads remain served by their
existing routers (`/api/ai/*`, `radiology*`, evaluation runner) — this surface adds the interop-specific
endpoints without duplicating them.

## 5. DICOM conformance summary (foundation)

| Object | SOP / template | Direction | Transport | Notes |
|---|---|---|---|---|
| Structured Report | TID 1500 (Imaging Measurement Report) | Export (additional) | Existing `dicom_sr_export_queue` → DICOM agent C-STORE | Content tree = findings (TEXT) + measurements (NUM) + impression + IMAGE evidence refs |
| Encapsulated PDF | Encapsulated PDF Storage | Export (versioned) | Existing Orthanc create-DICOM | `encapsulated_pdf_exports` records SOP UID + sha256 |
| GSPS | Grayscale Softcopy Presentation State | Foundation | — (storage interface) | Referenced series/SOP + overlay payload; no editor |
| SEG | Segmentation Storage | Foundation | — (storage interface) | Label + storage/PACS ref; no segmentation engine |
| MPPS | Modality Performed Procedure Step | Status | Recorded from DICOM agent events | IN_PROGRESS / COMPLETED / DISCONTINUED |
| Storage Commitment | Storage Commitment Push Model | Status | Recorded from DICOM agent events | requested / committed / failed |

The **byte encoding and DIMSE association** are the responsibility of the existing DICOM agent
(`services/dicom-pull-agent`) + Orthanc; P4 provides the content model, storage/link layer, and status —
it does not add a second DICOM stack. Full DICOM Conformance Statement authoring is a deployment-time task.

## 6. FHIR mapping (R4)

| ERP concept | FHIR resource | Key fields |
|---|---|---|
| Report | `DiagnosticReport` | `status`, `category` RAD, `subject` Patient, `imagingStudy`, `conclusion` (impression), `result` (Observation refs) |
| Study | `ImagingStudy` | `identifier` `urn:oid:<StudyInstanceUID>`, `modality`, `subject` |
| Measurement | `Observation` (one per measurement) | `category` imaging, `valueQuantity {value, unit}`, `derivedFrom` study |
| Order | `ServiceRequest` | `intent` order, `category` imaging (SNOMED 363679005), accession identifier |

Resources are logged to `fhir_export_log`; **no external transmission** occurs in P4. A downstream
integration engine (HL7v2/FHIR endpoint) is the future consumer.

## 7. Synchronization architecture (viewer sync — G18)

The image anchor flows **findings → G6 evidence (`ai_evidence`) → deep-link**. The reporting workspace
already launches studies through the canonical `studyLaunchService` (network auto-selection, identity
rules, mixed-content guards). P4 does **not** duplicate any of that: `buildFindingViewerLinks` takes the
already-selected OHIF base URL (and optional WADO URL) and appends the series/instance anchor so a click on
a finding jumps the viewer to the exact slice. OHIF uses `StudyInstanceUIDs` / `SeriesInstanceUID` /
`initialSopInstanceUid`; Weasis uses a narrowed `$dicom:get` argument set. Findings without an anchor are
explicitly flagged so the UI never opens the wrong image.

## 8. AI timeline design (G19)

`ai_shadow_drafts` is append-only and DB-immutable (P3 patch trigger), so the version history **is** the
audit trail. `buildAiTimeline` merges versions + feedback (+ optional report events) into one chronological,
deterministically-ordered list — pure, clock-free (timestamps passed in as epoch millis) so it is fully
testable and reproducible. It surfaces per-version provenance (snapshot revision, model digest, prompt
version, finding count, quality score, degraded flag) without ever mutating anything.

## 9. AI comparison (G20)

`compareAiVersions` is the "what changed between AI runs" engine. Identity is the stable finding `key` and
measurement `id`, so a reworded finding is a **change**, not an add+remove. It reports finding
adds/removes/changes (distinguishing text vs laterality vs negation changes), measurement deltas, impression
change, and model/prompt change, plus an `identical` short-circuit. It compares **AI versions to each other
only**.

## 10. Human feedback dataset (G21) — no retraining

`buildFeedbackDataset` turns `ai_draft_feedback` rows into a **de-identified** dataset: patient identifiers
are dropped; only finding key, action, laterality, measurement ref, confidence, and model/prompt provenance
survive. It emits aggregate stats (accept/edit/reject rates, by prompt/model version) and JSONL for offline
curation. **The platform never trains on this** — it is an export for humans to review. This preserves the
constitution's hard rule: *AI never auto-learns.*

---

## 11. Feature flags & safety

Every `/api/ai/interop` endpoint resolves the same enablement as P3 (`ff_radiology_ai` master flag +
per-scope policy, default OFF). Reads return `204` when AI is not visible to the user; SR/FHIR export and the
feedback dataset require a full-access (admin) role. The **AI isolation guard** (`aiIsolation.test.ts`) now
recurses into `lib/ai/interop/` and covers `routes/aiInterop.ts`, so the interop service and router are held
to the same invariant: no writes to `patient_reports`, the human draft, amendments, or signatures.

---

## 12. Verification

- `node scripts/grounding-check.cjs` — **101/101** claims hold (was 76; +25 for P4 tables/columns/functions).
- `node scripts/check-migration-order.cjs` — **no ordering violations**.
- `tsc --build` (libs) + api-server + diagnostic-erp typechecks — **clean**.
- `vitest run` — **2626 tests pass**; the P4 pure suite (`interop.test.ts`, 21 cases) and the extended
  isolation guard pass. (The 7 failing test *files* are the pre-existing `DATABASE_URL`-at-import failures,
  unrelated to P4 — payments, presentation templates, ops/diagnostics, pacsEnterprise.)

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| SR/PDF byte encoding + DIMSE association not exercised in-sandbox (no PACS/agent here) | Med | Content model is pure + unit-tested; encoding reuses the **existing** agent/Orthanc + `dicom_sr_export_queue` (already in production). Full C-STORE verified only in staging (guide §13.6). |
| SR built from the AI provisional store, not a signed report | Med | Deliberate foundation choice — `buildInteropReport` is the single seam; swapping in the finalized report is a one-function change. SR is an *additional* export and never replaces the ERP report. |
| FHIR resources are minimal R4 (no full profiling/terminology binding) | Low | Backend interface only, logged not sent; a downstream integration engine adds profiles/terminology later. No external send in P4. |
| Viewer deep-links depend on correctly configured OHIF/WADO base URLs | Low | URL selection reuses the hardened `studyLaunchService` (scheme/credential/mixed-content guards); anchors are appended, not re-derived. Findings without an anchor are flagged, never mis-linked. |
| Feedback dataset could leak PHI if shaping is bypassed | Low | `buildFeedbackDataset` drops patient identifiers by construction and a test asserts no study/patient id survives; export is admin-gated. |
| New tables link by value (no hard FKs) so orphan rows are possible | Low | Intentional (additive, avoids migration-order hazards); links are `report_id` / `study_instance_uid` values validated at query time. |
| MPPS/Storage-Commitment SCU wiring is status-layer only | Low | Explicitly foundation; tables + status API ship, live SCU is a staging/deploy task (guide §13.9). |

No risk in this phase changes the safety spine: AI never signs, never writes `patient_reports`, and never
auto-learns; everything stays behind the default-OFF gate.

## Rollback plan

Rollback is **layered and non-destructive**:

1. **Instant (no deploy):** set `feature_flags.ff_radiology_ai = false` (or narrow the per-scope policies).
   Every `/api/ai/interop` read returns `204` and exports are refused immediately — the entire P4 surface
   goes dark without touching data.
2. **Code:** revert the P4 commit(s). The new router/service/pure modules are additive; removing them leaves
   P0–P3 untouched (no P3 file was modified except the additive G21 feedback fields, which are backward-compatible).
3. **Schema (only if required):** the migration is additive and idempotent; the new tables and columns can be
   left in place harmlessly. If a full teardown is needed, the explicit manual rollback SQL is documented at the
   top of `migrations/add_ai_interop.sql` (`DROP TABLE …` for the 7 tables + `DROP COLUMN …` for the 6
   `ai_draft_feedback` columns). **No previous data is destroyed** — the P1/P2/P3 tables are never altered.

There is no data migration to reverse and no destructive change to undo; the safe default is rollback step 1.

## 13. Staging validation guide

Assumes a staging env with `DATABASE_URL`, Orthanc, the DICOM agent, and P3 gating enabled for a pilot user.

1. **Interop hidden when AI is OFF** — `GET /api/ai/interop/timeline?studyInstanceUid=…` returns `204` for a
   non-pilot user (same gate as the clinical router).
2. **Timeline is immutable & ordered** — with ≥2 provisional versions for a study, `GET …/timeline` lists
   `ai_version` entries in ascending order interleaved with feedback; confirm no endpoint can mutate a version.
3. **Version list + comparison** — `GET …/versions` lists all versions; `GET …/comparison?from=1&to=2` shows
   added/removed/changed findings, measurement deltas, and model/prompt change.
4. **Evidence deep-links** — `GET …/evidence?studyInstanceUid=…&ohifBase=<url>&wadoBase=<url>` returns anchors +
   OHIF/Weasis links; confirm a finding with a series/SOP has `hasAnchor: true` and the link carries
   `SeriesInstanceUID`/`initialSopInstanceUid`.
5. **DICOM SR export (additional)** — as admin, `POST …/structured-report {studyInstanceUid}`; confirm a
   `dicom_sr_documents` row (status `pending`) **and** a new `dicom_sr_export_queue` row are created, and the
   ERP report is unchanged.
6. **SR reaches PACS via the existing agent** — drive the existing SR export worker; confirm the SR SOP instance
   stores to Orthanc and `dicom_sr_documents.status` advances — no second DICOM stack involved.
7. **Encapsulated PDF** — confirm a versioned `encapsulated_pdf_exports` row is created and encoding uses the
   existing Orthanc create-DICOM path.
8. **GSPS/SEG are foundation-only** — confirm `presentation_states` / `segmentation_objects` accept referenced
   UIDs + payload/ref but there is **no** overlay editor or segmentation engine.
9. **MPPS / Storage Commitment status** — confirm `GET …/status` reflects `mpps_events` and `storage_commitments`.
10. **FHIR export (no external send)** — as admin, `POST …/fhir-export {studyInstanceUid}`; confirm
    `fhir_export_log` gains `ServiceRequest`/`ImagingStudy`/`Observation`/`DiagnosticReport` rows and **nothing
    leaves the network**.
11. **Feedback dataset is de-identified** — `GET …/feedback-dataset`; confirm no patient identifiers appear and
    stats/JSONL are present.
12. **No auto-learning** — confirm there is no retraining trigger anywhere; the dataset is export-only.
13. **AI never signs / never writes the report** — run the isolation guard (`aiIsolation.test.ts`); confirm the
    interop service/router are covered and pass.
14. **Rollback by flags** — set `ff_radiology_ai = false`; confirm all `/api/ai/interop` reads return `204` and
    exports are refused — no code deploy required.

---

## What was explicitly NOT done (deferred, by instruction)

No multi-agent AI, knowledge graph, digital twin, pathology integration, autonomous reporting, automatic
signing, or automatic learning. GSPS/SEG ship as **foundations only** (no overlay editor / segmentation
engine). FHIR ships as **backend resources only** (no external integration engine). Full DICOM Conformance
Statement authoring and live MPPS/Storage-Commitment SCU wiring are deployment-time tasks. **P4 stops here —
Phase P5 is not begun.**
