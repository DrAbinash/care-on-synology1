# 4. PACS · OHIF · Modality Audit

Scope: Orthanc deployment, the OHIF viewer and its CARE bridge, the modality worklist, and the D2 displayed-image identity feature. Repos: `care-pacs` HEAD `53588a0` (working tree) vs `origin/main` `d9a3eb9` (**D2's viewer code exists only on `origin/main`**), `care-on-synology1` HEAD `6dc1157b`. Live probes recorded 2026-10-11.

> **Read this first.** Three things are true at once and are easy to conflate:
> 1. the D2 code is **merged and tested**;
> 2. the deployed viewer image was **rebuilt 2026-10-10 from a pre-D2 ref**, so D2 is **not serving** (measured: `/care/care-displayed-image.js` → **404**, `/care/image/care-displayed-image-adapter.js` → **404**, while `care-bridge/care-chrome/care-config/care-security` all → 200);
> 3. even when rebuilt, **two of D2's three legs are unreachable from the product** (§4.5).
> So "D2 is dormant", not "D2 is broken".

---

## 4.1 Orthanc as deployed

| Fact | Value | Evidence | Live? |
|---|---|---|---|
| Version / AE title | **1.13.0**, `ORTHANC2`, name `CareDiagnostics` | `orthanc/config/orthanc.json:2-3` | **measured 200** |
| Ports | DICOM `4242→5680`, REST `8042→8042` | `docker-compose.yml:70-71` | **measured open** |
| Authentication | **disabled** (`AuthenticationEnabled:false`, `RemoteAccessAllowed:true`) | `orthanc.json:6-7` | **measured: QIDO with no credentials returned a JSON array containing PatientName tags (00100010), 3,284 bytes, no PHI printed** |
| DICOM ingest policy | `DicomAlwaysAllowStore:true`, `DicomCheckCalledAet:false` | `orthanc.json:13-14` | any AE title on the LAN may write studies into the archive |
| CORS | `Access-Control-Allow-Origin:*` | `orthanc.json:23-27` | any web page in a clinic browser can read the archive |
| Index / storage | PostgreSQL index plugin + `StorageDirectory=/var/lib/orthanc/db` → host bind `/volume1/docker/care-pacs/orthanc/data` | `orthanc.json:8-12,35-36`; `docker-compose.yml:60-73` | **measured** `DatabaseBackendPlugin: libOrthancPostgreSQLIndex.so` |
| DICOMweb | `/dicom-web/`, WADO `/wado`, `Ssl:false` | `orthanc.json:15-22` | exposed to the LAN through the OHIF origin, unauthenticated |
| MWL | folder `/var/lib/orthanc/worklists`, housekeeper **disabled** (`DeleteWorklistsOnStableStudy:false`, `Delay:0`) | `orthanc.json:28-34` | deliberate — see §4.3 |
| Scale today | **2,441 patients · 2,466 studies · 8,999 series · 216,624 instances · 134,921 MB** | `/statistics` | measured |
| Peers configured | MRI `UIH@172.16.1.103:3333`, CT `ct99@172.16.1.99:4006`, US `Voluson@172.16.1.46:104`, `XRAY_1..4 FILMPLUS` ×4, 2 Weasis SCUs | `orthanc.json:37-83` | the `172.16.1.x` net **does not answer from this box** |

**Two Orthanc addresses are configured.** The NAS answers on `192.168.1.137:8042`; CARE's `deploy/synology/care.env:60` points `ORTHANC_URL=http://172.16.1.139:8042`. From this machine only the NAS answers. Whether `172.16.1.139` is the same Orthanc dual-homed, a second archive, or a stale address **cannot be determined from this box** and decides whether the ERP can see the images at all. One command settles it (§4.7).

**Retention.** `orthanc-retention` runs every 300 s with keep 500 / trigger 520 / min age 60 min, but **pulls its policy from the ERP every cycle and sleeps if auto-retention is off** (`orthanc_retention.py:75,227`; `routes/internal-radiology.ts:2612-2632`). When it does delete, `orthancPurge.ts:293` deletes the `radiology_worklist` **row** and nulls `radiology_studies.study_instance_uid` / `pacs_instance_id` (`:329-338`), so a released report loses the ability to re-open its images (the viewer launches by StudyUID over DICOMweb, `pacsConfig.ts:185`). Deletions are recorded only in the container log; `purge-reconcile` failure is logged and ignored (`orthanc_retention.py:114`). Frozen key images survive only because they are **files on the `uploads_data` volume** — which a `pg_dump` backup does not cover (`docker-compose.yml:419-423`).

**Secrets.** `ERP_INTERNAL_API_KEY: ${ERP_INTERNAL_API_KEY:-1234}` (`care-pacs/docker-compose.yml:165`) and the same literal in the sync script (`care_erp_sync.py:46`). CARE's own `INTERNAL_API_KEY` **is** defined in `deploy/synology/care.env` (value not read here), so if the PACS side was never given the matching value, intake calls authenticate with `1234` and are rejected — silently, from the sidecar's point of view.

## 4.2 Modality worklist (MWL)

Mechanism, end to end: `routes/radiology.ts:90-97` (department→modality map) → `:203 nextAccessionNumber` → `INSERT radiology_studies` → `:245 publishRadiologyStudyToMwl` → `lib/pacs/publishRadiologyStudyToMwl.ts:107-164` (upsert `radiology_scheduled_procedures`) → `:200 writeWorklistFile` → `mwlWorklistWriter.ts:201-238 buildDump()` → `:330-406 publishWorklistAtomically` (`dump2dcm` into `staging/`, re-validate with `dcmdump`, `rename()` to `ACC.wl`). Orthanc's worklists plugin serves it as a **real DIMSE MWL SCP** (SOP class `1.2.840.10008.5.1.4.31`).

So it is a genuine, standards-based MWL — not a HTTP hack — but it is **file-drop coupled**, and it is entirely inert unless `ORTHANC_WORKLIST_DIR` is set (`mwlWorklistWriter.ts:65-72`).

| MWL key | Source | Populated |
|---|---|---|
| PatientID `(0010,0020)` | `patients.patient_id` (UHID), fallback numeric id | yes |
| PatientName `(0010,0010)` | `Family^Given`; literal `"ANONYMOUS"` if blank | yes |
| AccessionNumber `(0008,0050)/(0040,1001)/(0040,0009)` | `radiology_studies.accession_number` | yes |
| Study/Series/SOP UIDs | **synthetic**, `1.2.840.9999.113.1.<sha256(accession)>` (`:37,174-184`) | yes — but the UID CARE suggested is not necessarily the UID the scanner acquires |
| Modality `(0080,0060)` in SPS | map MRI→MR, CT→CT, USG→US, X-Ray→CR, MG→MG, DEXA→BMD; **`"OT"` when null** | yes |
| **ScheduledStationAETitle `(0040,0001)`** | `resolveScheduledStationAeTitle` from the `dicom_modalities` registry | **EMPTY for everything except the Voluson**, whose row is seeded at boot (`index.ts:541-543`). The code deliberately never invents `"ANY"` |
| PatientAge | computed and stored in the DB | **never written into the dump** — no `(0010,1010)` tag at all |
| Priority `(0040,0006)`, SPS end time, Requested-Procedure code sequence | — | absent |
| `(0040,1400)` | free text `CARE-BILL:… \| CARE-ORDER:… \| CARE-ACC:…` | the standard calls this *Codes for Requested Procedure*; consoles differ in how they treat it |

**Consequence.** A scanner that filters its worklist query on its own AE title — which most do — receives **an empty list for MRI, CT and X-ray**, because `(0040,0001)` is empty and the query match fails. The radiologist never learns this: the worklist was simply never asked for. This is MWL-1 in the roadmap and it is the highest-value, cheapest fix in the PACS layer.

**No accession ⇒ nothing is published**, silently (`mwlWorklistWriter.ts:412`; `publishRadiologyStudyToMwl.ts:75`).

**The housekeeper crash.** The recorded premise ("a malformed `.wl` kills Orthanc while parsing") is **not** what the fix addressed. The real defect: the `orthanc-worklists` housekeeper thread calls `DeleteWorklist()`, which throws `ErrorCode_UnknownResource` when ERP has already removed or unlinked the file, and there is no try/catch in that thread → `std::terminate` → SIGSEGV, repeated, masked by `restart: unless-stopped`. The fix disables the housekeeper outright (`orthanc.json:32-33`). The **cost** of that fix: nothing prunes the folder now, so stale `.wl` files accumulate and are re-read on every C-FIND; `care-pacs/tools/prune_stale_worklists.sh` exists as a manual dry-run-first remedy. (`DeleteWorklistsDelay` is inert because the writer re-stamps createdAt.)

## 4.3 Ingestion paths — six ways to move a study, two of them live

| # | Path | Trigger | Keys on | Writes | Live as deployed? |
|---|---|---|---|---|---|
| 1 | `care-erp-sync` sidecar | 60 s, `/changes` watermark | UID primary, accession fallback | `radiology_worklist`, `radiology_studies.status/acquired_at` | **yes** — the only intended path |
| 2 | ERP in-process `orthancChangesPoller` | 20 s, same `/changes`, POSTs to `127.0.0.1` | same, but `aeTitle:"ORTHANC"` (not `ORTHANC2`) and skips USG when the pipeline is off | same + `pacs_logs` | **no** — `deploy/synology/care.env:73 ORTHANC_CHANGES_POLLER=false`, because a NAS container cannot hairpin to a published host port across compose projects |
| 3 | `POST /radiology/orthanc-webhook` (Lua hook) | intended Orthanc callback | Orthanc id | — | **dead**: `orthanc/scripts/auto_pull.lua` is print-only |
| 4 | `orthanc-puller` (Q/R) | 300 s, StudyDate ≥ today−1 | StudyInstanceUID | into Orthanc only | MRI+CT enabled; **all four X-ray peers `enabled: False`** (`orthanc_auto_puller.py:43-46`) |
| 5 | ERP DIMSE agent + `dicom_pull_jobs` | cron `*/5`, flag `ENABLE_DICOM_PULL_AGENT` | node AE title | `dicom_*` tables | **cannot run** — the flag appears in no compose/env file, and its C-MOVE destination defaults to `CONQUESTPACS`, not `ORTHANC2` (`dimse-agent.ts:496`) |
| 6 | `STAMP_ACCESSION_FROM_BILL` | bill creation | name+date+modality | writes AccessionNumber **into Orthanc** | default off, single-hit only, USG-scoped |

Paths 1 and 2 are the same job implemented twice with **different AE titles and different USG behaviour**; running both double-intakes (`care_erp_syncV3.py:26-28` says "Run ONE"). `care_erp_syncV2.py`/`V3.py` are dead code beside the one compose starts.

**Matching behaviour today** (`routes/internal-radiology.ts`):
* *In Orthanc, not in ERP* → 6-tier intake cascade (`:606-722`); no match leaves a worklist row with `study_id NULL`, `patient_id NULL`, `patient_match_status UNMATCHED`, `match_score RED`. It **never auto-creates a patient** (`:549-583`) — correct.
* *In ERP, not in Orthanc* → visible only as `billedNotInPacs` in a summary and a 404 on `resolve-open`.
* *No accession* → row persists `""` (`:486-490`); matched by UID or USG-today heuristics.
* *Wrong demographics, correct accession* → `NAME_MISMATCH`, informational only; a modality mismatch stays RED.
* *Retransmission* → the UID upsert **overwrites** patientName/sex/modality/dicomMetadata with the latest push, except an APPROVED patient link (`:839-846`).
* *Partial transfer* → no concept of completeness anywhere; a study arrives when its first stable-series `/changes` event fires.
* **DICOM `PatientID` is stored and deliberately unused** for identity (`studyUidBinding.ts:30-35`: the Orthanc search never queries or returns it). The clinic's measured unlinkability crisis (Oct census: 8,649 unlinked rows, ~90 % with no accession) therefore has an unused candidate key sitting in the same row.

## 4.4 OHIF build and the CARE bridge

* **Pin**: OHIF `v3.10.0` @ `0b6e9cba`, single-commit fetch with a SHA assert (`ohif/enterprise/Dockerfile:21-28`). Three patches: `0001` expose `window.__CARE_OHIF__` (changed from a bundle-time snapshot to a live `Object.defineProperty` getter by `d9a3eb9`), `0002` hanging-protocol registration, `0003` a `@cornerstonejs/tools` StackScrollTool fix asserted by grep.
* **Injection**: `yarn build` → injector → build metadata. The old injector anchored on the line containing `</body>` and landed inside script data (PR #13's defect: only `care-security.js` died, everything else looked fine); `origin/main` replaced it with a tokenizer and a gate re-read of the emitted bytes, and fail-closed greps in the Dockerfile.
* **Runtime config**: `care/care-config.js` is bind-mounted `:ro` from the host, so the **origin allowlist can change without rebuilding OHIF**. Its default is **empty** — and an empty allowlist makes every `postMessage` reply fail closed, silently, with no error surfaced in the ERP.
* **Transport**: all bridge scripts use `postMessage` to `window.parent/opener`; the ERP listener accepts `source === "care-ohif"` only (`ohifViewerBridge.ts:122,424-436`).

**Four dead or self-confirming legs** (each verified by absence, not opinion):
1. `care-bridge.js` answers `care.viewer.requestContext` with a `care.viewer.context` message that has **no `source` field and no ERP listener** — the whole URL-context channel is unread.
2. `care-measurement.js` dispatches `care:measurement` **on the viewer's own window** — no ERP listener for that name.
3. The ERP sends `viewport-capture-request` and toasts *"Annotated capture requested"* on its own send; **no responder exists anywhere in `origin/main` OHIF** (git grep: 0 hits). Success is reported from the request, not from the viewer.
4. `ohifUnavailable` is computed as `!launchUrl` where `launchUrl` is a string CARE wrote to `localStorage` itself — the viewer's existence is "proved" by CARE's own write.

## 4.5 D2: the eight hops, and where the chain breaks

| Hop | Status | Evidence |
|---|---|---|
| a. CARE builds and opens the viewer URL | code-complete | `studyLaunchService.ts:514-533`; 409 `OHIF_STUDY_MISMATCH` guard `:673-677` |
| b. OHIF loads the study | working | image-baked `app-config.js` → `/dicom-web` → nginx → Orthanc |
| c. Radiologist selects/captures | **broken in the product** | no D2 feature flag exists; the Frames box is blank (below) |
| d. Viewport identity (Study/Series/SOP/frame) | code-complete, **unreachable** | `care-displayed-image.js` + adapter read `getActiveViewportId → getCurrentImageId`; frame only from `/frames/N` or `?frame=`, never defaulted |
| e. Transfer to ERP | code-complete, **never invoked** | `requestFreshDisplayedAnchor` is defined and exported but has **zero callers**; the shipped bundle contains the string **exactly once**, as its own return property (measured in `dist/public/assets/RadiologyReportingWorkspace-*.js`) |
| f. Verify against Orthanc | code-complete + tested | QIDO `studies/{S}/series/{SE}/instances?00080018={I}` with re-check of `0020000D/0020000E/00080018`; 200-empty ⇒ `contradicted` ⇒ 409 `IMAGE_SOP_NOT_IN_STUDY`; unreachable ⇒ `IMAGE_PACS_UNREACHABLE` and the identity is dropped while the artefact is kept |
| g. Persist | code-complete | `radiology_image_references.study/series/sop_instance_uid, frame_number, presentation_json` in a tx with an advisory lock |
| h. Reopen | code-complete | token-bearing thumbnail URLs, grant re-mint once then blank |

**D-1 — the Frames box is blank, and it also kills the only working capture.** `EmbeddedWadoViewer.tsx:435-441` preloads the frame with `withDicomWebAuth(url)` but the `onload` handler stores the **token-less** URL (`setFrameUrl(url)`, `:438`), which is what renders as `<img src>` (`:950-956`). Raw `<img>` on that path 401s. Because the *preload* succeeded, `loadingFrames` clears and `frameUrl` is truthy, so the capture button is enabled — and `captureFramesKeyImage` then dies on `!img.complete || !img.naturalWidth` (`:490`). Two sibling components do it correctly (`ReportImagePanel.tsx:221`, `PrintImagePicker.tsx:369`), which is what makes this a one-line defect rather than a design problem.
**D-2 — no way to ask the viewer what is on screen.** `requestFreshDisplayedAnchor` has no consumer (`useWorkspaceClinicalUi.tsx:2528-2534` destructures five other members and not this one). So no OHIF-derived SOP can ever reach `activeAnchor`.
**D-3 — no responder for annotated capture** (§4.4 item 3).
Also open: `allowlist` empty by default in both the baked and mounted config (§4.4); the measurement path still defaults `frameNumber` to 1 in two tables (`radiologyLesions.ts:130`, `usgMeasurements.ts:163-166`) while D2 refuses to guess a frame; the ERP's Frames list selects an **instance**, so cine/ECG loops reopen at frame 0.

**What is true of the pixels that get stored:** the record image is a **derivative**, not the DICOM frame — sharp-rescaled JPEG, max edge 1800 px, quality 85 (`frozenKeyImages.ts:31-33`), with whatever window/level and on-screen annotation the browser had at capture time burned in. Good enough for "which image I meant"; wrong for anything quantitative (mammography density, HU, caliper measurements).

## 4.6 Modality status (honest labels)

| Modality | Label | Basis |
|---|---|---|
| Ultrasound (GE Voluson E9) | **FULLY INTEGRATED** | remote peer; seeded `dicom_modalities` row with `auto_send_enabled`, watch folder and non-DICOM import; DICOM SR biometry extraction; cine/multi-frame handling with a frame count that is never fabricated; PCPNDT finalize guard; accession-less return paths special-cased; USG is the **only** modality whose bill auto-link runs at intake |
| MRI (UIH) | **PARTIALLY INTEGRATED** | peer + 300 s Q/R pull + a 10-min study warmer; **MWL AE unregistered** ⇒ empty console worklist; arrival depends on the scanner pushing or the puller finding it |
| CT (`ct99`) | **PARTIALLY INTEGRATED** | as MRI. No CT dose-report (RDSR/GSPS) handling anywhere — grep for `CTDI`/`RadiationDose` returns nothing |
| DR / CR (4× `FILMPLUS`) | **MANUALLY OPERATED** | four peers defined but **all `enabled: False`** in the puller; push-only; device capability unverifiable from here |
| Mammography | **NOT INTEGRATED** | only a name→`MG` mapping and a matching bucket. No peer, no registry row, no breast identifiers (laterality/view/compression/BI-RADS/tissue density) anywhere |
| Non-DICOM / paper | **PARTIAL, not auditable** | the electronic-film deliverable ships as `.zip`/`.bundle` with no source in the repo; `scan-bridge` is a **document** scanner feeding Form-F OCR, not imaging; two rival pull agents exist (`desktop/pull-agent`, `artifacts/local-dicom-bridge`) with no compose service |

## 4.7 Confirm with these (read-only, on the NAS or a clinic PC)

```
curl -s -m 5 http://172.16.1.139:8042/system | head -c 200
docker inspect -f '{{.Created}} {{.Config.Image}}' care-ohif
docker exec care-ohif sh -c 'ls /usr/share/nginx/html/care/'
docker exec care-ohif sh -c 'grep -c displayed-image /usr/share/nginx/html/index.html'
ls -1 /volume1/docker/care-pacs/orthanc/worklists | wc -l
ls -1t /volume1/docker/care-pacs/orthanc/worklists-bad | head -5
docker logs --tail 40 care-pacs-care-erp-sync-1 2>&1 | tail -20
grep -c ERP_INTERNAL_API_KEY /volume1/docker/care-pacs/.env
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select key,value from pacs_settings where key ilike %retention% or key ilike %orthanc_url%"'
docker exec care-api sh -c 'ls /app/data/uploads/radiology-key-images | wc -l'
```
