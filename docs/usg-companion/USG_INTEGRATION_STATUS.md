# USG Companion — Final Integration Status

Live status of wiring the merged P3–P9 cores into the real CARE ERP app.
**Honest labels** (per phase): CORE COMPLETE → VERTICAL INTEGRATION COMPLETE →
STAGING VALIDATED → CLINIC VALIDATED → PILOT ENABLED → PRODUCTION ENABLED.

**Nothing is enabled. Every flag is OFF. No clinic validation has occurred** (no
live Orthanc / model gateway / staging in this environment).

## Phase matrix

| Phase | Core | API | UI | Persistence | Infra test | Clinic | Flag | Status |
|---|---|---|---|---|---|---|---|---|
| **P9** admin/rollout | ✅ | ✅ `/api/usg-admin` | ✅ `/radiology/usg-rollout` | ✅ feature_flags + usg_audit_log | ✅ real DB tests | ❌ | control-plane (admin role) | **VERTICAL INTEGRATION COMPLETE** |
| **P4** prior comparison | ✅ | ✅ `/api/usg-prior` | ✅ workspace right-rail panel | ✅ reads studies/measurements/reports | ✅ real-Postgres integration | ❌ | `ff_radiology_usg_prior_intelligence` **wired** | **VERTICAL INTEGRATION COMPLETE** |
| **P4** pregnancy timeline | ✅ | ✅ `/api/usg-prior/.../timeline` | ⛔ pending | ✅ reads OB measurements | ✅ real-DB (service) | ❌ | `ff_radiology_usg_pregnancy_timeline` (server-gated; UI pending) | **PARTIAL — UI PENDING** |
| **P5** OB canonical | ✅ | ✅ `/api/usg-ob-doppler` | ✅ workspace OB/Doppler panel | ✅ reads measurements → canonical draft | ✅ real-DB integration | ❌ | `ff_radiology_usg_ob_canonical` **wired** | **VERTICAL INTEGRATION COMPLETE** (partial parity — see P5-OB-PARITY.md) |
| **P5** Doppler canonical | ✅ | ✅ `/api/usg-ob-doppler` | ✅ workspace OB/Doppler panel | ✅ reads doppler rows → canonical draft | ✅ real-DB integration | ❌ | `ff_radiology_usg_doppler_canonical` **wired** | **VERTICAL INTEGRATION COMPLETE** |
| **P3** exact provenance | ✅ | ✅ ingest wired into `runUsgExtraction` (fail-safe, flag-gated) | ⛔ viewer-nav UI needs live viewer | ✅ writes viewer_measurements (real frame, idempotent) | ✅ fixture + real-DB tests | ❌ | `ff_radiology_usg_exact_provenance` **wired** | **VERTICAL INTEGRATION COMPLETE (server)** — viewer-nav UI pending |
| **P3** SR-primary extraction | ✅ | ◐ shallow parse still primary; SR-core swap pending | ◐ existing review panel | ✅ usg_measurements | ⛔ needs Orthanc | ❌ | `ff_radiology_usg_dicom_extraction` | **CORE COMPLETE** |
| **P6** report→PACS | ✅ | ⛔ worker wiring pending | ⛔ status UI pending | ✅ pacs_archive_revisions | ⛔ needs Orthanc | ❌ | `ff_radiology_usg_report_to_pacs` | **CORE COMPLETE** |
| **P7** cine | ✅ | ⛔ pending | ⛔ viewer wiring pending | ✅ usg_key_images | ⛔ needs viewer | ❌ | `ff_radiology_usg_cine` | **CORE COMPLETE** |
| **P8** AI assistant | ✅ | ⛔ gateway wiring pending | ⛔ pending | ✅ ai_shadow_drafts / ai_evidence | ⛔ needs model gateway | ❌ | `ff_radiology_usg_ai_assistant`, `_ai_growth` | **CORE COMPLETE** |

Legend: ✅ done · ◐ partially exists · ⛔ pending · ❌ not done/not possible here.

## Delivered integration PRs (stacked)

| Slice | PR | Scope |
|---|---|---|
| 1 | #167 (merged) | P9 admin/rollout control plane (readiness matrix, server-enforced enable/disable/kill-switch, audit) |
| 2 | #168 (merged) | P4 prior intelligence (prior match, structured comparison, comparison suggestions) — API + UI + real-DB tests |
| 3 | #171 (merged) | P5 OB & Doppler canonical sections — API + workspace panel + Form-F status + real-DB tests + parity report |
| 4 | this branch `claude/usg-int-p3-extraction` | P3 exact-provenance ingest into viewer_measurements (fail-safe, idempotent, no fabricated frame) — fixture + real-DB tests |

## Remaining integration (exact steps)

### Slice 3 — P5 OB & Doppler (no external infra needed; fully completable)
1. `routes/usgObDoppler.ts` (flag-gated): `POST /studies/:id/ob-section` → `buildObSection(...)` and `POST /studies/:id/doppler-section` → `buildDopplerSection(...)`, returning the canonical `{section, impression}`; persist via the existing save-draft path (`radiology_report_drafts.findings_sections` / `impression` — text JSON) — no new store.
2. Workspace OB/Doppler modes: editable sections + measurement integration; render Form-F compliance status (read `checkPcpndtFormFCompliance`); never emit fetal sex.
3. **Form-F parity report** vs `FetalUsgLevel4.tsx` (field-by-field) before retiring the legacy route — do NOT redirect/delete it yet.
4. Tests: OB draft → incomplete Form-F blocks finalize (already enforced by the canonical gate); Doppler measurement → structured section → impression; no-sex assertion. Flip `ob_canonical` / `doppler_canonical` → wired after UI lands.

### Slice 4 — P3 extraction + provenance (needs Orthanc for live validation)
1. Behind `ff_radiology_usg_dicom_extraction`: replace the shallow parse in `runUsgExtraction` (`lib/usgExtractor.ts`) with `parseSrContentTree` + `selectByHierarchy`; keep the legacy fallback.
2. Behind `ff_radiology_usg_exact_provenance`: insert `srMeasurementToViewerRow(...)` into `viewer_measurements`; add viewer `goToInstance/goToFrame/showOverlay` via the existing OHIF extension; never default a missing frame to 1.
3. Provenance UI in the existing `UsgMeasurementReviewPanel` (level badge + viewer actions).
4. Fixture tests using the P3 `__fixtures__` SR JSON; document that end-to-end needs a live Orthanc.

### Slice 5 — P6/P7/P8 (need Orthanc / viewer / model gateway for live validation)
- **P6**: on canonical finalize, run `planUsgPacsReturn(...)`; on eligible, `enqueueRadiologyJob` a new `USG_PACS_RETURN_JOB` handler that calls `archiveReportToPacs` (idempotent). Status UI. Validate the encapsulated PDF with a DICOM reader fixture.
- **P7**: wire `parseCineClip`/`selectKeyFrame`/`cineFrameRef` to the embedded viewer (play/step/mark key frame); persist key frames to `usg_key_images` as DICOM references. When playback is unavailable → "Open in OHIF" + honest limitation.
- **P8**: wire `usgAiAssistant` to the AI gateway + `ai_shadow_drafts`/`ai_evidence`; accept-into-draft only; source-guard tests (AI cannot finalize/sign/write patient_reports/emit fetal sex). Unavailable-gateway state.

## Guarantees held across all delivered slices

- No new tables; every persistence target is a canonical existing table.
- Flags default OFF; server routes 404 when their flag is OFF (direct-API gated).
- Cross-patient comparison impossible (SQL + matcher + explicit check).
- No AI/automation can sign, finalize, write `patient_reports`, bypass Form F, or emit fetal sex.
- PCPNDT stays fail-closed (the canonical gate is unchanged).
