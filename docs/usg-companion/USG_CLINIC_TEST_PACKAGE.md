# USG Companion — Executable Clinic Test Package (GAP 11)

The **authoritative, human-run** validation package for the real CARE clinic /
staging environment. **No test here may be marked passed automatically or from
CI.** A tester records evidence for each row before a phase is called
`CLINIC VALIDATED`.

- Enable/disable flags through **`/radiology/usg-rollout`** (admin) or
  `PATCH /api/feature-flags/:key`. The rollout page enforces dependencies and
  audits every change.
- **All flags start OFF.** Enable strictly in the order in §1.
- Record for every row: tester, date, environment, and Orthanc / OHIF / AI-gateway
  versions.

---

## 1. Feature-flag activation order (dependency-safe)

| # | Flag | Depends on |
|---|---|---|
| 1 | `ff_radiology_usg_workspace` | — |
| 2 | `ff_radiology_usg_companion_p2` | workspace |
| 3 | `ff_radiology_usg_prior_intelligence` | — |
| 4 | `ff_radiology_usg_pregnancy_timeline` | prior_intelligence |
| 5 | `ff_radiology_usg_ob_canonical` | — |
| 6 | `ff_radiology_usg_doppler_canonical` | — |
| 7 | `ff_radiology_usg_dicom_extraction` | — |
| 8 | `ff_radiology_usg_exact_provenance` | dicom_extraction |
| 9 | `ff_radiology_usg_cine` | dicom_extraction |
| 10 | `ff_radiology_usg_report_to_pacs` | — |
| 11 | `ff_radiology_usg_ai_assistant` | — |
| 12 | `ff_radiology_usg_ai_growth` | ai_assistant, pregnancy_timeline |
| 13 | `ff_radiology_usg_sugandha_mode` | — |

The rollout page **refuses** any enable whose dependency is OFF, and requires a
**force + reason acknowledgement** for a not-clinic-validated phase (audited).

## 2. Required test users

| Role | Purpose |
|---|---|
| `admin` / `super_admin` | rollout page, flag enable/disable, PCPNDT override, kill switch |
| pilot radiologist (Dr. Sugandha) | reporting, AI accept/reject, pilot mode |
| non-admin radiologist | fallback + permission tests |
| receptionist (non-radiology) | negative auth test (must be 403 on `/api/usg-*`) |

## 3. Required dummy studies (synthetic, no real PHI)

Provision these on the modality / PACS test AE (or via the DEMO mode where the
step allows):

| # | Study | Used by tests |
|---|---|---|
| A | GE Voluson **DICOM SR** OB study | T4, T5 |
| B | GE Voluson **private-tag** study | T5 |
| C | **Multi-frame cine** US clip | T6 |
| D | Obstetric study, **incomplete Form F** | T7 |
| E | Obstetric study, **complete Form F** | T8 |
| F | **Prior-study pair** (same patient, two dated US studies) | T9 |
| G | **Doppler** study (UA/MCA or limb vessels) | T10 |

---

## 4. Test scenarios

> Format per test — **Setup · Steps · Expected · Evidence · DB/API check · Rollback.**
> Mark PASS/FAIL/BLOCKED manually.

### T0 — Baseline (no flags)
- **Setup:** deploy all merged commits; all USG flags OFF.
- **Steps:** open a US study at `/radiology/report/:id`.
- **Expected:** canonical `RadiologyReportingWorkspace` loads; no USG Companion surface; no regression.
- **Evidence:** screenshot of canonical workspace.
- **DB/API:** `GET /api/feature-flags` → every `ff_radiology_usg_*` = false.
- **Rollback:** n/a.

### T1 — Workspace + P2 (pilot baseline)
- **Setup:** enable `ff_radiology_usg_workspace` then `ff_radiology_usg_companion_p2` (force+reason).
- **Steps:** open a US study at `/radiology/usg/:studyId`; lock → build findings → Save → reload → Finalize.
- **Expected:** dedicated workspace loads; readiness bar + organ states; draft round-trips; signed report created; audit author correct.
- **Evidence:** screenshots pre/post save; signed PDF.
- **DB/API:** `radiology_report_drafts` row for the study; `patient_reports` row on finalize; `usg_audit_log` entries.
- **Rollback:** disable both flags → canonical fallback returns; no data lost.

### T2 — Voluson SR extraction (Study A) *(needs live Orthanc + `ff_radiology_usg_dicom_extraction` / `_exact_provenance`)*
- **Setup:** enable extraction + exact_provenance; push Study A.
- **Steps:** open the study; start extraction; review source candidates; approve a subset; re-run extraction.
- **Expected:** SR measurements extracted; **SR/GE preferred over OCR**; every candidate source retained; conflicts flagged; **re-run is idempotent** (no duplicates); nothing auto-approved.
- **Evidence:** candidate list screenshot; provenance level per measurement.
- **DB/API:** `usg_measurements` rows (status `pending_review`→`approved` only via the approve endpoint); `viewer_measurements` DICOM-SR rows with real SOP/frame; `usg_extraction_logs` job row + parser version. Re-run: row counts unchanged.
- **Rollback:** disable flags → extraction reverts to legacy shallow parse; `viewer_measurements` untouched.

### T3 — Viewer frame provenance (Study A) *(needs live OHIF viewer)*
- **Setup:** extraction validated (T2).
- **Steps:** on a measurement, use "go to frame" / overlay.
- **Expected:** viewer navigates to the **actual instance/frame**; **no measurement navigates to frame 1** for an unknown frame; capability level shown honestly (exact-frame-caliper / exact-frame / source-image / series-only / SR-doc / OCR / manual / unavailable). If the OHIF build can't render SCOORD overlays: instance/frame navigation still works and overlay is labelled unsupported.
- **Evidence:** screen recording of navigation.
- **DB/API:** the measurement's `frame_number` is the real frame or NULL — never a fabricated 1 (see the automated null-frame tests).
- **Rollback:** disable exact_provenance.

### T4 — Cine playback (Study C) *(needs live viewer)*
- **Setup:** enable `ff_radiology_usg_cine`; open Study C.
- **Steps:** detect multi-frame; play/pause; next/prev frame; change speed; jump to a provenance frame; mark a key frame.
- **Expected:** playback works; frame/total shown; keyboard controls **don't interfere with report typing**; a marked key frame persists as a **DICOM reference** (no blob). Viewer failure must not block reporting.
- **Evidence:** screen recording.
- **DB/API:** `usg_key_images` row with real SOP + frame; `source = 'cine'`.
- **Rollback:** disable cine.

### T5 — Voluson private-tag study (Study B) *(needs live Orthanc)*
- **Setup:** extraction enabled; push Study B.
- **Steps:** run extraction.
- **Expected:** GE private-tag measurements extracted with provenance; original + normalized units preserved.
- **Evidence:** candidate list.
- **DB/API:** `usg_measurements` provenance JSON shows `ge_private` source; units preserved.
- **Rollback:** disable extraction.

### T6 — Incomplete Form F blocks finalize (Study D)
- **Setup:** enable `ff_radiology_usg_ob_canonical`; Study D has an incomplete Form F.
- **Steps:** build the OB report; attempt Finalize; then attempt a **direct** `POST /api/patient-reports` bypass.
- **Expected:** finalize **blocked (409 `pcpndt_compliance_required`)** in the UI; the direct API call is **also blocked** (fail-closed). **No fetal sex** anywhere.
- **Evidence:** 409 response; screenshot of the block.
- **DB/API:** no `patient_reports` verified row; `usg_audit_log` / `audit_logs` shows the block (or a `pcpndt_override_finalize` only if an admin override with reason was used).
- **Rollback:** n/a.

### T7 — Complete Form F finalizes (Study E)
- **Setup:** Study E has a complete Form F.
- **Steps:** finalize the OB report.
- **Expected:** finalize succeeds; signed report created.
- **Evidence:** signed PDF; `form_f_records` id linked.
- **DB/API:** `patient_reports` verified row; `checkPcpndtFormFCompliance` → compliant.
- **Rollback:** n/a.

### T8 — Doppler section (Study G)
- **Setup:** enable `ff_radiology_usg_doppler_canonical`; approve Doppler measurements on Study G.
- **Steps:** generate the Doppler section; insert into the draft.
- **Expected:** RI/S-D recomputed from source velocities via the one engine; absent/reversed EDF flagged **descriptively** (no auto-diagnosis).
- **Evidence:** section text screenshot.
- **DB/API:** `usg_doppler_measurements` rows; section merged into `radiology_report_drafts`.
- **Rollback:** disable the flag.

### T9 — Prior comparison + timeline (Study pair F)
- **Setup:** enable `ff_radiology_usg_prior_intelligence` (+ `_pregnancy_timeline` for OB).
- **Steps:** open the newer study; view priors (same patient only); pick a prior → structured deltas; accept a suggestion; open the OB timeline.
- **Expected:** only **same-patient** priors listed; deltas show direction/%/interval; accepted text lands in the **current** draft's impression only (prior untouched); timeline shows episodes (separate pregnancies never combined) + named reference standard.
- **Evidence:** screenshots.
- **DB/API:** `GET /api/usg-prior/studies/:id/priors`; a different patient's studies never appear; `GET /api/usg-prior/...` returns 404 when flags OFF.
- **Rollback:** disable flags.

### T10 — AI advisory (any study) *(needs live AI gateway)*
- **Setup:** enable `ff_radiology_usg_ai_assistant` for the pilot user only; set `USG_AI_GATEWAY_URL`; global AI master ON.
- **Steps:** generate a suggestion; view evidence; accept; reject; regenerate.
- **Expected:** suggestion shows evidence + values; **Accept** appends to the draft; **Reject** discards; AI **never** finalizes/signs/writes `patient_reports`/emits fetal sex; a forged non-draft write → 403. Gateway down → "AI unavailable" state; manual reporting unaffected.
- **Evidence:** screenshots; the AI audit record (model/provider/prompt version/input digest/accepted-by).
- **DB/API:** `ai_shadow_drafts` / `ai_evidence` rows; direct-bypass attempt to `patient_reports` denied.
- **Rollback:** disable the flag / unset the gateway URL.

### T11 — AI Gateway health check
- **Setup:** gateway configured.
- **Steps:** `GET` the gateway health/status via the AI admin surface.
- **Expected:** healthy; when down, `/api/usg-ai/.../suggest` returns the honest `available:false` state.
- **Evidence:** health response.
- **DB/API:** `ai_provider_health_logs` (if used).
- **Rollback:** n/a.

### T12 — Orthanc health check
- **Setup:** Orthanc configured.
- **Steps:** check PACS provider health (radiology ops surface).
- **Expected:** reachable; when down, extraction/PACS-return return honest unavailable/error states and manual reporting continues.
- **Evidence:** health response.
- **DB/API:** `pacs_settings`; provider `health()` OK.
- **Rollback:** n/a.

### T13 — Viewer frame-navigation check
- Covered by T3/T4. Explicitly confirm: **no missing-frame navigation to frame 1** (backed by automated null-frame tests) and honest capability labelling.

### T14 — PACS return (Study E, signed) *(needs live Orthanc)*
- **Setup:** enable `ff_radiology_usg_report_to_pacs`; Study E finalized (T7).
- **Steps:** `POST /api/usg-pacs-return/studies/:id/return`; wait for the durable job; check status; then amend the report and return again.
- **Expected:** an **Encapsulated-PDF DICOM** appears in Orthanc, opens in OHIF/Weasis, linked to the correct study/accession, **new Series/SOP UID**; drafts never pushed; a failed push **leaves the report finalized**; a corrected report produces a **new object** (no overwrite); retry idempotent.
- **Evidence:** Orthanc instance; the diagnostic view output (GAP 10 tooling).
- **DB/API:** `radiology_pacs_archive_revisions` per-revision rows; `radiology_studies.pacs_archive_status`.
- **Rollback:** disable the flag (no un-push of an already-archived object; audited).

### T15 — Rollback & kill-switch drill
- **Setup:** several flags ON.
- **Steps:** disable each flag individually; then use the **kill switch** on `/radiology/usg-rollout`.
- **Expected:** each disable hides its feature and restores the canonical fallback/behaviour with no data loss; the kill switch disables **all** USG flags at once; everything reverts.
- **Evidence:** before/after `GET /api/feature-flags`.
- **DB/API:** `usg_audit_log` `usg_kill_switch` + per-flag `usg_flag_disable` entries.
- **Rollback:** this **is** the rollback drill.

---

## 5. Sign-off

A phase is `CLINIC VALIDATED` only when every row touching it is PASS with
recorded evidence. Capture per row: tester, date, environment, infra versions,
evidence artefact links.

> **Do not** mark any test passed automatically, and **do not** use the term
> "production-ready" until this whole package passes on the real CARE clinic.
