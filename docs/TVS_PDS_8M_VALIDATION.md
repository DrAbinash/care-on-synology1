# TVS PDS 8M — Hardware Validation Status

**Status: Implemented but awaiting hardware validation.**

Do not represent the TVS PDS 8M capture path as fully supported until it has
been tested end-to-end on the actual Care Diagnostics reception Windows
workstation, with the physical device. Everything in this document below
the line is **expected behavior derived from the device's published spec
and standard browser/OS behavior — not measurements taken from the real
device.** Where a real test would be needed to confirm a number, that is
stated explicitly.

---

## What "implemented" means today

- `artifacts/diagnostic-erp/src/components/UnifiedScanCapture.tsx` — a
  "Scan with TVS PDS 8M" tile appears once an admin has bound a specific
  camera `deviceId` via Scanner Settings (`/settings/scanner`). It opens a
  `getUserMedia()` stream against that device, with a placement-guide
  overlay and a live blur-score indicator.
- `artifacts/diagnostic-erp/src/lib/tvsDeviceProfile.ts` — device binding,
  best-effort label matching (a hint only, never authoritative), and the
  blur-score heuristic.
- `artifacts/diagnostic-erp/src/lib/cameraDiagnostics.ts` — camera error
  classification (see the diagnostics section below).

## Expected device label(s)

Browsers only expose `MediaDeviceInfo.label` as whatever string the
OS/driver reports — there is no fixed, guaranteed string. Based on common
Windows UVC-camera naming conventions, the label is **expected** to contain
one of: `"TVS"`, `"PDS"`, `"PDS 8M"`, or a generic `"USB Video Device"` /
`"USB Camera"` if Windows falls back to its built-in UVC class driver
without a TVS-specific driver installed. `tvsDeviceProfile.ts`'s
`TVS_LABEL_HINTS` array checks for the first three; if the real label turns
out to be a generic fallback string, label-based auto-suggestion in Scanner
Settings won't pre-select it — the admin still binds it manually by visual
confirmation via live preview, which works regardless of the label text.
**Needs a real test** to record the actual label string.

## Browser compatibility

The capture path uses only standard `navigator.mediaDevices.getUserMedia()`
and `enumerateDevices()` — no vendor-specific APIs. Expected to work on:
- **Chrome / Edge (Chromium)** — primary target; this is what
  `docker/nginx.conf`'s CSP and the rest of the ERP assume reception uses.
- **Firefox** — should work (same standard APIs) but untested.
- Safari is not a realistic target for a Windows reception workstation and
  has not been considered.

## Windows compatibility

The TVS PDS 8M is expected to enumerate as a standard USB Video Class
(UVC) device, which Windows 10/11 supports natively via its in-box UVC
class driver — no vendor driver should be required for the browser to see
it (this is the same reasoning documented in `tvsDeviceProfile.ts` for why
it's captured via `getUserMedia()` rather than WIA). **Needs a real test**
to confirm Windows doesn't require a vendor driver for full-resolution/
full-framerate operation vs. a lower-capability generic-UVC fallback mode.

## Chrome permission requirements

Standard camera permission prompt applies:
- First use on a given origin prompts the user to allow/deny camera access.
- Once granted, the permission persists for that origin (visible/revocable
  under Chrome's site settings, padlock icon → Site settings → Camera).
- If Chrome's OS-level camera permission (Windows Settings → Privacy →
  Camera) is off, `getUserMedia()` also fails — this is classified as
  `permission-denied` by `cameraDiagnostics.ts`, same as an in-browser deny,
  since the browser cannot distinguish the two at the JS API level.
- No enterprise policy configuration has been assumed; if reception
  workstations are managed via Group Policy, camera access may need an
  explicit allow-list entry for the ERP's origin — **needs a real test**
  on the actual managed workstation.

## HTTPS requirements

`getUserMedia()` is only available in a "secure context" — HTTPS, or
`http://localhost`/`http://127.0.0.1`. Plain HTTP over LAN (e.g.
`http://192.168.x.x`) will NOT work; `navigator.mediaDevices` is simply
`undefined` in that case, which `cameraDiagnostics.ts` classifies as
`https-required` and checks for explicitly before attempting a stream,
rather than only discovering it from `getUserMedia()`'s own failure.
Per the earlier Scanner Bridge audit, the production deployment is served
over HTTPS via nginx (`docker/nginx.conf`), so this should not be an issue
in production — but any ad hoc "let's just try it over plain HTTP on the
LAN" testing will hit this and should not be mistaken for a device fault.

## Maximum tested resolution

**Not tested.** The TVS PDS 8M is spec'd at 8MP (≈3264×2448). The current
code does not request a specific resolution — `startCameraStream()` uses
`{ deviceId: { exact } }` with no `width`/`height`/`frameRate` constraints,
so the browser/OS picks a default (commonly 640×480 or the device's
lowest advertised mode for many UVC cameras unless a higher resolution is
explicitly requested). **This likely means the current implementation is
NOT capturing at the device's full 8MP** — it should request an explicit
high-resolution constraint (e.g. `width: { ideal: 3264 }, height: { ideal: 2448 }`)
once real-device testing confirms what resolutions the device actually
advertises via `MediaStreamTrack.getCapabilities()`. This is a known,
concrete follow-up, not yet done.

## Expected FPS

**Not tested.** Fixed-focus UVC document cameras in this class typically
advertise 15–30 FPS at lower resolutions, often dropping to a lower FPS
cap (e.g. 5–10 FPS) at their maximum resolution due to USB 2.0 bandwidth
limits (the TVS PDS 8M is spec'd as USB 2.0, not 3.0) — this is a
reasonable expectation based on typical UVC device behavior, not a
guarantee. The live blur-sampling loop in `UnifiedScanCapture.tsx` samples
every 400ms regardless of the stream's actual FPS, so it will function
correctly across a wide FPS range without needing to know the true number
in advance — but perceived preview smoothness for staff has not been
evaluated.

## Fallback behavior if device is unavailable

- If no deviceId has been bound in Scanner Settings, the "Scan with TVS PDS
  8M" tile is not shown at all — reception is not confronted with a
  broken/non-functional option (see `UnifiedScanCapture.tsx`'s
  `tvsDeviceId ? ... : <configure hint>` branch).
- If a device WAS bound but is no longer connected (unplugged since
  binding), `getUserMedia({ deviceId: { exact } })` fails with
  `OverconstrainedError`, classified as `state: "unsupported"` by
  `cameraDiagnostics.ts`, with a message pointing the admin back to
  Scanner Settings to re-bind.
- If the device disconnects **mid-session** (USB unplugged while the
  preview is open), `watchForDeviceDisconnect()` listens for the
  `MediaStreamTrack`'s `ended` event and surfaces a `device-disconnected`
  message + toast, then returns to the option-select screen — the stream
  does not silently freeze with no explanation.
- In every failure case, reception can still fall back to: Existing
  Scanner (Canon/bridge), Upload Image or PDF, Mobile Scan, or the generic
  Webcam option — the TVS path failing never blocks document capture
  entirely.

## Camera diagnostics (replacing generic "No Camera")

`artifacts/diagnostic-erp/src/lib/cameraDiagnostics.ts` classifies every
`getUserMedia()` failure into one of:

| State | Trigger | Message shown |
|---|---|---|
| `no-camera` | `NotFoundError` / `DevicesNotFoundError` | "No camera detected on this workstation..." |
| `permission-denied` | `NotAllowedError` / `PermissionDeniedError` / `SecurityError` | "Camera access was denied..." |
| `https-required` | checked before calling `getUserMedia()` — insecure context | "Camera access requires HTTPS..." |
| `camera-in-use` | `NotReadableError` / `TrackStartError` | "This camera is already in use by another application..." |
| `device-disconnected` | `AbortError`, or the stream's `ended` event mid-session | "The camera was disconnected..." |
| `unsupported` | `OverconstrainedError` / `ConstraintNotSatisfiedError` | "This camera doesn't support the requested settings..." |
| `unknown` | anything else | generic message, raw browser detail preserved, never swallowed |

This is wired into `UnifiedScanCapture.tsx` (both the generic Webcam and
TVS PDS 8M tiles) and `ScannerSettings.tsx`'s device-binding preview.

## What still needs a real device

1. Confirm the actual `MediaDeviceInfo.label` string.
2. Confirm actual supported resolutions/framerates via
   `getCapabilities()`, then set an explicit high-resolution constraint.
3. Confirm Windows doesn't require a vendor driver.
4. Confirm the blur-score threshold (`BLUR_WARNING_THRESHOLD = 60` in
   `tvsDeviceProfile.ts`) is meaningful for this device's actual optics —
   it was chosen as a reasonable starting point, not calibrated against
   real captures.
5. Confirm the ID-card and A4 placement-guide framing in
   `PlacementGuideOverlay.tsx` actually matches the device's real field of
   view at its fixed focus distance.
