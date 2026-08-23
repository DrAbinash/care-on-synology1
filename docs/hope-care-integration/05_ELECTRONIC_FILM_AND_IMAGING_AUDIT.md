# Electronic Film + CARE ↔ HOPE Imaging Audit

**Date:** 2026-08-23  
**Repositories audited:**

- CARE: `DrAbinash/care-on-synology1`
- DICOM Print bridge: `DrAbinash/DicomToWindows`

**Mode:** Audit only — no implementation changes in this document.

---

## Architectural constraint (HOPE)

Do **not** upload/copy the complete DICOM study into HOPE. CARE/Orthanc remains the authoritative PACS for the full study.

HOPE should receive only:

1. **Electronic Film** generated from the technician's MRI-console DICOM Print job (preferably PDF; optionally PNG/JPEG preview if useful)
2. **Final radiology report** / existing report linkage
3. **Minimal immutable imaging identifiers** for traceability (CARE imaging/study ID, accession number, StudyInstanceUID if already in integration, modality, study date, electronic-film artifact ID/version)

The full DICOM images must stay in CARE/Orthanc.

HOPE OPD patient record should show something like:

```
MRI BRAIN — 24 Aug 2026
[ View Electronic Film ]
[ View Report ]
```

Optionally `[ View Full PACS Study ]` **only** if the existing secure CARE/OHIF cross-system viewer linkage exists and authorization is correct. That action must open CARE/OHIF securely — it must **not** mean copying DICOM files into HOPE.

---

## Executive summary

| Area | Verdict |
|------|---------|
| **Electronic Film (DicomToWindows)** | **MOSTLY BUILT** |
| **CARE film consumption** | **NOT BUILT** |
| **HOPE image access** | **PARTIAL** / **WIRED BUT BROKEN** (CARE emits study OHIF + report PDF; HOPE receive/UI not in CARE repo) |

**Smallest gap to close first:** Implement HOPE reception and OPD display of **existing** `diagnostic_study.completed` (OHIF) and `diagnostic_report.finalised` (PDF). Then add **DicomToWindows → CARE → HOPE** for a **single PDF electronic film** using `patient_documents`, not DICOM instances.

---

# PART 1 — ELECTRONIC FILM (DicomToWindows)

## 1. Existing architecture

| Component | Status | Evidence |
|-----------|--------|----------|
| Single-process bridge (`server.py`) | **BUILT** | `DicomToWindows/server.py` — DICOM Print SCP + render pipeline + optional CUPS/JetDirect + HTTP print API |
| Docker / NAS deployment | **BUILT** | `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`, `README.md` |
| CARE ERP outbound print (separate path) | **BUILT** (CARE repo) | `artifacts/api-server/src/routes/pacsEnterprise.ts` → `POST /api/radiology/print-images` → DicomToWindows `POST /api/v1/print-jobs` |

**Direction today:**

- **Modality → DicomToWindows:** DICOM Print (inbound SCP)
- **CARE → DicomToWindows:** HTTP JSON with base64 JPEGs (outbound)
- **DicomToWindows → CARE:** **nothing**

## 2. Inbound DICOM Print support

**Verdict: BUILT** (conformant Print Management SCP for Basic Grayscale + Color Meta SOP Classes)

| SOP / service | Supported? | Handler |
|---------------|------------|---------|
| Verification (C-ECHO) | Yes | `handle_echo` (`server.py`) |
| Basic Film Session N-CREATE | Yes | `_create_film_session` |
| Basic Film Box N-CREATE | Yes | `_create_film_box` |
| Basic Grayscale/Color Image Box N-SET | Yes | `_set_image_box` |
| Film Box / Session N-ACTION (print) | Yes | `_print_film_box`, `_print_film_session` |
| N-DELETE cascade | Yes | `handle_delete` |
| Printer N-GET (status) | Yes | `handle_get` |
| AE bootstrap | `build_ae()` registers Verification, Print Meta, Film Session/Box, Image Box, Printer, PrintJob, PrinterConfigurationRetrieval |

**Association:** `pynetdicom` AE; optional `ALLOWED_CALLING_AETS` allow-list; `DICOM_AET` / `DICOM_PORT` (default `PRINTSCP` / `104`).

## 3. N-CREATE / N-SET / N-ACTION lifecycle

**Trace (MRI SCU → artifact):**

```
Association (Calling AE stored on Film Session)
  → N-CREATE Film Session          [FILM_SESSIONS registry]
  → N-CREATE Film Box              [parses ImageDisplayFormat → rows×cols; creates Image Box UIDs]
  → N-SET Image Box(es)            [decode pixel → numpy array; position, label, patient tags]
  → N-ACTION Film Box (type 1)     [_print_film_box → batch or immediate print]
  → ThreadPoolExecutor             [process_print_job: render → save PDF/PNG → spool to printer]
  → N-DELETE (optional cleanup)    [session/box/image box GC]
```

**Status:** **BUILT** end-to-end inside DicomToWindows. **No CARE hook** after render.

N-ACTION returns **success (0x0000) before** background render/print completes (`_PRINT_EXECUTOR.submit`); this is normal for Print SCP.

## 4. What it captures

| Field | Captured? | Stored where? | Persisted? | Used? |
|-------|-----------|---------------|------------|-------|
| Calling AE | Yes | `FilmSessionRecord.calling_ae` | In-memory until GC | Batch grouping (`BATCH_GROUP_BY=auto`) |
| Film Session UID | Yes | `FILM_SESSIONS` dict key | In-memory | job_key in `session` mode |
| Film Box UID | Yes | `FILM_BOXES` | In-memory | Logging |
| Image Box UID | Yes | `IMAGE_BOXES` | In-memory | Pixel + position |
| Image Display Format (rows×cols) | Yes | `FilmBoxRecord.rows/cols` | In-memory | Grid layout; capped at `ABSOLUTE_MAX_IMAGE_BOXES` |
| Image Box position | Yes | `ImageBoxRecord.position` | In-memory | Sort order for layout |
| Film Orientation | Yes | `FilmBoxRecord.orientation` | In-memory | `PAGE_ORIENTATION` / render |
| Film Size ID | Yes | `FilmBoxRecord.film_size_id` | In-memory | Only if `HONOR_SCU_FILM_SIZE=true` |
| Magnification / Smoothing / Polarity / Trim / Border Density | **No** | — | — | Not read from Film Box attrs |
| Copies | Yes | `FilmSessionRecord.number_of_copies` | In-memory | Print loop |
| PatientID | Best-effort | `PatientInfo.patient_id`, `patient_key` | In-memory | Banner + batch key |
| PatientName | Best-effort | `PatientInfo.name`, `patient_key` fallback | In-memory | Banner |
| StudyDate | Best-effort | `PatientInfo.study_date` | In-memory | Banner |
| Modality | Best-effort | `PatientInfo.modality` | In-memory | `LAYOUT_<MODALITY>` grid |
| AccessionNumber | **No** | — | — | Not in `_extract_patient_info` |
| StudyInstanceUID | **No** | — | — | Not extracted |
| SeriesInstanceUID / SOPInstanceUID | **No** | — | — | Not extracted |
| SeriesDescription / InstanceNumber | Yes | `ImageBoxRecord.label` | In-memory | Per-tile caption |

Print Management modules do not require study UIDs; this implementation does not parse UID fields even if modalities embed them.

## 5. Electronic film artifact

**Does electronic film exist after N-ACTION? → YES (with caveats)**

| Question | Answer |
|----------|--------|
| Format | PDF (default) or PNG (`OUTPUT_FORMAT`) |
| Per Film Box vs Session | One rendered page group per print job; `BATCH_GROUP_BY=auto` may merge multiple Film Boxes / sessions into one page |
| Multi-page | Yes for HTTP API; DICOM path typically one page per batch (overflow images **dropped**, not spilled to second page — unlike HTTP) |
| Storage | `OUTPUT_DIR` (default `/data/print-jobs`) — `print_{timestamp}_{suffix}.pdf` |
| Retention | `JOB_RETENTION_DAYS` (default 30) — filesystem cleanup |
| Retrieval API | **PARTIAL** — `GET /api/v1/print-jobs/{jobKey}` returns **status only** (no file URL/path). Files are on disk only |
| HTTP download endpoint | **MISSING** |

After N-ACTION, PDF/PNG is written in `process_print_job` → `save_pages` **before** physical spool.

## 6. Layout fidelity

| Setting | Env var | Effect |
|---------|---------|--------|
| SCU film size | `HONOR_SCU_FILM_SIZE` (default **false**) | Site default stock wins unless enabled |
| Page size / orientation | `PAGE_SIZE`, `PAGE_ORIENTATION` | Can override console |
| Grid | `LAYOUT_ROWS/COLS`, `LAYOUT_<MODALITY>`, `AUTO_FIT_LAYOUT` | Modality-specific grids; partial batches reflow |
| Batch grouping | `BATCH_GROUP_BY=auto` (default) | May regroup single-image console prints across sessions by patient/AE |
| Image order | Image Box `position` | **Preserved** when sorting filled boxes |
| Overflow | N-ACTION handler | **Drops** images beyond grid (warns in log) |
| Branding | `HEADER_*`, `FOOTER_*`, `ERP_BRANDING_URL` | Alters rendered copy (letterhead from CARE clinic settings if URL set) |
| Labels / banner | `SHOW_IMAGE_LABELS`, `SHOW_PATIENT_BANNER` | Adds bridge/CARE chrome |

**Technician console layout:** **PARTIAL** — positions and grid from `ImageDisplayFormat` are honored until env overrides, batching, overflow drop, or branding alter the output.

## 7. Physical-print dependence

| Capability | Status |
|------------|--------|
| Receive + render + save artifact without printer | **PARTIAL** — artifact saved first; `spool_print_job` always runs and **fails** if `CUPS_PRINTER_NAME` / `JETDIRECT_HOST` unset → job status `failed`, but file may remain on disk |
| `START_CUPS=false` | Skips CUPS daemon but **does not skip spool** in `process_print_job` |
| Explicit `CAPTURE_ONLY` / `CAPTURE_AND_PRINT` / `PRINT_ONLY` | **MISSING** — no such mode flags |
| N-ACTION success to modality | **Yes** even if background spool fails (SCU already got 0x0000) |

**Practical capture-only:** Run with missing printer config → PDFs in `/data/print-jobs`, job poll shows `failed`. Not a clean product mode.

## 8. CARE visibility today

| Link | Status |
|------|--------|
| DicomToWindows reads CARE branding | **BUILT** — `ERP_BRANDING_URL` → CARE `/api/clinic-settings/branding` |
| CARE reads DicomToWindows film artifacts | **NOT BUILT** — no poller, webhook, or mount of `OUTPUT_DIR` |
| CARE links film to study/referral | **NOT BUILT** |
| CARE `PRINT_BRIDGE_URL` | **BUILT** — outbound only (`pacsEnterprise.ts`, `PrintImagePicker.tsx`) |

## 9. Missing links (Electronic Film → CARE → HOPE)

1. **DicomToWindows → CARE:** ingest hook (file watcher, HTTP push, or shared volume API) for rendered PDF/PNG
2. **CARE storage model** for electronic film artifact on `radiology_worklist` / study — **no table today**
3. **Study linkage** at capture time (accession/UID not captured by bridge; must match by PatientID + time + modality heuristics or MWL injection)
4. **CARE → HOPE** electronic-film event or `patient_documents` attachment — **not in outbox contract**
5. **CAPTURE_ONLY** mode (save artifact, skip spool, report `completed`) — not implemented in DicomToWindows
6. **Artifact retrieval API** on bridge (CARE cannot fetch PDF by job key)

---

# PART 2 — HOPE ↔ CARE IMAGING

## 10. Existing HOPE referral architecture

**CARE side: BUILT** (HOPE ERP code is **not** in this repo; `docs/hope-care-integration/` is the contract + HOPE reference adapter).

| Piece | Status | Location |
|-------|--------|----------|
| Inbound referral API | **BUILT** | `artifacts/api-server/src/routes/integration/inbound.ts` |
| Staff inbox + accept → CARE order | **BUILT** | `hopeReferrals.ts`, `HopeReferrals.tsx`, `careOrder.ts` |
| DB | **BUILT** | `migrations/hope_care_diagnostic_referral_integration.sql` |
| Feature flag | `ff_hope_care_referrals` (default off; auto-on when Hope env configured) |
| HOPE emit on OPD save | **REFERENCE ONLY** | `04_HOPE_ADAPTER_REFERENCE.md` |

**Intended flow:** HOPE OPD prescription → CARE referral → staff accept → `orders` → radiology → outbox callbacks to HOPE.

## 11. Existing CARE integration (outbound)

| Mechanism | Status | Files |
|-----------|--------|-------|
| Transactional outbox + HMAC callbacks | **BUILT** | `services/integration/outbox.ts` |
| Report finalised → HOPE | **BUILT** | `emitReportToHope.ts`, `resultsEmitter.ts` |
| Study performed → HOPE | **BUILT** | `statusReconciler.ts` — `diagnostic_study.completed` |
| Manual "Send to Hope" | **BUILT** | `RadiologyReportingWorkspace.tsx` → `/api/internal/radiology/send-report-to-hope` |
| Deep-link Hope → CARE reporting | **BUILT** | `resolveRadiologyOpen.ts`, `/radiology/open` |
| HOPE callback receiver | **NOT IN CARE REPO** | Documented as HOPE route `/integration/care-callback` |

## 12. Identifier lineage

```
HOPE patients.uhid
  ↓ source_patient_id
diagnostic_referrals (+ external_patient_links → patients.id / patient_id MRN)
  ↓ staff accept
orders.id (clientRef = referralUuid)
  ↓
order_tests → diagnostic_referral_items.care_order_test_id
  ↓
radiology_studies (order_id, accession_number, study_instance_uid)
  ↓
radiology_worklist (study_id, study_instance_uid, accession_number)  ← canonical reporting spine
  ↓
patient_reports (order_id, study_id, publicToken)
  ↓
external_result_links (care_report_id; care_study_id column exists but not populated on report emit)
  ↓
integration_outbox → HOPE callback
```

**Strongest deterministic linkage:** `diagnostic_referrals.care_order_id` ↔ `orders.id` ↔ `radiology_studies.order_id` ↔ `radiology_worklist.study_id`.

**Not primary:** patient name (matching uses UHID / `external_patient_links` in `patientMatching.ts`).

## 13. Existing final-report callback

**BUILT** on CARE — event `diagnostic_report.finalised`:

- PDF: `{PUBLIC_BASE_URL}/api/p/r/{token}/pdf`
- Report page: `{PUBLIC_BASE_URL}/p/r/{token}`
- Metadata: impression, report number, critical flag, `referralUuid`, `careOrderId`, `careReportId`
- **Does not include:** `StudyInstanceUID`, OHIF URL, key images, electronic film

See `emitReportToHope.ts`.

## 14. Existing image/study return functionality

What CARE **currently sends HOPE**:

| Payload | Event | Evidence |
|---------|-------|----------|
| StudyInstanceUID | `diagnostic_study.completed` | `statusReconciler.ts` |
| OHIF viewer URL | Same event | `ohifUrl: ${OHIF_URL}/viewer?StudyInstanceUIDs=...` |
| Accession, modality, `careStudyId` | Same | `statusReconciler.ts` |
| Final report PDF URL | `diagnostic_report.finalised` | `emitReportToHope.ts` |
| Full DICOM files | **No** | — |
| Selected/key images | **No** | Key images exist in CARE (`radiology_image_references`) but not in outbox |
| Electronic film artifact | **No** | — |
| PACS token beyond OHIF URL | **No** | — |

**Separate (not HOPE):** `boundary.ts` — federated radiology API for another consumer.

## 15. HOPE OPD imaging UI

**Not in CARE repo.** Reference doc points to HOPE `opd/[id].tsx` with `patient_documents`, `diagnostic_orders`.

CARE provides:

- `/hope-referrals` — staff **inbound** queue (not HOPE doctor OPD chart)
- `/radiology/open` — Hope deep-link **into CARE** (not HOPE-native viewer)

## 16. Authentication / security

| Path | Model |
|------|--------|
| HOPE → CARE inbound | Bearer `intgk_…` partner keys; audit log (`requireIntegrationPartnerAuth.ts`) |
| CARE → HOPE outbound | HMAC-SHA256 on `timestamp.body` (`outbox.ts`) |
| Public report PDF | Tokenized `/api/p/r/:token/pdf` |
| OHIF URL | StudyInstanceUID in query string — security depends on OHIF/network perimeter |
| Hope → CARE radiology open | `GET /api/internal/radiology/resolve-open` |

**Risk:** Raw OHIF URLs with UID in query string require network/OHIF perimeter controls. Prefer signed launch URLs or server-side resolve.

## 17. Missing links (HOPE imaging)

1. HOPE `care-callback` receiver implementation (if not deployed)
2. HOPE UI to surface `diagnostic_study.completed.studies[].ohifUrl` and report PDF from `diagnostic_report.finalised`
3. Electronic film attachment path (`patient_documents` or equivalent)
4. Optional: unify report callback with `StudyInstanceUID` / viewer link
5. Do **not** add DICOM instance storage in HOPE unless existing HOPE design requires it

---

# PART 3 — UNIFICATION

## 18. Can Electronic Film attach to the same CARE study?

**Not today.** No CARE entity stores film artifacts. **Conceptually yes** without new PACS:

- Canonical spine: `radiology_worklist` (+ `radiology_studies` for order/accession/UID)
- Link film via accession (if injected into print datasets), order/referral (if CARE assigns at capture), or time + PatientID + modality (weak)
- DicomToWindows does **not** currently capture AccessionNumber or StudyInstanceUID

## 19. HOPE actions: built vs missing

| Action | Status | Notes |
|--------|--------|-------|
| **View Images** (OHIF) | **PARTIAL** | `diagnostic_study.completed` carries `ohifUrl`; needs HOPE UI + network auth |
| **Electronic Film** | **MISSING** | No artifact in CARE or HOPE contract |
| **Radiology Report** | **BUILT** (CARE emit) | PDF URL on `diagnostic_report.finalised`; HOPE receiver required |

## 20. Reuse (do not rebuild)

| Layer | Reuse |
|-------|--------|
| DicomToWindows Print SCP | Keep — do not redesign |
| DicomToWindows PDF output | Keep — extend with CARE ingest + optional `CAPTURE_ONLY` |
| `diagnostic_referrals` + `external_patient_links` | Referral ↔ patient ↔ order |
| `radiology_worklist` / `radiology_studies` | Study spine + UID/accession |
| `integration_outbox` + HMAC | HOPE delivery |
| `external_result_links` | Idempotent result emission |
| `patient_reports` + public PDF tokens | Final report |
| `statusReconciler` | Study-completed + OHIF pattern |
| HOPE `patient_documents` (per docs) | Binary attachments — prefer over new DICOM store |
| `resolveRadiologyOpen` | Hope → CARE reporting (not film) |
| `PrintImagePicker` / print bridge | Separate workflow (CARE-initiated glossy print) |

## 21. Do NOT rebuild

- DicomToWindows SCP core
- Orthanc as authoritative PACS
- Full CARE ↔ HOPE referral/outbox architecture
- OHIF viewer stack
- Duplicate DICOM archive in HOPE
- New parallel reporting workspace

## 22. Smallest implementation plan (after audit)

**Recommended order:**

1. **HOPE callback + OPD UI for what already exists** — Land `diagnostic_study.completed` (OHIF link) and `diagnostic_report.finalised` (PDF) in HOPE `patient_documents` / diagnostic order UI. Zero DICOM duplication.

2. **DicomToWindows `CAPTURE_ONLY` + artifact URL** — Skip spool on failure; optional `GET /api/v1/print-jobs/{jobKey}/artifact` or push webhook with PDF path. Change in DicomToWindows only.

3. **CARE film ingest (minimal)** — Register PDF in existing object storage (`uploadFiles` / reports module), link on `radiology_worklist` or extend `radiology_film_issues` with `source=CARE_ELECTRONIC_FILM`, MIME, version.

4. **Outbox event** `diagnostic_electronic_film.available` (or extend `diagnostic_study.completed` with `electronicFilmUrl`) — HOPE stores one PDF per study in `patient_documents`.

5. **Accession/UID injection** — Optional MWL or print-job prep so DicomToWindows captures AccessionNumber.

6. **OHIF launch hardening** — Signed/short-lived viewer URLs; do not pass raw UID URLs to HOPE without server-side authorization.

---

## Acceptance scenario scorecard

| Step | Today |
|------|--------|
| 1. Full DICOM study only in Orthanc | **BUILT** |
| 2. DicomToWindows captures 12-image film | **BUILT** (if console prints to virtual printer) |
| 3. CARE links film to study/referral | **NOT BUILT** |
| 4. CARE sends **only** film artifact to HOPE | **NOT BUILT** |
| 5. HOPE stores on patient record | **DESIGNED** (`patient_documents` in docs); not verified in CARE repo |
| 6. HOPE OPD: open Electronic Film + Report | **PARTIAL** |
| 8. No DICOM duplication in HOPE | **Achievable** — current design does not require it |

---

## Key file index (CARE)

| Concern | Files |
|---------|-------|
| Inbound referral | `artifacts/api-server/src/routes/integration/inbound.ts`, `services/integration/referralIngest.ts` |
| Staff inbox | `artifacts/api-server/src/routes/integration/hopeReferrals.ts`, `artifacts/diagnostic-erp/src/pages/HopeReferrals.tsx` |
| Report → HOPE | `services/integration/emitReportToHope.ts`, `resultsEmitter.ts` |
| Study → HOPE | `services/integration/statusReconciler.ts` |
| Outbox | `services/integration/outbox.ts` |
| Deep-link resolve | `artifacts/api-server/src/lib/resolveRadiologyOpen.ts` |
| Print bridge (outbound) | `artifacts/api-server/src/routes/pacsEnterprise.ts`, `PrintImagePicker.tsx` |
| Integration docs | `docs/hope-care-integration/*.md` |

## Key file index (DicomToWindows)

| Concern | Files |
|---------|-------|
| DICOM Print SCP + lifecycle | `server.py` — `handle_create`, `handle_set`, `handle_action`, `handle_delete`, `handle_get` |
| Render + artifact | `process_print_job`, `render_page`, `save_pages` |
| HTTP print API | `_PrintBridgeHTTPHandler` — `/api/v1/health`, `/api/v1/print-jobs` |
| Config / ops | `README.md`, `docker-compose.yml`, `docker-entrypoint.sh` |

---

## Related documents

- [00_SUMMARY.md](./00_SUMMARY.md)
- [01_AUDIT.md](./01_AUDIT.md)
- [02_ARCHITECTURE.md](./02_ARCHITECTURE.md)
- [03_API_CONTRACT.md](./03_API_CONTRACT.md)
- [04_HOPE_ADAPTER_REFERENCE.md](./04_HOPE_ADAPTER_REFERENCE.md)

**External:** [DicomToWindows](https://github.com/DrAbinash/DicomToWindows)
