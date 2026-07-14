// TVS PDS 8M preferred-device profile.
//
// IMPORTANT — hardware status: this integration has NOT been physically
// verified against a real TVS PDS 8M on the Care Diagnostics reception
// workstation. It is built on the documented spec (8MP, fixed-focus, USB
// 2.0, Windows-compatible) and the audit's conclusion that this class of
// device is virtually always exposed as a plain UVC (USB Video Class)
// webcam with no vendor WIA minidriver — so it is captured via the same
// getUserMedia() path already used for the generic Webcam option, NOT
// through scan-bridge's WIA/SANE adapters. Do not treat "Scan with TVS PDS
// 8M" as validated until it has actually been tested against the physical
// device.
//
// Because the exact `MediaDeviceInfo.label` string the TVS PDS 8M reports
// is unknown without physical testing (browsers only populate `label` with
// the OS-reported device name, which varies by driver), automatic
// label-based detection is a best-effort HINT only, never a hard
// dependency: the source of truth is always an explicit admin selection
// (via Scanner Settings), which manually binds whichever `deviceId` the
// admin confirms is the TVS after visually checking a live preview.

const PREFERRED_DEVICE_ID_KEY = "care_tvs_preferred_device_id";
const PREFERRED_DEVICE_LABEL_KEY = "care_tvs_preferred_device_label";

// Best-effort substrings that MIGHT appear in the TVS PDS 8M's reported
// label, based on common vendor-naming conventions for this device class.
// Never rely on this list alone — it exists only to pre-highlight a likely
// candidate in the Scanner Settings picker; the admin still confirms visually.
export const TVS_LABEL_HINTS = ["tvs", "pds", "pds 8m", "pds8m", "document camera"];

export function getPreferredTvsDeviceId(): string {
  try {
    return window.localStorage.getItem(PREFERRED_DEVICE_ID_KEY) ?? "";
  } catch {
    return "";
  }
}

export function getPreferredTvsDeviceLabel(): string {
  try {
    return window.localStorage.getItem(PREFERRED_DEVICE_LABEL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPreferredTvsDevice(deviceId: string, label: string): void {
  try {
    window.localStorage.setItem(PREFERRED_DEVICE_ID_KEY, deviceId);
    window.localStorage.setItem(PREFERRED_DEVICE_LABEL_KEY, label);
  } catch {
    // ignore
  }
}

export function clearPreferredTvsDevice(): void {
  try {
    window.localStorage.removeItem(PREFERRED_DEVICE_ID_KEY);
    window.localStorage.removeItem(PREFERRED_DEVICE_LABEL_KEY);
  } catch {
    // ignore
  }
}

export function guessTvsDevice(devices: MediaDeviceInfo[]): MediaDeviceInfo | null {
  const lower = (s: string) => s.toLowerCase();
  return devices.find((d) => TVS_LABEL_HINTS.some((hint) => lower(d.label).includes(hint))) ?? null;
}

/**
 * Blur score via Laplacian-variance approximation on a downsampled
 * grayscale frame — higher = sharper. This is a coarse, fast, client-side
 * heuristic (not a calibrated measurement), intended only to warn staff
 * BEFORE they accept a capture from a fixed-focus camera where the subject
 * may be positioned outside the focal distance. Thresholds are a starting
 * point and should be tuned once real captures from the actual device are
 * available to compare against.
 */
export function computeBlurScore(imageData: ImageData): number {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const laplacian =
        4 * gray[idx] -
        gray[idx - 1] -
        gray[idx + 1] -
        gray[idx - width] -
        gray[idx + width];
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

// Below this Laplacian-variance score, warn the user the frame looks too
// blurred for reliable OCR. Untuned against real hardware — treat as a
// starting point, adjust after reviewing real TVS PDS 8M captures.
export const BLUR_WARNING_THRESHOLD = 60;
