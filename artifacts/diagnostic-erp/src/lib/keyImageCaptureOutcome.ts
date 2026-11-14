/**
 * Audit item 14 — what a viewer capture says when it did not happen, or happened
 * somewhere the report cannot vouch for.
 *
 * Two doors raise a frozen key image from the viewer, and at `ba207aa62` each of
 * them could hold its tongue about the part that matters:
 *
 *   · The Frames "Capture key image" button
 *     (`EmbeddedWadoViewer.tsx:1086`) runs `void captureFramesKeyImage()`, and
 *     that function returns a bare `false` for six different reasons
 *     (`:621-625`, `:654-657`) — one of which is the pixels themselves refusing
 *     to be read (`framesViewportCapture.ts:96` throws when the `<img>` has no
 *     natural size, `:121` when the 2D context is gone, and `canvas.toBlob`
 *     throws `SecurityError` on a viewport whose image came from another
 *     origin, which is how this deployment serves DICOM from Orthanc). Click,
 *     no answer, no image. `console.warn` is the only witness.
 *   · The Key Images rail camera goes through the same function via the
 *     imperative handle (`:707-711`), and its caller then toasts
 *     "Switch to Frames with a loaded image" (`useOhifViewerBridge.ts:506-510`)
 *     for every non-success — including the case where the radiologist IS in
 *     Frames with a loaded image and the capture itself failed. Silence at one
 *     door, a wrong diagnosis at the other.
 *   · The Frames upload's own failure toast is `description: String(e)`
 *     (`workspace/ViewerColumn.tsx:595`). `uploadFrozenKeyImage`
 *     (`FrozenKeyImagesRail.tsx:695-705`) throws `Error(<the server's sentence>)`
 *     for a refusal and a `TypeError: Failed to fetch` for a connection that
 *     never got there, so `String(e)` prints `Error: Wrong study` /
 *     `TypeError: Failed to fetch` — the transport's vocabulary, no recovery, and
 *     it does not say the image was not saved. The sibling OHIF door announced the
 *     failure in good words (`:705-711` "Annotated capture was NOT saved… Check
 *     the connection and capture again") but threw the cause away with a bare
 *     `catch {`, and the bridge already prints a cause as
 *     `e instanceof Error ? e.message : String(e)` (`:407-411`) for its other door.
 *   · `POST /api/radiology/report-generator/key-images` answers 201 with
 *     `{ success, item, warningCode?, warning? }`
 *     (`routes/radiology-report-generator.ts:3125-3130`) when it could not tie
 *     the captured pixels to the study they claim. The helper returned only
 *     `data.item`, so both viewer doors toasted a flat success
 *     (`ViewerColumn.tsx:588-593`, `useOhifViewerBridge.ts:716`) and the
 *     unverified image sat in the report. The picker doors already surface
 *     exactly this through `keyImageAttachWarning` (`lib/pacsImagePicker.ts:215`)
 *     at `PacsImagePickerDialog.tsx:183` and `useOhifViewerBridge.ts:400`.
 *
 * Only the wording lives here. The verdicts come from the code that actually
 * knows — the capture primitive, the upload response, the store.
 */
import { keyImageAttachWarning, type KeyImageAttachResponse } from "@/lib/pacsImagePicker";

/** A Frames capture the viewer could not attempt or could not complete.
 *  "the button is disabled while a capture runs" is deliberately not here: the
 *  rail door returns before calling (`useOhifViewerBridge.ts:497`) and the
 *  viewer button is `disabled={!!captureBusy…}` (`EmbeddedWadoViewer.tsx:1085`),
 *  so no caller can reach that state and a branch for it would be a guard
 *  nobody fires. */
export type FramesCaptureBlock =
  /** No pixels on screen to read — the frame is still arriving or never came. */
  | "no-image"
  /** An image is displayed and reading it out of the canvas failed. */
  | "encode-failed";

export type CaptureNotice = { title: string; description: string };

/** What one Frames capture click actually did.
 *
 *  `"idle"` means nothing was attempted — the host has no capture door wired
 *  (`RadiologyCommandCenter` renders this viewer without `onCaptureViewport`),
 *  or a capture is already in flight. It is deliberately not a notice: the first
 *  is not this page's function, the second the button already says
 *  "Capturing…". Only `"no-image"` and `"encode-failed"` owe an answer. */
export type FramesCaptureOutcome = "captured" | "idle" | FramesCaptureBlock;

/**
 * The answer a capture click owes the radiologist when nothing was captured.
 *
 * `detail` is the browser's own words from the failed read. It is passed through
 * rather than swallowed because the two common causes need different recoveries
 * and only the message tells them apart: a canvas tainted by the cross-origin
 * image is fixed by capturing in OHIF, a 0-byte frame is fixed by reloading.
 */
export function describeFramesCaptureBlocked(block: FramesCaptureBlock, detail?: string): CaptureNotice {
  if (block === "no-image") {
    return {
      title: "Nothing to capture",
      description:
        "The Frames view has no image displayed to capture — wait for the series to load, or reload the frame. Nothing was saved.",
    };
  }
  const cause = detail?.trim();
  return {
    title: "Could not read the image pixels",
    description: cause
      ? `Nothing was saved — ${cause}. If it repeats, capture from OHIF instead.`
      : "Nothing was saved — the viewer could not read the frame. If it repeats, capture from OHIF instead.",
  };
}

/**
 * A failed key-image upload, in the ERP's words rather than the transport's.
 *
 * Never says the image is in the report: every branch of this ends in "Nothing
 * was saved", because the upload is a single POST that either inserted the row
 * or did not.
 */
export function describeKeyImageUploadFailure(e: unknown): string {
  // `String(undefined)` is the truthy word "undefined" and `String({})` is
  // "[object Object]" — either would otherwise be printed as if it were a cause.
  const raw = e instanceof Error ? e.message : e == null ? "" : String(e);
  const cause = raw.trim();
  if (!cause || cause === "undefined" || cause === "null" || cause === "[object Object]") {
    return "The key image could not be saved for a reason the viewer could not name. Nothing was saved — capture again, or attach the image from the PACS picker.";
  }
  if (/failed to fetch|networkerror|net::|load failed/i.test(cause)) {
    return "The upload never reached the server — check the connection, then capture again. Nothing was saved.";
  }
  // A 502 from nginx during a recreate answers with an HTML page, and
  // `res.json()` then throws before the upload helper ever sees a status.
  if (/unexpected token|json in|is not valid json/i.test(cause)) {
    return "The server answered, but not with anything the app could read — it may be restarting. Nothing was saved.";
  }
  return `${cause} — nothing was saved, so capture again.`;
}

/**
 * The server's own caution about an image it accepted.
 *
 * Returns null when the response carries no warning, so the caller keeps its
 * plain success toast. Reuses `keyImageAttachWarning`, the sentence the picker
 * doors already show for the same `warningCode`.
 */
export function keyImageUploadWarning(envelope: KeyImageAttachResponse | null | undefined): string | null {
  return keyImageAttachWarning(envelope);
}
