# Continuous Scan Mode — Architecture Readiness Review

**This is a review only. Nothing described below is implemented.** Per
explicit instruction, continuous/auto-capture mode ("card placed → automatic
detection → automatic capture → auto crop → OCR → ready", no Capture button
click) is a future enhancement. This document confirms the current
architecture will support building it later without a rewrite, and lists
exactly what would need to be added.

## What already exists that a continuous-scan mode would reuse as-is

1. **A persistent live stream, decoupled from the capture action.**
   `UnifiedScanCapture.tsx`'s `startCameraStream()` opens a `MediaStream`
   and attaches it to a `<video>` element that stays live for the whole
   "tvs"/"webcam" mode session — `captureFrame()` is a separate function
   called on demand, not something that tears down and re-creates the
   stream. A continuous-mode loop would call the same `captureFrame()`
   programmatically instead of from a button `onClick` — no restructuring
   needed.

2. **An existing frame-sampling interval loop.** The TVS blur-check
   (`blurIntervalRef`, sampling every 400ms) already does exactly the kind
   of "periodically grab a downsampled frame and analyze it" work a
   presence/stability detector would need. A continuous-mode detector would
   extend this same loop with additional checks (see below), not create a
   parallel one.

3. **A placement guide with a known screen region.**
   `PlacementGuideOverlay.tsx` already renders a card/A4-shaped rectangle at
   a fixed position over the video. A presence detector needs exactly this
   — a known region to sample and compare against an "empty" baseline.

4. **Centralized camera lifecycle + error handling.**
   `cameraDiagnostics.ts` (added in this production-readiness pass) already
   classifies every camera failure mode and handles mid-session
   disconnects. A continuous-mode loop sits entirely on top of this — no
   new error-handling surface needed.

5. **A capture-only, module-agnostic result contract.**
   `ScanCaptureResult` (`{ file, mimeType, source, deviceLabel, filename }`)
   doesn't care whether capture was triggered by a click or a detector —
   `onCapture` fires the same way either way. Callers (Form F, Patients,
   etc.) need zero changes to consume an auto-triggered capture.

## What would need to be added (not built now)

1. **A stability/motion signal.** The current blur-score interval only
   measures sharpness of a single frame. Continuous mode needs to compare
   consecutive frames (e.g. simple frame-differencing on the same
   downsampled canvas already used for blur scoring) to detect "the card
   has stopped moving," not just "the current frame is sharp." A card
   sliding into frame will often be transiently sharp at some point mid-
   motion — sharpness alone isn't sufficient to trigger capture.

2. **A presence signal.** Something must detect "a document is actually in
   the guide region" vs. an empty desk. Cheapest approach: compare the
   guide-region crop's pixel variance/histogram against a captured "empty
   guide" baseline taken when the mode starts; a large deviation implies an
   object is present. This reuses the same canvas-sampling infrastructure
   the blur loop already has — extending it, not replacing it.

3. **A debounce/cooldown + confirmation window.** Combine stability +
   presence: require N consecutive samples (e.g. 3-4 samples over ~1.5s)
   to all pass before auto-triggering `captureFrame()`, plus a cooldown
   after a capture fires so the same card isn't re-captured repeatedly
   while still in frame.

4. **Auto-crop refinement.** `PlacementGuideOverlay`'s guide region is a
   fixed rectangle sized for a generic ID card/A4 sheet — it does not
   detect the document's actual edges. `IdCardScanPanel.tsx` (the existing
   crop/rotate editor, still used by the Form F Scanner-Bridge/import
   paths) already has auto-crop logic for post-capture refinement; a
   continuous-mode flow would likely route through the same crop step
   before finalizing, rather than trusting the guide rectangle as a pixel-
   perfect crop.

5. **A per-module toggle.** `UnifiedScanCaptureProps` would gain an
   optional `continuousMode?: boolean` (or similar) so modules can opt in
   individually — Form F's fixed-focus ID-card capture is the most obvious
   first candidate; Mobile Scan and Existing Scanner (bridge) tiles are
   inherently click-driven and wouldn't use this mode.

## Conclusion

No architectural changes are needed now to make continuous-scan mode
buildable later — it's an additive extension of the existing frame-
sampling loop, capture function, and result contract, not a rewrite. The
main new work when it's built will be the stability/presence detection
logic itself (items 1-2 above), which is genuinely new algorithmic work,
not a structural refactor of what exists today.
