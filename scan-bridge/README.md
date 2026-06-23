# Care Diagnostics Document Scan Bridge

A small Node.js service that runs **locally on each workstation** to bridge
physical document scanners (flatbed/ADF) with the Care Diagnostics ERP.

The browser cannot talk to USB document scanners directly. This bridge:

1. Talks to the scanner driver on the workstation (WIA on Windows, SANE on Linux).
2. Captures the scanned image and returns it as a base64 JPEG/PNG.
3. The ERP frontend receives the image and sends it to the AI OCR endpoint
   (`/api/form-f/upload-id`) for Aadhaar/ID card data extraction.

## Quick start (mock adapter — no hardware needed)

```bash
cd scan-bridge
npm install
BRIDGE_SCAN_VENDOR=mock npm start
```

Then in the ERP on the workstation, click **Scanner** on the Form F ID card
section. The browser auto-detects the bridge at `http://127.0.0.1:8766`.

## Quick start (WIA — Windows with any WIA scanner)

```bash
cd scan-bridge
npm install
ERP_BASE_URL=https://your-erp.example.com BRIDGE_SCAN_VENDOR=wia npm start
```

## Quick start (folder-watch — any scanner that saves to disk)

If your scanner comes with its own software that saves files to a folder:

```bash
# Configure the scanner software to save scans to a folder
cd scan-bridge
npm install
ERP_BASE_URL=https://your-erp.example.com \
  BRIDGE_SCAN_VENDOR=folder-watch \
  SCAN_WATCH_FOLDER="C:\\Scans" \
  npm start
```

Clicking **Scanner** in the ERP returns the newest file from that folder.

## Configuration (env vars)

| Variable               | Default                        | Description                                                                                       |
|------------------------|--------------------------------|---------------------------------------------------------------------------------------------------|
| `BRIDGE_SCAN_PORT`     | `8766`                         | Port the scan bridge listens on (localhost only).                                                 |
| `BRIDGE_SCAN_VENDOR`   | `mock`                         | `mock` \| `wia` \| `sane` \| `folder-watch`                                                      |
| `ERP_BASE_URL`         | _(optional)_                   | ERP URL; derived CORS allowlist. Set to your ERP origin.                                         |
| `BRIDGE_ALLOW_ORIGINS` | ERP origin from `ERP_BASE_URL` | Comma-separated CORS allowlist. Do NOT use `*`.                                                  |
| `SCAN_WATCH_FOLDER`    | `os.tmpdir() + "/care-scans"`  | (folder-watch only) Folder to watch for new scan files.                                          |
| `WIA_DEVICE_INDEX`     | `1`                            | 1-based index if multiple WIA scanners are connected. Call /devices to see the list.             |
| `WIA_DPI`              | `300`                          | Scan resolution (DPI) for WIA.                                                                   |
| `SANE_DPI`             | `300`                          | Scan resolution (DPI) for SANE.                                                                  |

## Endpoints (consumed by the ERP frontend)

```
GET  /health    → { ok: true, deviceConnected: true, vendor: "wia", ... }
GET  /devices   → { ok: true, devices: [{ index, name }] }
POST /scan      → { ok: true, imageBase64: "...", mimeType: "image/jpeg" }
POST /latest-scan → { ok: true, imageBase64: "...", filename: "..." }
```

## Plugging in a real scanner

### Windows (WIA)

WIA is built into Windows. Any scanner that shows up in **Windows Fax and Scan**
will work. The bridge runs a PowerShell COM script that triggers a scan via WIA.

**Requirements:**
- Windows 10/11
- Scanner driver installed (check Windows Fax and Scan)
- PowerShell with COM access (default on Windows)

**Troubleshooting:**
- **"No WIA devices found"**: Install the scanner driver from the manufacturer.
- **"Access is denied"**: The bridge uses `-ExecutionPolicy Bypass`; ensure PowerShell is not blocked by group policy.
- **Wrong scanner selected**: Set `WIA_DEVICE_INDEX=2` (or 3, etc.).

### Linux / macOS (SANE)

```bash
# Debian/Ubuntu
sudo apt-get install sane-backends

# Verify scanner is detected
scanimage -L
```

Then run with `BRIDGE_SCAN_VENDOR=sane`.

**Troubleshooting:**
- **"no SANE devices found"**: Check USB connection; may need `sudo usermod -aG scanner $USER`.

### Folder-watch (any OS, any scanner)

If your scanner software can't be scripted, use `folder-watch`. Set the
scanner’s output folder to `SCAN_WATCH_FOLDER`. The bridge returns the newest
file when the ERP frontend requests a scan.

## Security notes

- The bridge binds to `127.0.0.1` only; nothing on the network can talk to it directly.
- CORS is restricted to the ERP origin. Do NOT set `BRIDGE_ALLOW_ORIGINS=*`.
- Images stay on the workstation — the ERP frontend sends them to the OCR
  endpoint, just like a manual upload.
