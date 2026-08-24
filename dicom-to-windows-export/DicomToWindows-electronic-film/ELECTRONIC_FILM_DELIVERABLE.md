# Electronic Film + Admin UI — Implementation Deliverable

## 1. Existing Architecture Discovered

Single-container Python bridge (`server.py` ~2900 lines) with:

| Component | Status | Location |
|-----------|--------|----------|
| DICOM Print SCP (pynetdicom) | EXISTING | `server.py` — `build_ae()`, N-service handlers |
| C-ECHO / Verification | EXISTING | `handle_echo()` |
| N-CREATE Film Session / Film Box / Image Boxes | EXISTING | `_create_film_session()`, `_create_film_box()` |
| N-SET Image Box pixel data | EXISTING | `_set_image_box()` |
| N-ACTION print trigger | EXISTING | `handle_action()` → `_print_film_box()` |
| N-DELETE cascade | EXISTING | `handle_delete()` |
| N-GET Printer status | EXISTING | `handle_get()` |
| Image decode (grayscale/color/YBR) | EXISTING | `decode_image_box_pixels()` |
| Gamma + percentile calibration | EXISTING (extended) | `calibrate_grayscale/color` → `image_profiles.calibrate_frame()` |
| Page layout / letterhead | EXISTING | `render_page()`, `render_banner()` |
| PDF/PNG artifact save | EXISTING | `save_pages()` |
| CUPS / JetDirect physical print | EXISTING | `spool_print_job()` |
| ERP HTTP print API | EXISTING (extended) | `_PrintBridgeHTTPHandler` |
| ERP branding pull | EXISTING | `fetch_erp_branding()` |
| In-memory job status (1h) | PARTIAL | `PrintJobStatusRecord` |
| ENV-only configuration | EXISTING | module-level `_env_*` readers |
| Admin UI | MISSING → **ADDED** | `/admin`, `admin_ui.html` |
| Persistent electronic film jobs | MISSING → **ADDED** | `job_store.py` |
| Capture modes | MISSING → **ADDED** | `CAPTURE_MODE` |
| Identity audit | MISSING → **ADDED** | `identity_audit.py` |
| Config persistence | MISSING → **ADDED** | `config_store.py` |

## 2. What Was Already Built vs Added

**Reused unchanged core:** DICOM association handling, Film Session/Box/Image Box lifecycle, pixel decoding, CUPS/JetDirect, ERP HTTP print POST, ERP branding thread, batch flush housekeeping.

**Added:**
- `config_store.py` — ENV > CONFIG > defaults precedence
- `job_store.py` — persistent electronic film job JSON + index
- `identity_audit.py` — PHI-safe tag presence audit
- `image_profiles.py` — brightness/contrast/sharpness/invert + per-modality profiles
- `admin_auth.py` — PBKDF2 sessions, CSRF, login rate limiting
- `admin_routes.py` + `admin_ui.html` — local admin dashboard
- Capture mode separation (capture vs physical print status)
- Console layout preservation + multi-page spill (no overflow drop when `PRESERVE_CONSOLE_LAYOUT=true`)
- Extended APIs: job list, artifact download, admin settings

## 3. DICOM Print Lifecycle

```
MRI SCU → Association (EVT_ACCEPTED logged)
       → C-ECHO (optional)
       → N-CREATE Film Session
       → N-CREATE Film Box (ImageDisplayFormat → rows×cols)
       → N-SET Image Box(es) with pixel data
       → N-ACTION Film Box (Action Type 1 = Print)
       → N-ACTION success returned immediately
       → Background: render → save PDF/PNG → optional physical print
       → N-DELETE (session/box cleanup)
```

## 4. Electronic Film Lifecycle

```
N-ACTION → _print_film_box()
        → process_print_job() [ThreadPoolExecutor]
        → job_store.create_job() [pending]
        → render_page() per page group
        → save_pages() → OUTPUT_DIR/print_YYYYMMDD-HHMMSS_*.pdf
        → job_store.update_job(captureStatus=captured)
        → optional spool_print_job() → physicalPrintStatus printed|failed
```

Job metadata: `/data/print-jobs/jobs/{jobKey}.json` + `index.json`

## 5. Capture Modes

| Mode | Electronic Film | Physical Print | DICOM N-ACTION |
|------|-----------------|----------------|----------------|
| `CAPTURE_ONLY` | Always | Skipped | Success if capture succeeds |
| `CAPTURE_AND_PRINT` | Always | Attempted; failure does not erase capture | Success if capture succeeds |
| `PRINT_ONLY` | Saved then printed | Required for job success | Fails if print fails |

## 6. Console Layout Fidelity

When `PRESERVE_CONSOLE_LAYOUT=true` (default in persisted config):
- Uses Film Box `ImageDisplayFormat` rows×cols (not modality default grid)
- Image order by `ImageBoxPosition`
- Overflow images spill to additional pages (not dropped)
- `HONOR_SCU_FILM_SIZE` obeys `FilmSizeID` when enabled
- `BATCH_GROUP_BY=auto` only applies when `PRESERVE_CONSOLE_LAYOUT=false` (legacy GE P1 batching)

Unsupported DICOM print attributes (Magnification Type, Border Density, etc.) are not rewritten silently — identity audit captures what arrived; unsupported layout attrs are logged at Film Box creation.

## 7. Image Processing / Calibration

Pipeline in `image_profiles.calibrate_frame()`:
1. Percentile stretch (black/white point)
2. Gamma
3. Brightness offset
4. Contrast multiplier
5. Sharpness (unsharp mask via Gaussian)
6. Invert polarity

Per-modality overrides via `MODALITY_PROFILES` JSON in config. Admin UI exposes global controls + synthetic grayscale preview (`/admin/api/calibration-preview`).

## 8. Admin UI Architecture

- Served from same HTTP server on `HTTP_PORT` (default 8090)
- URL: `http://<bridge-ip>:8090/admin`
- Static single-page `admin_ui.html` + JSON API under `/admin/api/*`
- Auth: session cookie + `X-Admin-Session`, CSRF on writes
- First login sets password if `ADMIN_PASSWORD_HASH` empty

Pages: Dashboard, DICOM, Film/Layout, Calibration, Branding, Printer, Storage, Job History, Diagnostics, Backup/Presets.

## 9. Config Precedence / Persistence

```
ENV (docker-compose / Container Manager)  — highest, unchanged deployments work
    ↓
/data/config/config.json (operator saves via Admin)
    ↓
Built-in defaults (config_store.DEFAULTS)
```

Each setting shows source: ENV | CONFIG | DEFAULT. Restart required: `DICOM_AET`, `DICOM_PORT`, `ALLOWED_CALLING_AETS`, `HTTP_PORT`. Other settings live-apply via `reload_live_config()`.

Docker volume: `./config:/data/config`

## 10. Branding

`BRANDING_SOURCE`: `CARE` (ERP_BRANDING_URL) or `LOCAL` (clinic fields + HEADER_*/FOOTER_*). Effective source shown in Admin. ERP unreachable → local fallback fields used; not silently merged.

## 11. Security

- Admin login required (PBKDF2-SHA256 password hash)
- Session tokens + CSRF on POST
- Login rate limiting (5 attempts / 5 min per client)
- `HTTP_BRIDGE_SECRET` masked in settings export/UI
- No pixel data / full datasets in diagnostics
- Identity audit redacts PHI in displayed values

## 12. Job / Artifact API (CARE integration)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/v1/health` | None | Liveness + printer + capture mode |
| `GET /api/v1/print-jobs` | Bearer | List persistent jobs |
| `GET /api/v1/print-jobs/{jobKey}` | Bearer | Job metadata + identity audit |
| `GET /api/v1/print-jobs/{jobKey}/artifact` | Bearer | PDF/PNG download |
| `POST /api/v1/print-jobs` | Bearer | ERP print (unchanged) |

Auto-match keys: `StudyInstanceUID` > `AccessionNumber`. PatientName alone never auto-matches. `identitySummary.status`: `MATCHABLE` | `UNMATCHED`.

## 13. Files Changed

**New:** `config_store.py`, `job_store.py`, `identity_audit.py`, `image_profiles.py`, `admin_auth.py`, `admin_routes.py`, `admin_ui.html`, `tests/test_bridge.py`, `ELECTRONIC_FILM_DELIVERABLE.md`

**Modified:** `server.py`, `Dockerfile`, `docker-compose.yml`

## 14. Tests / Results

```
python3 -m unittest tests.test_bridge -v
→ 10 tests OK (config precedence, AE/port validation, identity audit, calibration, job store, auth, path safety)
```

Smoke test: `GET /admin` → 200, `GET /api/v1/health` → 200 with `captureMode`.

## 15. Docker / Deployment

- New volume: `./config:/data/config`
- New env: `CAPTURE_MODE`, `PRESERVE_CONSOLE_LAYOUT`, `CONFIG_DIR`
- Dockerfile copies all Python modules + `admin_ui.html`

## 16. Regression Risks

- Existing ENV-only docker-compose deployments: **no change required**
- `BATCH_GROUP_BY=auto` in compose still works when `PRESERVE_CONSOLE_LAYOUT=false`
- ERP HTTP print API: backward compatible
- DICOM N-ACTION still returns success before background work completes

## 17. ONE-TIME LIVE TEST (UIH MRI → PRINTSCP)

After deploy, configure MRI DICOM Print destination:
- AE Title: `PRINTSCP` (or your `DICOM_AET`)
- IP: bridge LAN IP
- Port: `104`

Print a composed film from UIH console.

**Expect in Admin UI (Dashboard):**
- Bridge Status: RUNNING
- Last Association: calling AE from MRI
- Last inbound film / Last successful capture: new job entry
- Capture mode shown (CAPTURE_AND_PRINT or CAPTURE_ONLY)

**Expect in Job History:**
- Source: DICOM
- Calling AE: MRI SCU title
- Pages/layout from console ImageDisplayFormat
- Capture status: captured
- Physical print: printed | skipped | failed (per mode)
- Download link for PDF artifact

**Expect in Identity Audit (job detail JSON):**
- Table of tags: PatientID, StudyInstanceUID, AccessionNumber, etc.
- Present? / redacted value / dataset source
- `identitySummary.recommendedAutoMatchKey` if UIH sent StudyInstanceUID or AccessionNumber

**Expect artifact:**
- `/data/print-jobs/print_*.pdf` matching console layout (rows×cols per page)

**Physical printer (if CAPTURE_AND_PRINT + CUPS configured):**
- Sheet prints; failure still leaves electronic film captured

## 18. UNKNOWN Until Live Test

- Which patient/study tags UIH MRI actually sends in Film Session vs Film Box vs Image Box N-SET
- Whether UIH sends StudyInstanceUID or AccessionNumber in print datasets
- UIH-specific FilmSizeID / orientation strings
- Whether UIH uses session-level or per-film-box N-ACTION

## 19. Verdict

**SAFE FOR CLINIC TEST** — core DICOM Print SCP preserved; electronic film + admin are additive. Run one UIH film with identity audit before enabling CARE auto-match.

**DO NOT MERGE automatically** (per project instructions).
