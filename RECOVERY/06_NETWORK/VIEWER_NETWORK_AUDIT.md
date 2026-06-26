# Viewer Network Audit (PACS Viewer Routing)

## 1. Existing Routing Flow
Currently, the PACS worklist pages and reporting workspaces launch viewers by importing `launchViewer` from `@/lib/viewerService`.
1. The user clicks on either the **OHIF** or **Weasis** button for a selected study.
2. The `launchViewer` function in `viewerService.ts` resolves the network profile:
   * It checks for manual overrides (`LAN`, `TAILSCALE`, or `PUBLIC`) stored in `localStorage` under `pacs_network_profile`.
   * If set to `"auto"`, it tests the availability of local endpoints (probes `/system` on both subnets) and falls back dynamically.
3. Once the profile is determined:
   * URLs (OHIF launch template, WADO URLs, and DICOMweb API URLs) are rewritten to match the profile host (LAN IP `192.168.1.137` or Tailscale IP `100.65.255.115`).
4. Pre-flight connectivity checks verify endpoint reachability (DICOMweb metadata, WADO, and Viewer base).
5. If successful, the browser opens the adapted URL in a new tab. If failed, a diagnostic modal overlay is displayed.

## 2. Existing Profile Selection Logic
* Persistent manual override in `localStorage` under `pacs_network_profile`.
* `localStorage` cache for detected network profile `pacs_detected_profile` (valid for 20 seconds) to avoid spamming network probes.

## 3. Existing Health Checks
* Pre-flight probes (HEAD/GET requests to `/tools/lookup`, DICOMweb metadata endpoint, WADO endpoint, and Viewer base endpoint) with a 1.5s timeout.
* Backend network health endpoint `/api/radiology/network/health` probes Orthanc HTTP, Orthanc DICOM port, OHIF base, Weasis WADO, Conquest, and Ollama AI.

## 4. Existing Fallback Logic
* If the primary viewer launch fails, the diagnostic overlay allows the user to force launch, switch the network profile, or fall back to the alternative viewer (e.g., OHIF if Weasis fails).
