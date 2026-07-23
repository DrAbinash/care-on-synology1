# Fingerprint / Biometric Attendance Integration

**Status:** Existing implementation documented; USB path dormant · **Date:** 2026-07-23

> The hospital is **not** currently using USB fingerprint attendance but intends to later.
> This document records exactly what already exists (so nothing is discarded), what remains
> incomplete, and how to safely configure, test, enable, and roll back a real device.

---

## 1. Three mechanisms (do not conflate)

| # | Mechanism | Table | `staff_attendance.source` | State |
|---|---|---|---|---|
| A | **WebAuthn platform authenticator** (Windows Hello / Touch ID) for **staff attendance** | `staff_biometric_credentials` | `"fingerprint"` | **Live & wired** (UI in `Staff.tsx`) |
| B | **WebAuthn security key / passkey** for **ERP login** (YubiKey) | `webauthn_credentials` | — (login only) | **Live & wired** (`Settings.tsx`) |
| C | **USB fingerprint scanner bridge** (ZKTeco / Mantra MFS100 / Morpho) | `bridge_fingerprint_templates` | `"usb-bridge"` | **Backend-complete, DORMANT** |

The rest of this document concerns **C** — the dormant USB path. Note the table name
`staff_biometric_credentials` is WebAuthn (A), **not** the USB scanner; the USB scanner's only
table is `bridge_fingerprint_templates`.

---

## 2. What already exists (found in the repo)

### 2.1 Server — `artifacts/api-server/src/routes/bridge.ts` (mounted `/api/bridge`, ~519 lines)
Fully implemented, production-quality, with a challenge-token security model. Endpoints:
`GET /info`; challenge issuers `POST /capture-challenge | /enroll-challenge | /punch-challenge | /login-challenge`;
`POST /validate-capture-token`; `POST /enroll` (writes `bridge_fingerprint_templates`);
`GET /templates`, `GET /templates/list`, `DELETE /templates/:id`;
`POST /staff-punch` (writes `staff_attendance`, source `"usb-bridge"`, smart in/out toggle, txn);
`POST /user-login` (creates `user_sessions`, `loginMethod:"fingerprint"`, 8h);
`GET /session/verify`, `POST /session/logout`.

- **Auth:** `requireBridgeAuth` checks header `x-bridge-secret` against env `FINGERPRINT_BRIDGE_SECRET`.
  **When the secret is unset, every authenticated bridge route returns HTTP 503** — the service is
  never left open. This is the single on/off gate.
- **Challenge tokens:** all sensitive operations require a short-lived (2–5 min), single-use, in-memory
  token obtained from the ERP first. Enroll/punch/login each carry their own `x-*-token` header.
- **Privacy invariant (from the file header):** *"The server only stores templates and records
  identification results — never the raw biometric data."* Matching happens locally on the workstation.

### 2.2 Local bridge — `bridge-service/` (Node ESM; `127.0.0.1:8765`)
Runs on each workstation next to the scanner (browsers cannot talk to USB biometrics). Files:
`src/index.js` and `src/adapters/{index,mock,zkteco,mantra,morpho}.js`. Deps: `express`, `cors` only —
**no vendor SDK is installed**.

- Binds localhost only; **hard-exits** if `ERP_BRIDGE_SECRET` is unset or `BRIDGE_ALLOW_ORIGINS="*"`.
- Endpoints (called by the ERP browser): `GET /health`, `POST /capture | /enroll | /identify | /staff-punch | /user-login`.
- Talks to the ERP via header `x-bridge-secret: ERP_BRIDGE_SECRET` (must equal the server's
  `FINGERPRINT_BRIDGE_SECRET`). **Push/on-demand, not polling.**

**Adapter contract (verbatim, `src/adapters/index.js`):**
```js
// Each adapter must export: { status(), capture(), match(a, b), threshold }
```

| Adapter | `threshold` | Completeness |
|---|---|---|
| `mock` | 80 | ✅ Fully functional (demo). `capture()` = `sha256("mock:"+FINGER)`; `match(a,b)` = `a===b?100:0`. |
| `mantra` (MFS100) | 60 | ⚠️ Partial — `status()`/`capture()` make real HTTP calls to the RD service (`MANTRA_RD_BASE`, default `http://127.0.0.1:11100`); **`match()` throws** (no ISO-19794-2 matcher). |
| `zkteco` | 75 | ❌ Stub — SDK calls commented out; `capture()` throws, `match()` returns 0. |
| `morpho` | 70 | ❌ Stub — one-liners. |

### 2.3 Data model
`bridge_fingerprint_templates` (`lib/db/src/schema/staff.ts`): `scope` (`'staff'|'user'`), `scopeId`,
`vendor` (`mock|zkteco|mantra|morpho|generic`), `fingerName`, `template` (base64 vendor blob), `quality`,
`enrolledAt`, `lastUsedAt`. Employee mapping is by `{scope, scopeId}` → resolved from a matched
`templateId`. **Names are never used as biometric identifiers.**

---

## 3. Stabilization status

**Done (this increment):**
- ✅ **Raw-punch preservation + idempotency.** Every bridge punch now writes an immutable
  `attendance_raw_punches` row (`UNIQUE(dedupe_key)` → re-sends are no-ops) before the per-day
  `staff_attendance` summary is updated. Logic lives in the tested ingestion service
  `artifacts/api-server/src/lib/attendance/attendanceIngestion.ts` (`recordStaffPunch`).
- ✅ **Import-run ledger** table `attendance_import_runs` (for future CSV/device batch imports).
- ✅ **Audit** on sensitive admin actions — `/enroll` and `DELETE /templates/:id` write hash-chained
  `audit_logs` rows (routine high-volume punches are captured by the immutable raw log instead).
- ✅ **Shadow-mode gate.** `/staff-punch` now requires `ff_hr_biometric_attendance` **and** the bridge
  secret — implemented but dormant until an admin enables the flag.
- ✅ **Adapter contract validation.** `bridge-service` `loadAdapter()` now fails fast (clear message) on a
  half-implemented vendor adapter; a runnable `mock.test.js` covers the contract + mock behaviour.
- ✅ **Source abstraction.** Every source maps through `attendanceSource.ts`; the bridge is the
  `usb_bridge` provider (source string `"usb-bridge"`), not a rewrite.

**Still open (owner decisions / later phases):**
1. **No real vendor adapter** — only `mock` fully works (per owner: no vendor code until hardware is
   finalized; then implement one adapter's `capture()`+`match()`, Mantra closest). 
2. **Frontend not wired** — `artifacts/diagnostic-erp/src/hooks/useBridge.ts` exists but is imported by
   zero pages; the enrollment/punch UI is the next increment (gated by `ff_hr_biometric_attendance`).
3. **Broken duplicate** — `desktop/bridge/` is missing `src/adapters/` and crashes on startup; unreferenced
   by any build/deploy. Recommend consolidating to the canonical `bridge-service/` (owner decision, OPEN_ISSUES B6).
4. **No correction workflow** yet (`attendance_corrections`) and **no shift model** — a punch cannot yet be
   classified late/early/overnight (Phase 2).

---

## 4. Configuring a future device

### 4.1 Server (Synology, once)
Set a strong shared secret and restart the API:
```
# .env  (see .env.example lines ~76–77, currently commented out)
FINGERPRINT_BRIDGE_SECRET=<long-random-shared-secret>
```
`docker compose up -d --build` (secret is read by `requireBridgeAuth`). Until set, all bridge routes 503.

### 4.2 Workstation (per PC with a scanner)
```
# bridge-service/.env
BRIDGE_PORT=8765
BRIDGE_VENDOR=mantra           # or zkteco / morpho once its adapter is implemented; mock for testing
ERP_BASE_URL=http://192.168.1.137:8888
ERP_BRIDGE_SECRET=<same value as server FINGERPRINT_BRIDGE_SECRET>
BRIDGE_ALLOW_ORIGINS=http://192.168.1.137:8888   # never "*"
MANTRA_RD_BASE=http://127.0.0.1:11100            # mantra only
```
Install the vendor RD service/SDK on that PC, then `npm start` in `bridge-service/`.

### 4.3 Feature flag
Enrolment/punch UI is additionally gated by `ff_hr_biometric_attendance` (seeded **disabled**). Enable it
via `PATCH /api/feature-flags/ff_hr_biometric_attendance` (admin) only after the device is verified.

---

## 5. Expected data formats

- **Enroll** → bridge captures a template, POSTs to `/api/bridge/enroll` with `x-enroll-token`; server stores
  `{scope, scopeId, vendor, fingerName, template(base64), quality}`.
- **Punch** → bridge captures, matches locally against `/api/bridge/templates?scope=staff` candidates, and
  POSTs the winning `{templateId}` to `/api/bridge/staff-punch` with `x-punch-token`; server toggles in/out and
  upserts `staff_attendance` (`source="usb-bridge"`).
- **Login** → same shape to `/api/bridge/user-login` (`scope="user"`) → issues a `user_sessions` token.

---

## 6. Testing procedure (no hardware required)

1. Server: set `FINGERPRINT_BRIDGE_SECRET` in a **dev** env; `GET /api/bridge/info` should stop returning 503.
2. Workstation: run `bridge-service/` with `BRIDGE_VENDOR=mock` and matching `ERP_BRIDGE_SECRET`.
3. Enroll a test staff member via the mock adapter (`BRIDGE_MOCK_FINGER=alice`), then punch — expect a
   `staff_attendance` row with `source="usb-bridge"`.
4. Re-punch → expect the smart in/out toggle (out on the second punch of the day).
5. `bridge-service/src/**/*.test.js` is included in the vitest globs — add adapter unit tests there.

---

## 7. Failure handling

- **Secret unset / mismatch** → 503 / 401; bridge refuses to act. Safe default.
- **Device offline** → adapter `status()` reports `deviceConnected:false`; UI should surface and fall back to
  manual/WebAuthn punch. (Historical bug: `docs/archive/TOP_100_PRODUCTION_BUGS.md` #28 — bridge socket leak on
  sudden USB disconnect; handle disconnect cleanly.)
- **Duplicate/replayed punch** → challenge tokens are single-use; `staff_attendance` unique `(staff_id,
  attendance_date)` + toggle prevents double day-rows. A future `attendance_raw_punches` table adds full
  idempotency on `(device_id, biometric_user_id, punch_ts)`.
- **Import partial failure** (future poller) → recorded in `attendance_import_runs`; re-run is idempotent.

---

## 8. Rollback

- **Disable instantly:** unset `FINGERPRINT_BRIDGE_SECRET` and restart the API → all bridge routes 503; stop the
  workstation `bridge-service/`. Set `ff_hr_biometric_attendance=false`. Existing `staff_attendance` rows and
  templates are retained (no data loss).
- **Full removal:** stop/uninstall `bridge-service/` on workstations. Server routes remain inert (503) with no
  secret. `bridge_fingerprint_templates` is a legal record — do not drop; disable instead.
- **Never** delete historical `staff_attendance` rows for a rollback.

---

## 9. Enable checklist (later, when hardware arrives)

- [ ] Implement + unit-test one real vendor adapter (`capture()`+`match()`); Mantra is closest (needs `match()`).
- [ ] Wire `useBridge.ts` into an enrolment + punch UI under `/staff`.
- [ ] Reconcile/delete the broken `desktop/bridge/` duplicate.
- [ ] Add raw-punch preservation, import-run ledger, correction workflow, and `audit_logs` on bridge writes.
- [ ] Set `FINGERPRINT_BRIDGE_SECRET` (server) + per-workstation `ERP_BRIDGE_SECRET`; document in `.env.example`.
- [ ] Verify end-to-end with the mock adapter, then the real device, in shadow mode before enabling awards/allowances.
