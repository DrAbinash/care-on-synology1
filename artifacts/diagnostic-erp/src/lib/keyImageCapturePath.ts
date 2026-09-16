/**
 * Decide which capture path the Key Images rail camera should take.
 * Pure helper — no DOM / React.
 */
export type KeyImageCapturePath = "frames" | "ohif" | "unavailable";

export function resolveKeyImageCapturePath(opts: {
  viewMode: "FRAMES" | "OHIF" | string | null | undefined;
  framesReady: boolean;
  ohifCaptureAvailable: boolean;
  disabled?: boolean;
}): KeyImageCapturePath {
  if (opts.disabled) return "unavailable";
  if (opts.viewMode === "FRAMES" && opts.framesReady) return "frames";
  if (opts.viewMode === "OHIF" && opts.ohifCaptureAvailable) return "ohif";
  return "unavailable";
}
