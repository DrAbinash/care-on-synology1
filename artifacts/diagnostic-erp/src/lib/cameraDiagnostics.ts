/**
 * Shared camera-error classification for every getUserMedia() call site
 * (OcrCapturePanel's Webcam, UnifiedScanCapture's Webcam + TVS PDS 8M).
 *
 * Replaces the previous generic "No Camera" message with a specific,
 * actionable reason — getUserMedia() rejects with a DOMException whose
 * `.name` reliably distinguishes these cases across current Chrome/Edge
 * (the browsers used on Windows reception workstations); the mapping below
 * is standard MediaStream API behavior, not TVS-PDS-8M-specific guesswork.
 */
export type CameraDiagnosticState =
  | "no-camera"          // NotFoundError / DevicesNotFoundError — no video input device present
  | "permission-denied"  // NotAllowedError / PermissionDeniedError — user or OS blocked camera access
  | "https-required"     // insecure context — checked BEFORE calling getUserMedia, not a DOMException
  | "camera-in-use"      // NotReadableError / TrackStartError — device exists but OS/another app has it locked
  | "device-disconnected" // device was granted then unplugged mid-session (track 'ended' event, or a
                          // stale deviceId constraint that no longer resolves to a connected device)
  | "unsupported"        // OverconstrainedError / ConstraintNotSatisfiedError — requested constraints
                          // (e.g. a specific deviceId) can't be satisfied by any currently connected device
  | "unknown";            // anything else — still surfaced with the raw browser message, never swallowed

export interface CameraDiagnostic {
  state: CameraDiagnosticState;
  message: string;
  /** Raw browser-provided detail, shown in Scanner Settings / advanced diagnostics, not to reception staff directly. */
  detail: string;
}

const MESSAGES: Record<CameraDiagnosticState, string> = {
  "no-camera": "No camera detected on this workstation. Plug in a camera/scanner or use Upload instead.",
  "permission-denied": "Camera access was denied. Click the camera icon in the address bar and allow access, then try again.",
  "https-required": "Camera access requires HTTPS (or localhost). This page is loaded over plain HTTP — use the HTTPS address, or use Upload instead.",
  "camera-in-use": "This camera is already in use by another application or browser tab. Close it there and try again.",
  "device-disconnected": "The camera was disconnected. Reconnect it and try again, or pick a different device.",
  "unsupported": "This camera doesn't support the requested settings, or the previously selected device is no longer connected. Re-select it in Scanner Settings.",
  "unknown": "Camera error. Try again, or use Upload instead.",
};

/** Call BEFORE attempting getUserMedia() — a non-secure context never throws a normal DOMException, it just makes navigator.mediaDevices undefined. */
export function isSecureCameraContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices;
}

export function classifyCameraError(err: unknown): CameraDiagnostic {
  if (!isSecureCameraContext()) {
    return { state: "https-required", message: MESSAGES["https-required"], detail: "window.isSecureContext is false or navigator.mediaDevices is unavailable" };
  }

  const name = err instanceof DOMException ? err.name : (err as { name?: string } | undefined)?.name;
  const rawMessage = err instanceof Error ? err.message : String(err);

  switch (name) {
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { state: "no-camera", message: MESSAGES["no-camera"], detail: rawMessage };
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return { state: "permission-denied", message: MESSAGES["permission-denied"], detail: rawMessage };
    case "NotReadableError":
    case "TrackStartError":
      return { state: "camera-in-use", message: MESSAGES["camera-in-use"], detail: rawMessage };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return { state: "unsupported", message: MESSAGES["unsupported"], detail: rawMessage };
    case "AbortError":
      return { state: "device-disconnected", message: MESSAGES["device-disconnected"], detail: rawMessage };
    default:
      return { state: "unknown", message: MESSAGES["unknown"], detail: rawMessage };
  }
}

/**
 * Attach a listener that fires when the active camera track ends unexpectedly
 * (e.g. USB unplug mid-session) — getUserMedia() itself does not reject in
 * this case, the stream just silently stops delivering frames, which reads
 * to a user as a frozen/blank preview unless something calls this out.
 */
export function watchForDeviceDisconnect(stream: MediaStream, onDisconnect: (diag: CameraDiagnostic) => void): () => void {
  const track = stream.getVideoTracks()[0];
  if (!track) return () => {};
  const handler = () => {
    onDisconnect({ state: "device-disconnected", message: MESSAGES["device-disconnected"], detail: "MediaStreamTrack 'ended' event fired" });
  };
  track.addEventListener("ended", handler);
  return () => track.removeEventListener("ended", handler);
}
