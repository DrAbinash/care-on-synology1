# Care Diagnostics Document Scan Bridge

A small Node.js service that runs **locally on each workstation** to bridge
physical document scanners (flatbed/ADF) with the Care Diagnostics ERP.

The browser cannot talk to USB document scanners directly. This bridge:

1. Talks to the scanner driver on the workstation (WIA on Windows, SANE on Linux).
2. Captures the scanned image and returns it as a base64 JPEG/PNG.
3. The ERP frontend receives the image and sends it to the AI OCR endpoint
   (`/api/form-f/upload-id`) for Aadhaar/ID card data extraction.

> **`ERP_BASE_URL` (or `BRIDGE_ALLOW_ORIGINS`) is mandatory, not optional.**
> Without one of them set to your real ERP origin, CORS defaults *closed* —
> every browser request from the ERP will be silently blocked and the ERP UI
> will show the bridge as "Offline" even though the process is running and
> healthy. This is the #1 cause of "Local Workstation Scanner: Offline"
> reports. Every example below sets `ERP_BASE_URL` for this reason — do not
> omit it, even while testing with the mock adapter.

## One-click install (Windows reception PC) ⭐

For a Windows reception workstation, use the bundled installer instead of the
manual steps below:

1. Install **Node.js LTS** from <https://nodejs.org> (one time).
2. Copy this whole `scan-bridge` folder onto the reception PC.
3. Right-click **`install-windows.ps1`** → **Run with PowerShell**.
4. When asked, enter the ERP address (e.g. `https://caredeoghar.com`) and pick
   the scanner type (**WIA** for any scanner in *Windows Fax and Scan*, or
   **folder-watch** to import from a folder your scanner software writes to).

The installer runs `npm install`, writes `start-scan-bridge.cmd`, registers a
per-user **auto-start task** (`CareScanBridge`, runs at each logon — no admin
needed), starts the bridge, and checks `http://127.0.0.1:8766/health`. When it
succeeds, Form F's **Existing Scanner** tab shows **Online**. There's a matching
**"Set up scanner"** shortcut in Form F's ID-capture panel that shows these
same steps and the live status.

To reconfigure later, just run `install-windows.ps1` again. To start it once by
hand, double-click `start-scan-bridge.cmd`.

## Quick start (mock adapter — no hardware needed)

```bash
cd scan-bridge
npm install
ERP_BASE_URL=https://erp.yourdomain.com BRIDGE_SCAN_VENDOR=mock npm start
```

For local development against the ERP dev server, use
`ERP_BASE_URL=http://localhost:5173` (or whatever port the diagnostic-erp
dev server actually runs on) instead.

Then in the ERP on the workstation, click **Scanner** on the Form F ID card
section. The browser auto-detects the bridge at `http://127.0.0.1:8766`.

## Quick start (WIA — Windows with any WIA scanner)

```bash
cd scan-bridge
npm install
ERP_BASE_URL=https://erp.yourdomain.com BRIDGE_SCAN_VENDOR=wia npm start
```

## Quick start (folder-watch — any scanner that saves to disk)

If your scanner comes with its own software that saves files to a folder:

```bash
# Configure the scanner software to save scans to a folder
cd scan-bridge
npm install
ERP_BASE_URL=https://erp.yourdomain.com \
  BRIDGE_SCAN_VENDOR=folder-watch \
  SCAN_WATCH_FOLDER="C:\\Scans" \
  npm start
```

Clicking **Scanner** in the ERP returns the newest file from that folder.
**The same `SCAN_WATCH_FOLDER` value must be used for every run** — the bridge's
built-in `/latest-scan` endpoint and the `folder-watch` adapter's own `/scan`
endpoint both read this one env var, so leaving it unset for one but not the
other (or changing it between runs) makes "Import Latest Scan" look in the
wrong place.

## Optional: workstation-pairing secret

Once every reception workstation's bridge is upgraded and configured with
`ERP_BASE_URL`/`BRIDGE_ALLOW_ORIGINS`, you can additionally require a shared
secret on every request (except `/health`, which always stays open so the
ERP's "is the bridge running" check keeps working):

```bash
ERP_BRIDGE_SECRET=some-long-random-string \
  BRIDGE_REQUIRE_AUTH=true \
  ERP_BASE_URL=https://erp.yourdomain.com \
  BRIDGE_SCAN_VENDOR=wia \
  npm start
```

Set the same value in the ERP's Admin → Scanner Settings page for this
workstation. Leave `BRIDGE_REQUIRE_AUTH` unset (default `false`) until every
workstation has the secret configured — flipping it on before that will lock
out any bridge that hasn't been updated yet.

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
| `ERP_BRIDGE_SECRET`    | _(none)_                       | Shared secret checked via the `X-Bridge-Secret` header when `BRIDGE_REQUIRE_AUTH=true`.          |
| `BRIDGE_REQUIRE_AUTH`  | `false`                        | Set `true` to require `ERP_BRIDGE_SECRET` on every endpoint except `/health`.                     |

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
