# Building Windows .exe Distributions

This monorepo can produce **three** different Windows distributions of the
Diagnostic Center Billing ERP, each fully self-contained (Node + PostgreSQL +
API + both frontends bundled — no prerequisites on the target PC):

| # | Output | Approx size | What it is |
|---|--------|-------------|-----------|
| 1 | `windows-build/dist/DiagnosticERP-Portable.zip`               | 264 MB | A folder you unzip and double-click `DiagnosticERP.exe` — no install. |
| 2 | `windows-build/dist/DiagnosticERP-Setup.exe`                  | 264 MB | Classic NSIS installer (Program Files, Start Menu, Add/Remove Programs). |
| 3 | `windows-build/dist/electron/DiagnosticERP-Desktop-Setup.exe` | 421 MB | Native desktop app (Electron) with its own installer. |

All three share the same payload: a portable Node.js, a portable PostgreSQL,
the bundled API server, and both built React frontends.

---

## Quick start (build everything)

From the repo root:

```bash
pnpm --filter @workspace/windows-build run build:all
```

This runs all five build steps in order. End-to-end time on a fresh checkout
is ~5–10 minutes (the first run downloads ~250 MB of Windows runtimes; later
runs hit the cache in `windows-build/.cache/`).

When it finishes, the three artifacts above will be in `windows-build/dist/`.

---

## Per-step builds

You can also run each step individually if you only need one output:

```bash
# 1. Build the shared payload (api + frontends + portable Node + portable Postgres)
pnpm --filter @workspace/windows-build run build:payload

# 2. Compile DiagnosticERP.exe via Node Single Executable App
pnpm --filter @workspace/windows-build run build:launcher

# 3. Wrap the portable folder into DiagnosticERP-Portable.zip
pnpm --filter @workspace/windows-build run build:portable

# 4. Build DiagnosticERP-Setup.exe via NSIS
pnpm --filter @workspace/windows-build run build:installer

# 5. Build the Electron desktop installer
pnpm --filter @workspace/windows-build run build:electron
```

Steps must be run in the order above — each depends on the previous output.

---

## Distribution layouts

### 1. Portable launcher (`DiagnosticERP-Portable.zip`)

Unzip anywhere. Double-click `DiagnosticERP.exe`. The folder layout:

```
DiagnosticERP/
├── DiagnosticERP.exe          ← double-click to run
├── runtime/
│   ├── node/node.exe
│   └── pgsql/bin/postgres.exe …
├── app/
│   ├── server/                ← bundled API + node_modules
│   ├── web/                   ← built React apps
│   └── db-migrate/            ← schema runner (drizzle-kit push)
├── data/                      ← created on first run; PG cluster + .pgpass
└── logs/                      ← launcher.log, postgres.log, api.log
```

On first launch the .exe:

1. Creates `data/pgsql/`, generates a random Postgres superuser password,
   runs `initdb`.
2. Starts Postgres on the first free port at or above 55432, on
   127.0.0.1 only (no external access).
3. Runs `drizzle-kit push` to create the schema.
4. Starts the bundled API on the first free port at or above 8888.
5. Opens the user's default browser to `http://localhost:8888/`.

Closing the console window (or pressing Ctrl+C) cleanly shuts down the API
and Postgres. Re-launching reuses the existing data.

### 2. NSIS installer (`DiagnosticERP-Setup.exe`)

A traditional setup wizard:

- Installs to `C:\Program Files\DiagnosticERP\` by default.
- Creates a Start Menu folder + Desktop shortcut.
- Registers in **Add or Remove Programs**.
- The uninstaller asks whether to delete the data folder (default: keep).

Behaviour after install is identical to the portable launcher.

### 3. Electron desktop app (`DiagnosticERP-Desktop-Setup-1.0.0.exe`)

Same payload, but the user gets a native desktop window instead of a browser
tab. The Electron main process starts Postgres + the API on background ports
and points a `BrowserWindow` at the local server. Window close = app exit =
Postgres clean shutdown.

User data (Postgres cluster, logs, generated password) is stored under
`%APPDATA%\Diagnostic ERP Desktop\diagnostic-erp\` — separate from the
portable launcher's `data/` folder.

---

## Cross-build from Linux: what works, what doesn't

This whole pipeline runs from the Replit Linux container — **no Windows
machine required**:

| Step | Linux? | How |
|------|--------|-----|
| Bundle the Node API server | Yes | `esbuild` |
| Build both React frontends | Yes | Vite |
| Download portable Node Windows | Yes | `curl` from nodejs.org |
| Download portable Postgres Windows | Yes | `curl` from EnterpriseDB |
| `DiagnosticERP.exe` | Yes | Node 20 SEA + `postject` injecting into the **Windows** `node.exe` |
| NSIS installer | Yes | `makensis` — embeds the portable .zip and extracts it via PowerShell at install time |
| Electron `win-unpacked/` | Yes | `electron-builder --win dir --x64`, with `signAndEditExecutable: false` to skip the `winCodeSign` (wine) step |
| Electron NSIS installer | Yes | `zip` + custom `installer-electron.nsi` — same PowerShell-extract trick as the launcher installer (avoids the slow LZMA 7z step `electron-builder --win nsis` would do) |

> **Why the custom NSIS step for Electron?** The default `electron-builder --win nsis` pipeline runs LZMA 7z compression over the whole 384 MB payload + then a NSIS wrap. That comfortably exceeds 2 minutes inside the Replit sandbox and gets killed mid-write. Splitting into "build win-unpacked, then zip + makensis ourselves" sidesteps both the wine dependency and the long-running 7z step while producing a functionally equivalent installer.

**What we cannot test in the sandbox**: actually running the resulting `.exe`.
The Replit container is Linux and can't execute Windows PE binaries. The
final smoke test (does the launcher open the browser? does the installer
install?) must be performed on a real Windows 10/11 machine.

---

## What's bundled

- **Node.js**: 20.18.1 (Windows x64 portable)
- **PostgreSQL**: 16.4-1 (EnterpriseDB Windows x64 binaries)
- **API server**: bundled with esbuild + production `node_modules` from
  `pnpm deploy --prod --legacy`
- **Frontends**: `diagnostic-erp` built with `BASE_PATH=/`, `super-admin-portal`
  built with `BASE_PATH=/super-admin-portal/`. Both served by the same Node
  process via `SERVE_STATIC_DIR`.

---

## Re-runs and caching

`windows-build/.cache/` contains:

- The downloaded Node + Postgres Windows zips (~250 MB total)
- Extracted Node + Postgres trees
- Intermediate `pnpm deploy` outputs

To force a clean rebuild, delete `windows-build/dist/` (and optionally
`windows-build/.cache/` to re-download the runtimes).

```bash
pnpm --filter @workspace/windows-build run clean
```

---

## Tips for end users

The bundled installer/launcher is **not code-signed**. Windows SmartScreen
will show a "Windows protected your PC" prompt the first time the user runs
it. They need to click "More info" → "Run anyway".

To distribute officially, buy a code-signing certificate and add a `signing`
section to `windows-build/electron-app/package.json` (`build.win.certificateFile`
+ `certificatePassword`). For NSIS, add a post-build `signtool` step in
`build-installer.mjs`.
