# USG Companion — Clinic / Staging Validation Checklist

Executable checklist for validating the USG Companion on the **real** CARE
environment. **No item is auto-completed** — each must be checked by a human on
staging/clinic with real infrastructure. Keep every flag OFF until its row passes.

Enable/disable flags through the **rollout control page** (`/radiology/usg-rollout`,
admin-only) or `PATCH /api/feature-flags/:key`. The page enforces dependencies
and records an audit entry for every change.

## 0. Baseline (no flags)
- [ ] Deploy all merged commits. Confirm the app boots (`Startup migrations applied`).
- [ ] All USG flags OFF. Open a US study → it serves the **canonical** `RadiologyReportingWorkspace` (no regression).
- [ ] `/radiology/usg-rollout` shows every phase **not production-ready**, all flags off.

## 1. P0–P2 workspace (pilot baseline)
- [ ] Enable `ff_radiology_usg_workspace` (force+reason — not clinic-validated yet). Open a US study → dedicated workspace loads; lock/save/finalize round-trip works; audit author correct.
- [ ] Enable `ff_radiology_usg_companion_p2`. Readiness bar, organ states, presets, consistency all behave. Disable → workspace goes inert, canonical fallback returns.

## 2. P4 prior comparison (wired)
- [ ] Enable `ff_radiology_usg_prior_intelligence`. In a patient with ≥2 US studies, the right-rail "Prior comparison" panel lists **same-patient** priors only.
- [ ] Pick a prior → structured deltas render (direction, %Δ, interval). Accept a suggestion → it appends to the **current** draft's impression only; the prior report is untouched.
- [ ] Confirm a different patient's studies never appear. Confirm `GET /api/usg-prior/...` returns 404 when the flag is OFF.

## 3. P4 pregnancy timeline (server wired; UI pending)
- [ ] (After the timeline UI lands) Enable `ff_radiology_usg_pregnancy_timeline`; verify GA/EFW/AFI trends and episode grouping; separate pregnancies never merge.

## 4. P5 OB / Doppler (after Slice 3 integration)
- [ ] Enable `ff_radiology_usg_ob_canonical`. OB section builds from the canonical engine; **no fetal sex** anywhere.
- [ ] Incomplete Form F → finalize is **blocked** (409 `pcpndt_compliance_required`). Complete Form F → finalize succeeds. Try a direct `POST /api/patient-reports` bypass → still blocked.
- [ ] Enable `ff_radiology_usg_doppler_canonical`. Doppler measurement → structured section + impression; absent/reversed EDF flagged descriptively (no auto-diagnosis).

## 5. P3 extraction + provenance (needs live Orthanc / GE Voluson)
- [ ] Enable `ff_radiology_usg_dicom_extraction`. Push a Voluson SR/private-tag study → measurements extract; SR/GE preferred over OCR; candidates retained on conflict; re-run is idempotent (no duplicates).
- [ ] Enable `ff_radiology_usg_exact_provenance`. Each measurement shows its true provenance level; viewer navigates to the **actual** instance/frame; **no frame defaulted to 1**. If the viewer lacks caliper overlay → labelled unavailable, navigation still works.

## 6. P6 report → PACS (needs live Orthanc)
- [ ] Enable `ff_radiology_usg_report_to_pacs`. Finalize a signed USG report → an Encapsulated-PDF DICOM appears in Orthanc, opens in OHIF/Weasis, linked to the correct study/accession, new Series/SOP UID.
- [ ] Draft reports are never pushed. A failed push leaves the report finalized. A corrected report produces a **new** object (no overwrite). Retry is idempotent.

## 7. P7 cine (needs viewer)
- [ ] Enable `ff_radiology_usg_cine`. A multi-frame series plays/steps; mark a key frame → persisted as a DICOM reference in `usg_key_images` and linked to a measurement. Non-cine images show no playback. Viewer-unavailable → "Open in OHIF" + limitation shown.

## 8. P8 AI assistant (needs model gateway)
- [ ] Enable `ff_radiology_usg_ai_assistant` for a pilot radiologist only. Generate a suggestion → shows evidence + values; **Accept** appends to the draft; **Reject** discards. AI never finalizes/signs/writes `patient_reports`/emits fetal sex (verify audit + a direct-bypass attempt).
- [ ] Gateway down → "AI unavailable" state; manual reporting unaffected.

## 9. Rollback drill
- [ ] For each flag: disable it → the feature hides and the canonical fallback/behaviour returns; no data is lost. Use the **kill switch** to disable all USG flags at once; confirm everything reverts.

## 10. Sign-off
- [ ] Record the tester, date, environment, and Orthanc/viewer/gateway versions for each passed row before marking a phase `clinic_validated`.

> Do not mark any clinic item complete automatically or claim validation that did not occur.
