# USG Companion — Phase P7 (Cine loops)

**Branch:** `claude/usg-companion-p7-cine` (stacked on P6 `claude/usg-companion-p6-pacs-return`).
**Flag:** `ff_radiology_usg_cine` — **default OFF** (depends on `ff_radiology_usg_dicom_extraction`).

P7 adds deterministic cine-loop (multi-frame ultrasound) modelling and key-frame
selection as a **pure core** that **reuses the P3 `SrImageRef` provenance model** —
a cine key frame references a SOP + frame exactly like any other measured frame,
so it navigates and audits through the same path. No new store, no fabricated
frame counts.

## Gap map

- P3 resolved single-frame image references; there was **no cine-clip descriptor**
  (frame count / rate / duration) and no deterministic key-frame selection.
- A cine key frame needs to reuse the canonical `SrImageRef` (SOP + frame), not a
  second image-reference model.

## Delivered (pure + unit-tested)

| Module | Capability |
|---|---|
| `usgCineClip.ts` | `parseCineClip` (NumberOfFrames + CineRate / RecommendedDisplayFrameRate / FrameTime → clip descriptor; **cine only when >1 frame**; count/rate read, never fabricated); `selectKeyFrame` (explicit selection clamped into range, else middle frame — deterministic); `cineFrameRef` (emits a **P3-shaped `SrImageRef`** for the key frame; null frame for non-cine); `cinePlaybackCapability` (honest canPlay/fps/duration). |

**Tests:** 11 new (`usgCineClip`) — all green. Full-workspace `pnpm typecheck` 0 errors; flag-registry validation (`radiologyOpsHealth`) green with the new entry (dependency on `ff_radiology_usg_dicom_extraction`).

## Non-negotiable constraints honored

- **No parallel image-reference model.** Cine key frames reuse P3's `SrImageRef`.
- **No fabrication.** A single-frame image is not a cine loop; frame count/rate are read from the dataset or left null.
- **No new store.** Purely a descriptor + selection over the existing DICOM instance.
- **Flag default OFF, `wired:false`.**

## Remaining P7 integration (documented, needs rendered frames / a live viewer)

1. Behind `ff_radiology_usg_cine`: surface cine playback + frame-step in the
   viewer, and let the radiologist pin a key frame that flows into a measurement's
   provenance (via `cineFrameRef`).
2. Persist the pinned key frame in the canonical `viewer_measurements` row (frame
   number already supported).
3. **Clinic validation needs rendered multi-frame data / a live Orthanc+viewer** —
   the CI container has no PACS/viewer, so end-to-end cine playback could not be
   exercised here (documented, not faked).

**Flag stays OFF** until validated.

## Classification

**CODE COMPLETE (core) — VIEWER WIRING & CLINIC VALIDATION PENDING.**
