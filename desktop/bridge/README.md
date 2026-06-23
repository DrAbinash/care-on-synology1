# Care Diagnostics Fingerprint Bridge

A small Node.js service that runs **locally on each workstation** to bridge
USB fingerprint scanners (ZKTeco, Mantra MFS100, Morpho/IDEMIA, etc.) with
the Care Diagnostics ERP.

The browser cannot talk to USB biometric devices directly. This bridge:

1. Talks to the vendor SDK / driver on the workstation.
2. Captures fingerprints and stores templates on the central ERP.
3. Matches fresh prints against enrolled templates **locally** (so the raw
   biometric data never travels over your LAN).
4. Reports the matched user/staff to the ERP for attendance or login.

## Quick start (mock adapter — no hardware needed)

```bash
cd bridge-service
npm install
ERP_BASE_URL=http://localhost:8080 npm start
```

Then on the workstation, open the ERP in Chrome/Edge. The Staff page and the
Login page will detect the bridge automatically at `http://127.0.0.1:8765`.

To pretend you have multiple "fingers" while testing, restart with:

```bash
BRIDGE_MOCK_FINGER=alice ERP_BASE_URL=http://localhost:8080 npm start
```

…then enroll Alice. Switch to `BRIDGE_MOCK_FINGER=bob` to enroll Bob, etc.

## Configuration (env vars)

| Variable               | Default                        | Description                                                                                                   |
|------------------------|--------------------------------|---------------------------------------------------------------------------------------------------------------|
| `BRIDGE_PORT`          | `8765`                         | Port the bridge listens on (localhost only).                                                                  |
| `BRIDGE_VENDOR`        | `mock`                         | `mock` \| `zkteco` \| `mantra` \| `morpho`                                                                    |
| `ERP_BASE_URL`         | _(required)_                   | Where the ERP API lives, e.g. `https://erp.local`                                                             |
| `ERP_BRIDGE_SECRET`    | _(required)_                   | Must match `FINGERPRINT_BRIDGE_SECRET` on server. The server rejects requests when this is not set.           |
| `BRIDGE_ALLOW_ORIGINS` | ERP origin from `ERP_BASE_URL` | Comma-separated CORS allowlist. Defaults to the origin of `ERP_BASE_URL`. Set explicitly to override. Do NOT use `*` — this would let any website on the workstation invoke biometric endpoints. |

## Endpoints (consumed by the ERP frontend)

```
GET  /health                       device + ERP status
POST /capture                      live read for enrollment UI
POST /enroll          { scope, scopeId, fingerName }
POST /identify        { scope }                  → { templateId, scopeId, score }
POST /staff-punch     { action: "in"|"out" }      → ERP attendance row
POST /user-login                                  → ERP session token
```

## Plugging in a real scanner

Each vendor adapter lives in `src/adapters/<vendor>.js` and must export the
same shape: `status()`, `capture()`, `match(a, b)`, and a `threshold`.

The included files for ZKTeco, Mantra, and Morpho contain step-by-step
comments that point to the exact SDK calls needed. Install the vendor SDK on
the workstation, fill in the function bodies, and restart the bridge with
`BRIDGE_VENDOR=zkteco` (or whichever vendor).

## Security notes

- The bridge binds to `127.0.0.1` only; nothing on the network can talk to it
  directly.
- Raw fingerprint images never leave the workstation — only vendor-specific
  templates do. Templates are not reversible to fingerprints.
- `ERP_BRIDGE_SECRET` **must** be set. The Windows launcher generates and
  persists a random secret automatically (`data/.bridge-secret`). Without it,
  the ERP server rejects all bridge requests. Set the same value in
  `ERP_BRIDGE_SECRET` so the bridge service can authenticate to the server.
- `BRIDGE_ALLOW_ORIGINS` must be set to the ERP web origin (e.g.
  `https://erp.yourdomain.com`). The default already derives this from
  `ERP_BASE_URL`. Never set it to `*` — any website the user visits could
  otherwise invoke biometric endpoints via the browser.
- The ERP sees only matched template IDs; the live image stays in RAM in the
  bridge process for the duration of one capture.
