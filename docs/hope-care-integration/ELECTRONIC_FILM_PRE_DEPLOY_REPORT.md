# Electronic Film Integration — Pre-Deploy Report

**Branch:** `cursor/electronic-film-care-hope-6809`  
**Date:** 2026-08-23  
**Verdict:** SAFE FOR ONE-FILM CLINIC TEST (with recommended initial settings below)

---

## A. EXISTING COMPONENTS REUSED

- `integration_outbox` + `enqueueOutboxEvent` / `dispatchPendingOutbox`
- `diagnostic_referrals` + `care_order_id` lineage
- `radiology_studies` (accession + StudyInstanceUID)
- `pacs_settings` (feature flags / cutover)
- `PRINT_BRIDGE_URL` / `PRINT_BRIDGE_SECRET` (DicomToWindows auth)
- HOPE `careCallback.ts` + `diagnostic_orders` + OPD `investigations` API
- CARE uploads tree (`data/uploads/electronic_film/`)

## B. CODE IMPLEMENTED

**CARE:** poller, matcher, storage, HOPE emitter, diagnostics, API routes, reporting panel, settings UI  
**HOPE:** `diagnostic_electronic_film.available` callback + OPD film links

## C. DICOMTOWINDOWS HARDENING

Project A merged on GitHub `main` — not re-modified in this branch. Run Project A clinic test + identity audit before relying on auto-match.

## D–L. ARCHITECTURE SUMMARY

| Area | Implementation |
|------|----------------|
| Ingest | Poll `GET /api/v1/print-jobs` → fetch artifact → store PDF |
| Matching | StudyInstanceUID > AccessionNumber > MANUAL |
| Unmatched | `MATCH_REQUIRED` — never auto-sends to HOPE |
| HOPE delivery | Outbox `diagnostic_electronic_film.available` |
| Cutover | `import_enabled_at` in pacs_settings |
| Flags | integration ON, auto import ON, **auto send HOPE OFF** (default) |
| Versioning | Per-study version + supersede previous `is_current` |
| Security | Staff auth for CARE; public token URL for HOPE view |
| NO DICOM to HOPE | PDF only via `mimeType: application/pdf` |

## M. SELF-TEST

`/radiology/electronic-film-settings` → **Run Electronic Film Pipeline Test**

## N. DATABASE

```bash
# Apply migration (idempotent)
psql "$DATABASE_URL" -f migrations/electronic_film_artifacts.sql
# Or: pnpm db:push
```

## O. KEY FILES

- `migrations/electronic_film_artifacts.sql`
- `lib/db/src/schema/electronicFilmArtifacts.ts`
- `artifacts/api-server/src/services/electronicFilm/*`
- `artifacts/api-server/src/routes/electronic-film.ts`
- `artifacts/diagnostic-erp/src/components/radiology/ElectronicFilmPanel.tsx`
- `artifacts/diagnostic-erp/src/pages/ElectronicFilmSettings.tsx`
- HOPE: `careCallback.ts`, `investigation-results.tsx`

## P. TESTS

Run: `pnpm test -- electronicFilm`

## Q. SYNTHETIC E2E

Requires DB + mock bridge — use pipeline self-test UI for live bridge check.

## R. LIVE-ONLY UNKNOWN

- UIH Identity Audit (which tags modality sends)
- Real MRI console layout fidelity
- Production bridge URL reachability from CARE container

## S. DEPLOYMENT STEPS

1. Deploy DicomToWindows Project A (`main`) with `CAPTURE_ONLY` or `CAPTURE_AND_PRINT`
2. Deploy CARE branch + run migration
3. Deploy HOPE branch
4. Set `PRINT_BRIDGE_URL` + `PRINT_BRIDGE_SECRET` on CARE (or via settings UI)
5. Set `INTEGRATION_HOPE_CALLBACK_URL` + `INTEGRATION_HOPE_SIGNING_SECRET`
6. Open `/radiology/electronic-film-settings` → Set cutover → Run pipeline test

## V. INITIAL SETTINGS

| Setting | Value |
|---------|-------|
| DicomToWindows | `CAPTURE_ONLY` or `CAPTURE_AND_PRINT` |
| Integration ON | ✓ |
| Auto Import | ✓ |
| Auto Send HOPE | **OFF** |
| Cutover | Set to deploy time |

## W. ONE-FILM CLINIC TEST

1. HOPE OPD patient with CARE referral  
2. MRI on modality → DICOM Print  
3. CARE: poll or wait 2 min → check worklist/reporting panel  
4. If matched: manually **Send to HOPE**  
5. HOPE OPD: verify **Electronic Film** link  

## Y. ROLLBACK

- Turn Integration OFF in settings (no code rollback required)
- HOPE ignores unknown events safely
