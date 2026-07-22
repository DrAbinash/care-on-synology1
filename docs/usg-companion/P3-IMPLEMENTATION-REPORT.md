# USG Companion — Phase P3 (DICOM-native extraction & provenance)

**Branch:** `claude/usg-companion-p3-dicom-provenance` (stacked on merged P0–P2).
**Flags:** `ff_radiology_usg_dicom_extraction`, `ff_radiology_usg_exact_provenance` — **default OFF**.

P3 closes the "frame hardcoded to 1 / no SCOORD caliper" provenance gap at the
deterministic-logic level. This PR delivers the **pure, fixture-tested core**;
the DB-extractor wiring + live viewer navigation are the documented integration
step (needs real PACS/Orthanc to validate — see clinic checklist).

## Gap map (existing `usgExtractor.parseDicomSr`)

- Walked ContentSequence for NUM but read only the code *meaning*; **frame
  hardcoded to 1** everywhere; ignored SR-internal `ReferencedSOPSequence` /
  `ReferencedFrameNumber` and `SCOORD` calipers; only NUM value type handled.
- No candidate retention / conflict surfacing (SR>GE>OCR merge discarded losers).
- `viewer_measurements` (which has `sop_instance_uid` / `frame_number` /
  `image_coordinates`) was **not populated** by extraction.
- OCR ran frame-1 only. No fixtures.

## Delivered (all pure + unit-tested)

| Module | Capability |
|---|---|
| `usgSrContentTree.ts` | Standards-compliant SR content-tree parser (CONTAINER/NUM/CODE/TEXT/UIDREF/IMAGE/SCOORD/SCOORD3D). Resolves each NUM's referenced image **SOP + frame + SCOORD caliper** (TID-1400 `NUM→SCOORD→IMAGE`) and laterality/finding-site codes. **Never fabricates a frame** (no ref → `undefined`). |
| `usgProvenance.ts` | Provenance model + **honest degradation** (`exact_frame_caliper` / `source_image` / `ocr_image` / `sr_document` / `series_only` / `manual` / `unavailable`), truthful labels, and `viewerActions()` — only the navigations actually possible. |
| `usgExtractionHierarchy.ts` | The ONE deterministic source ranking (SR-SCOORD > SR-NUM > GE tag > PDF > OCR > manual). **Retains all candidates**, flags material conflicts (>2%) for review — lower-priority disagreements are never discarded. |
| `usgSrProvenanceBuilder.ts` | SR measurement → provenance and → a canonical `viewer_measurements` row (real frame + `image_coordinates` caliper JSON; `frameNumber` null when unknown). |
| `__fixtures__/usgSrFixtures.ts` | Synthetic **no-PHI** DICOM-JSON SR fixtures: NUM+SCOORD+referenced-frame, NUM+image (no caliper), NUM+laterality (no image), Doppler NUM, no-image, malformed. |

**Tests:** 27 new (`usgSrContentTree` 6, `usgProvenance` 7, `usgExtractionHierarchy` 6, `usgSrProvenanceBuilder` 4, + fixtures) — all green; full-workspace typecheck 0 errors.

## Supported measurement identity (P3.3)

Concept resolution reads Code Value + Coding Scheme + Meaning (not just the
display label), so canonical mapping can key on codes. The pure core is
measurement-agnostic (any NUM); the canonical-id crosswalk to
`@workspace/measurements` is the follow-up wiring step.

## Remaining P3 integration (documented, needs live PACS)

1. Wire `usgSrContentTree` into `runUsgExtraction` behind `ff_radiology_usg_dicom_extraction` (replace the shallow parse; keep legacy fallback).
2. Behind `ff_radiology_usg_exact_provenance`: insert `srMeasurementToViewerRow(...)` into `viewer_measurements`, and add viewer `goToInstance/goToFrame/showOverlay` actions.
3. OCR hardening (P3.6): multi-frame candidate selection (key-image markers / annotation density), not frame-1-only.
4. Encapsulated-PDF extraction candidate source.

These require rendered frames / a live Orthanc to validate end-to-end and are
listed in the clinic checklist. The **flags stay OFF** until validated.

## Classification

**CODE COMPLETE (core) — INTEGRATION & CLINIC VALIDATION PENDING.** The
deterministic extraction/provenance logic is implemented and tested; DB wiring +
live viewer navigation + OCR hardening remain and need real PACS to validate.
