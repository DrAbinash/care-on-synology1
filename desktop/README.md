# Care Diagnostics Desktop Module

Unified folder for all Windows/desktop utilities and the offline sync engine.

## Structure

```
desktop/
  build/          # Windows build scripts (portable .zip, NSIS installer, Electron app)
  bridge/         # USB fingerprint scanner bridge service (local workstation)
  pull-agent/     # DICOM studies pull agent for radiology workflow
  sync/           # Offline-first sync engine (NEW)
```

## Sync Engine (`desktop/sync/`)

The sync engine runs inside the Electron/Windows build and manages the offline-
to-cloud lifecycle for billing, orders, and tests.

- **Offline**: mutations write to local PostgreSQL + `sync_queue`
- **Online**: pushes queued changes to cloud, pulls cloud changes, resolves conflicts
- **Conflict resolution**: server wins by default

### Usage (from Electron main process)

```js
const { SyncEngine } = require("./desktop/sync/src/engine.js");
const engine = new SyncEngine({
  cloudBaseUrl: "https://your-app.replit.app",
  localDbUrl:   "postgres://localhost:55432/diagnostic_erp",
  clinicId:     "clinic-001",
  authToken:    staff_session_token,
});
engine.start();
```

## Legacy Locations (still valid)

The original folders are kept for backward compatibility during transition:
- `windows-build/` → now also at `desktop/build/`
- `bridge-service/` → now also at `desktop/bridge/`
- `artifacts/windows-pull-agent/` → now also at `desktop/pull-agent/`

New development should use the `desktop/` paths.
