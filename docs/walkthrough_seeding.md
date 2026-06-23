# Walkthrough: Implementing High-Value Improvements for Synology LAN Deployment

We have successfully configured the database and network layers to support running the ERP locally on the Synology NAS within the same local network as the medical modalities and PACS.

---

## 1. Seeding Synology PACS Settings
The `pacs_settings` table in the Synology database `diagnostic_erp` (running on `100.65.255.115:5400`) was empty. We seeded default parameters so that the browser client can locate and launch local viewer links:
* **ohif_base_url**: `http://172.16.1.139:3000`
* **dicom_web_base_url**: `http://172.16.1.139:8042/dicom-web`
* **wado_uri_base_url**: `http://172.16.1.139:8042/wado`
* **weasis_manifest_url_template**: `weasis://$dicom:get -w "http://172.16.1.139:8042/weasis?studyUID={studyInstanceUID}"`
* **PACS Node Details**: AET `ORTHANC2`, IP `172.16.1.139`, Port `5680`

---

## 2. Seeding Synology AI Provider Configuration
We seeded default settings in the `ai_provider_settings` table of the Synology database:
* **__global__** and **gemini** providers are marked as `is_enabled = true`.
* The system defaults to Google Gemini using the Replit AI Generative proxy credentials.

---

## 3. Disabling Private IP Block for local LAN
* **Background**: The SSRF security guard blocks all RFC-1918 private IPv4/IPv6 addresses (`172.16.x.x`, `192.168.x.x`, `10.x.x.x`). However, because the Synology NAS resides in the same LAN as the modalities, it needs to contact private IP endpoints.
* **Implementation**:
  * Modified the `isBlockedHost` function in [providers.ts](file:///c:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/lib/pacs/providers.ts#L209-L221) to bypass checks when `process.env.ALLOW_PRIVATE_IPS` is configured.
  * Added `ALLOW_PRIVATE_IPS=true` to the project's [.env](file:///c:/Users/abina/caredeoghar--antigravity/.env#L96) and [env](file:///c:/Users/abina/caredeoghar--antigravity/env#L104) configurations.

---

## 4. Verification Check
* Ran full compilation check:
  ```bash
  pnpm run typecheck
  ```
  **Result**: Successfully compiled with zero errors.
