# Care Diagnostics Scanner System — Production Deployment Checklist

Covers everything shipped across the scanner infrastructure overhaul
(Phases 0-6, the signed-off expense-bill OCR change, and this production-
readiness pass). Work through this on the actual Synology deployment
before or during rollout — nothing in this checklist has been executed
against production; it's derived from the code and docker-compose
configuration, not a runbook that's already been run.

## ✓ Docker volumes

- [ ] Confirm `docker-compose.yml`'s `api` service has **both**:
  - `object_storage:/app/data/object-storage` (pre-existing)
  - `uploads_data:/app/data/uploads` (added in Phase 0 — this is what
    prevents scanned documents from being wiped on every
    `docker compose up -d --build`)
- [ ] Confirm the `uploads_data` volume is registered in the top-level
  `volumes:` block.
- [ ] If any documents were captured before Phase 0 shipped, they were on
  ephemeral storage and are likely already gone — no migration needed,
  just confirm going forward.
- [ ] After deploy: `docker volume ls | grep uploads_data` shows the
  volume exists and isn't recreated empty on subsequent deploys.

## ✓ Database migration status

All migrations are auto-discovered from `migrations/` alphabetically by
`care-db-patch-v2` — no manual registration step. Confirm these files are
present and were applied (check `care-db-patch-v2` container logs for
`✓ Feature migration applied: <filename>`):

- [ ] `migrations/scanned_documents.sql` — creates the `scanned_documents`
  table (Phase 4).
- [ ] `migrations/scan_retention_settings.sql` — adds
  `clinic_settings.scan_retention_days` (Phase 4).
- [ ] `migrations/scanned_documents_variants.sql` — adds
  `processed_storage_path`/`processed_size_bytes`/`thumbnail_storage_path`/
  `thumbnail_size_bytes` to `scanned_documents` (production-readiness pass).
- [ ] Run `care-schema-verify` (or check its log output) to confirm no
  schema drift after all three have applied.
- [ ] None of these touch any 🔴-protected table (`bills`, `banking`,
  `expenses`, `ledgers`, `payment_logs`, etc.) — no Financial Change
  Control sign-off is required for the migrations themselves. (The
  expense-bill OCR **code** change was separately signed off — that's a
  code change, not a migration.)

## ✓ Browser permissions

- [ ] Confirm the ERP is reached over **HTTPS** (or `localhost`) on the
  reception workstation — camera capture (Webcam, TVS PDS 8M) will not
  work at all over plain HTTP LAN addresses; see
  `docs/TVS_PDS_8M_VALIDATION.md`'s HTTPS section.
- [ ] On first use, grant Chrome's camera permission prompt for the ERP's
  origin.
- [ ] Confirm Windows' OS-level camera privacy setting (Settings → Privacy
  → Camera → "Allow apps to access your camera") is enabled — otherwise
  `getUserMedia()` fails and is classified as `permission-denied` even
  though the browser-level permission looks fine.
- [ ] If the workstation is managed via Group Policy, confirm no policy
  blocks camera access for the ERP's origin.

## ✓ TVS camera permissions

- [ ] Plug in the TVS PDS 8M and confirm Windows enumerates it (Device
  Manager → Cameras, or `Win+I` → Bluetooth & devices → Cameras).
- [ ] Open `/settings/scanner` (admin/owner role required) and use the
  "TVS PDS 8M" section's live preview to visually confirm which
  enumerated camera is the TVS, then click "This is the TVS PDS 8M" to
  bind it.
- [ ] Confirm the "Scan with TVS PDS 8M" tile then appears in
  `UnifiedScanCapture` dialogs (Patients today; other modules once
  migrated).
- [ ] **Status remains "implemented but awaiting hardware validation"
  until this step is actually done** — see
  `docs/TVS_PDS_8M_VALIDATION.md`.

## ✓ Canon scanner

- [ ] Confirm `scan-bridge` is running on the reception workstation with
  `BRIDGE_SCAN_VENDOR=wia` (or `folder-watch`, matching however the Canon
  driver is configured) and, critically, **`ERP_BASE_URL` or
  `BRIDGE_ALLOW_ORIGINS` set to the real HTTPS ERP origin** — this was
  previously silently omitted in the bridge's own quick-start docs and is
  the #1 cause of "Offline" (Phase 1 fix; see `scan-bridge/README.md`).
- [ ] In `UnifiedScanCapture`, confirm the "Existing Scanner" tile shows
  green/"Ready" (bridge health = `ok`), not "Not detected" or "Blocked."
- [ ] Trigger a real scan via "Existing Scanner" and confirm the image
  appears correctly (double `/uploads/` prefix bug fixed in Phase 1 — this
  specifically regressed the bridge-scan path before that fix).

## ✓ Scanner Bridge

- [ ] Confirm `scan-bridge` version includes the Phase 1 fixes: PNA
  header, `SCAN_WATCH_FOLDER` default alignment, updated `/open-scanner-app`
  message.
- [ ] Decide whether to enable `BRIDGE_REQUIRE_AUTH=true` +
  `ERP_BRIDGE_SECRET` now or defer — it defaults to `false` specifically
  so this rollout doesn't get locked out mid-deploy. If enabling, set the
  same secret in `/settings/scanner` on every workstation **before**
  flipping the bridge's `BRIDGE_REQUIRE_AUTH` to `true`.
- [ ] Confirm the bridge process is set to start automatically on
  workstation boot/login (Windows Task Scheduler or a startup shortcut —
  not covered by this codebase, a workstation-provisioning step).

## ✓ OCR

- [ ] Configure a Gemini API key in **AI Reporting Settings** (DB-backed,
  preferred path) rather than relying solely on the
  `AI_INTEGRATIONS_GEMINI_API_KEY` env var — Phase 1/production-readiness
  fixed the key-resolution order so the DB path is checked first, but
  either configuration works if only one is set.
- [ ] Test "Upload ID" on Form F and confirm `ocr` populates (not
  `ocrError`) — if `ocrError` appears, it now states the exact reason
  (previously a generic "OCR unavailable").
- [ ] Confirm the confidence badge shows a numeric percentage and that low-
  confidence (<80%) results show the red warning banner, not a silent
  auto-fill.
- [ ] Confirm the expense-bill scan panel (`/api/expenses/scan-bill`) also
  returns `blurScore`/`isBlurred` (signed-off preprocessing change).

## ✓ Uploads

- [ ] Confirm `SAFE_MIME_TYPES` now includes `image/heic`/`image/heif` (no
  action needed if just deploying — this is a code change, not config —
  but worth confirming a HEIC file is at least *accepted* rather than
  400'd, even if processed/thumbnail generation for it may fail — see
  "HEIC caveat" below).
- [ ] **HEIC generation is unverified** — test with a real iPhone HEIC
  photo. If `variantsError` mentions HEIC/HEIF, the processed/thumbnail
  variants won't exist for that file (original is still stored) — see
  `docs/IMAGE_NORMALIZATION.md`.
- [ ] Confirm a PDF upload stores correctly with `processedUrl`/
  `thumbnailUrl` both `null` (expected, not a bug — sharp can't rasterize
  PDFs).
- [ ] Spot-check that a large (>10MB) photo upload gets downscaled in its
  processed variant (compare `sizeBytes` vs `processedSizeBytes` in the
  `scanned_documents` row).

## ✓ Synology deployment

- [ ] Standard `docker compose up -d --build` / Container Manager redeploy
  — no new services were added, only volume mounts and DB columns.
- [ ] Confirm `nginx.conf`'s HTTPS termination is in front of the ERP (see
  Browser Permissions above).
- [ ] No Replit-specific storage or services were introduced anywhere in
  this work — confirmed throughout (see each phase's commit messages).

## ✓ Rollback procedure

Every phase's commit is independently revertable — see each commit
message's own "Rollback instructions" section for specifics. General
principles that hold across all of them:

- **DB migrations are additive only** (`CREATE TABLE IF NOT EXISTS` /
  `ADD COLUMN IF NOT EXISTS`) — rolling back code never requires rolling
  back schema; unused columns/tables are harmless to leave in place.
- **`docker-compose.yml`'s `uploads_data` volume** — removing the mount
  line reverts to ephemeral storage; existing volume data isn't deleted,
  just unmounted.
- **Scanner Bridge auth** (`BRIDGE_REQUIRE_AUTH`) — defaults `false`;
  never flip it on until every workstation has the secret configured, and
  it can be flipped back off instantly if it locks anything out.
- **`UnifiedScanCapture` rollout** — old scan UI paths were removed in
  Phase 6; reverting that specific commit restores the old 6-button menu
  if the unified UI needs to be pulled back for any module.
- To fully roll back to before this entire body of work: `git revert` (in
  reverse chronological order) the merge commits for PRs #56, #57, #58,
  and this production-readiness PR. No manual DB cleanup is required
  first — the additive-only migrations are safe to leave in place even if
  the application code is reverted.
