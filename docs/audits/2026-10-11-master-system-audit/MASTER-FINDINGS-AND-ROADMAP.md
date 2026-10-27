# 6 · Master findings and roadmap
**Executive summary of the READ-ONLY master audit of CARE ERP + CARE PACS + HOPE ERP + AI Composer + Radiology Workspace, 2026-10-11.**

Supporting detail: `SYSTEM-ARCHITECTURE-AUDIT.md`, `RADIOLOGY-WORKSPACE-AUDIT.md`, `AI-COMPOSER-AUDIT.md`, `PACS-OHIF-MODALITY-AUDIT.md`, `BILLING-REPORT-LIFECYCLE-AUDIT.md`. Every finding below is demonstrated by code or by a measurement taken this session; speculative items were dropped.

---

## 1. The eight answers

**1. What exactly have we built?**
A pnpm-monorepo diagnostic ERP (Express 5 + Drizzle/Postgres + a Vite React staff SPA + a public clinic site) with a genuinely complete billing/accounting core (2,251-line double-entry accounting, day close, GST/TDS/bank reconciliation, seven payment-gateway adapters), a real radiology RIS (registration → order → bill → accession → MWL → worklist → draft → sign → PDF → deliver), an in-process scheduler running ~35 jobs, an OHIF viewer deployment with seven custom bridge scripts on top of Orthanc 1.13 holding 2,466 studies / 216,624 instances, and an AI report Composer with a real safety envelope (server-verified study identity, two-phase durable apply with compare-and-set, deterministic output validation, unreviewed-AI finalize guard). Plus a separate hospital ERP (HOPE) with OPD/IPD/OT/pharmacy/accounting/HR.
That is a lot, and most of it is real. What it is **not** yet is a fast radiology reporting tool: the reporting chain still has to be *proven* end-to-end, and three of its four AI capabilities are unreachable.

**2. How is it connected?** See the Mermaid map in `SYSTEM-ARCHITECTURE-AUDIT.md §F`. One database per system, HTTP at every boundary, identifiers crossing as: `bill_id`/`order_test_id` (soft, no FK) inside CARE; `StudyInstanceUID` then `AccessionNumber` to PACS; `referralUuid` to HOPE.

**3. Which integrations genuinely work?** Measured or executed:
* Orthanc archive + DICOMweb answering, PostgreSQL-indexed, 134 GB.
* The OHIF viewer serving and loading studies (`/healthz` 200, image baked to `/dicom-web`).
* The local AI path **through CARE's own composer, on the clinic server** — `gemma3:12b` produced a structured draft of a synthetic lumbar study in 38 s, keeping every typed level and laterality and inventing no measurement, three runs out of three; `medgemma1.5:4b` did the same in 8.3 s (**[TESTED]**, `RUN_LIVE_OLLAMA=1`).
* The OCR worker (`:8090/health` 200), HOPE's API (`businessDate` = today).
* USG: the only modality with a complete path (seeded registry row, SR extraction, cine handling, PCPNDT gate, auto-link at intake).
* The billing→PDF→WhatsApp path has request-level tests and a hash-chained audit log; those are **[TESTED]**, not **[RUNNING]** (the ERP was 502 throughout this audit).

**4. What is incomplete or disconnected?** The whole list is in §3 below. The three that matter most: **D2's viewer leg is not deployed at all** (two 404s measured on the live viewer); **cloud AI cannot be reached by the Composer** (the flag that allows image egress is never set in production code); **prior-report comparison does not exist** — `comparison:{has_prior:false}` is hardcoded (`radiologyD1DraftWriter.ts:217`) and the Composer snapshot has no age, sex or prior-study field at all.

**5. How good is the current reporting workspace?**
Structurally sound, behaviourally mediocre, and **self-misleading in places**. Identity protections are real (cross-patient draft hydration refused, finalize re-asserts identity after awaits, study locks, cross-study undo refused). But: the editor is five plain textareas with **no rich-text authoring** (bold/underline are generated at render, so he cannot emphasise one specific sentence); accession and StudyUID are **not shown anywhere near the editor**; demographics and study details sit in a strip that **auto-collapses the moment he starts typing findings**, and demography edits are never persisted; **eight** shipped assistance regions are gated behind literal `{false && (` including the one-click *Start Report* and the whole MRI anatomy/canvas/ledger block — while the rail still describes them as present; *Print* **disappears once a report is signed**; `Park` is `localStorage`-only, so it is invisible from another workstation; there is **no amendment route reachable from the UI**; and typing in the queue search fires a 1,000-row DB query **plus a live archive C-FIND per keystroke** without filtering the visible list. A cold open is ≥19 requests, a finalize 8–9 **sequential** ones. **No performance number exists anywhere in the repo** — the 18–20 min/study figure in the old UX review is explicitly labelled estimated and superseded.

**6. What prevents CARE AI from generating reports comparable to ChatGPT?**
Not the model tier (a 12 B local model already preserves the clinical truth). Five specific, provable things:
1. **The AI is asked to return three flat strings** (`persona/master.ts:51-57`), so it cannot emit structure — no headings, no measurement table, no level blocks — even though the renderer supports all three. Templates promise `| Level | AP Canal (mm) |` that no model output can fill.
2. **It is told nothing about the patient**: no age, no sex, no priors, no protocol, no comparison — and differentials are *forbidden* by the style prompt (`style.ts:19`).
3. **Dictated measurements don't become tables.** `SpineCanalApBox` inserts a **tab-separated** text block that the document parser reads as one paragraph, and the function that *does* build a table (`canalApTableHtml`) has no production caller. A table appears only if numbers are entered through the measurement UI.
4. **Refinement is given a truncated draft** (findings 1,200 chars, impression 600, first 12 observations) — so "preserve all findings" is not achievable by construction, and dropped measurements are only *advisory* in validation.
5. **Cloud models are unreachable from the Composer** while every cloud row is flagged `experimental:true, phiEligible:false`, so there is no measured cloud-quality evidence at all.

**7. Simplest way to fix those?** Four small changes, no new infrastructure: (a) extend the JSON contract to structured sections; (b) add age/sex/prior-report text into the snapshot and the prompt; (c) make dictated measurements render as a real table; (d) give refinement the whole draft and make **measurement/level conservation** a blocking validation rule rather than an advisory. Then, separately, open one cloud provider with `max_tokens` + usage capture.

**8. What should we build next to save the most reporting time?** In this order: **prior-study comparison** (largest per-case saving, currently absent), **one-click Start Report** (already written, just gated off), **measurement-table rendering**, **full-draft refinement**, **identity strip that stays open**, and **MWL AE-title registration** so MRI/CT/X-ray consoles actually receive their worklists.

---

## 2. Status matrix

| Capability | Label | Basis |
|---|---|---|
| Patient registration, UHID, orders, billing, discounts, accounting, day close | **WORKING** | ~11 k tests this week; request-level tests against real Postgres; in daily use at the centre |
| Orthanc archive, DICOMweb, viewer serving | **WORKING** | measured live |
| USG integration (push, SR, cine, PCPNDT, auto-link) | **WORKING** | code + the only seeded modality registry row |
| Local AI MRI drafting through the Composer | **WORKING** | **but only after the operator turns Local/LAN mode ON**; measured 3/3 on `gemma3:12b` |
| MedGemma / qwen3-vl as image models | **IMPLEMENTED, NOT VERIFIED** (qwen3-vl:8b: **BROKEN** — `empty_model_response` on all three live runs) |
| Overnight shadow AI draft | **IMPLEMENTED, NOT VERIFIED** | its queue drains always-on, but `ff_radiology_ai` / `ai_modality_policies.mode='disabled'` defaults make it inert until an admin acts |
| Report refinement (`/polish`) | **PARTIALLY WORKING** → effectively **BROKEN from the UI** | route exists and is validated, **the only component that calls it is never imported** |
| Professional full-report structure (tables/headings) | **PARTIALLY WORKING** | renderer supports it, AI contract cannot emit it |
| Provider-fallback screen | **BROKEN** | page routed, POSTs to `/api/ai-reporting/fallback-chain`, **no such server route** |
| D2 displayed-image identity | **PARTIALLY WORKING** / **BROKEN in product** | verify+persist+reopen code-complete and tested; **not deployed** (two 404s), and three legs unreachable (D-1 blank Frames box, D-2 zero callers, D-3 no responder) |
| Selected-image AI, **local** | **IMPLEMENTED, NOT VERIFIED** | reachable in code; needs ≥1 frozen key image, which needs the broken capture path |
| Selected-image AI, **cloud** | **BROKEN (by design, today)** | `cloudVisionAllowed` never set (`jobService.ts:432`) — a second seam (#910) is still a draft PR |
| Image de-identification before cloud egress | **NOT WIRED** | the checker is correct and tested; **zero non-test callers** |
| Orthanc→ERP intake | **IMPLEMENTED, NOT VERIFIED** | single Python sidecar; ERP 502 prevented observation; cursor/last-success unknown |
| MWL to scanners | **PARTIALLY WORKING** | real DICOM MWL, but `(0040,0001)` empty for MRI/CT/CR/MG and a silent no-op without accession |
| MRI / CT ingest | **PARTIALLY WORKING** | push + 300 s Q/R; console behaviour unverifiable from here |
| X-ray/CR | **MANUALLY OPERATED** | four peers defined, all `enabled: False` in the puller |
| Mammography | **NOT IMPLEMENTED** | a name mapping only; no peer, no breast identifiers |
| DIMSE pull agent + stall watchdog | **BROKEN (inert as deployed)** | enabling flag exists in **no** compose/env file; watchdog early-returns |
| Gateway refund at the provider | **BROKEN** | implemented on 7 providers, **zero call sites**; a negative row is booked instead |
| Online-payment reconciliation sweep | **BROKEN** | compares `BILLPAY-<id>`/`BILLPAY-<id>-` against `BILLPAY-<id>-HEX`; third arm is `balance > 0` |
| Public bill-verification page | **BROKEN** | `limit(1)` on a non-unique-per-table bill number, bypassing the ambiguity guard |
| Report amendment (medico-legal correction) | **BROKEN** | superseding row is created **without a status** → old PDF keeps serving; and **no UI caller** |
| Structured finalization status | **BROKEN** | signed row stays `draft` → invisible to portal, delivery tracking and the HOPE emitter |
| CARE↔HOPE referral + report callback | **IMPLEMENTED BOTH SIDES, NOT VERIFIED, DARK BY DEFAULT** | off in both envs, placeholder secrets in the deploy env, `ff_hope_care_referrals` seeded false |
| Backups | **PARTIALLY WORKING** | `pg_dump` + dead-man + restore verification exist, but the **uploads volume holding frozen key images is not in it** and retention unlink is inside `catch {}` |
| Critical-result communication | **PARTIALLY WORKING** | browser-only detector, flag off by default, notification route **records only — nothing is sent**; can sign with `is_critical=false` after the UI detected "acute infarct" |
| `super-admin-portal` | **UNKNOWN** — surface live, source unbuilt | `nginx.conf:189`, `app.ts:341` |
| Staff report-by-id read (`GET /api/patient-reports/:id`) | **PARTIALLY WORKING (access-control gap)** | permission-gated only; **no patient/entity/branch predicate** |
| Cloud AI cost measurement | **NOT IMPLEMENTED** | usage read then discarded; no column; `/test` hard-codes null; pricing rows say "placeholder" |

---

## 3. Prioritised roadmap

### P0 — demonstrated clinical or data-integrity defects

| # | Problem | Evidence | Minimal change | Clinical benefit | Size | Depends on | Downtime / migration |
|---|---|---|---|---|---|---|---|
| **P0-1** | **The production ERP answers 502 on every route while PACS, HOPE, the viewer and the AI PC are all healthy.** Nobody can register, bill or report. | measured ×3 this session; `:8888` refused; `Server: cloudflare` | diagnosis, not code: `docker ps`, `docker logs care-web`, `docker logs care-api`, `curl 127.0.0.1:8080/health` **inside** the network. Note `ICICI_*` are `:?`-required — a missing gateway secret stops the whole ERP | the clinic works | SMALL | operator's NAS shell | none until cause is known |
| **P0-2** | **Orthanc is read *and write* accessible to anything on the LAN, with CORS `*` and no AE check** | `orthanc.json:6-14,23-27`; measured 200 QIDO returning PatientName; `default.conf:41-47` | enable Orthanc auth, bind 8042 to the OHIF container network only, keep DICOM 5680 open for modalities, set an explicit `Access-Control-Allow-Origin` | patient-data confidentiality; no anonymous store/delete | SMALL | OHIF proxy config, ERP + puller credentials | restart Orthanc (minutes) |
| **P0-3** | **`patient_reports.study_id` means two different id spaces** and the resolver tries the wrong one first | `patientReports.ts:26-28` vs `radiologyReportGenerator.ts:19`; `radiologyIdentity.ts:63-74`; the two sequences collide **by design** | bind the composer/finalize path to `radiology_worklist.id` only (the pattern PR #905 already established) and stop the id fallback | removes wrong-study/wrong-patient attribution | MEDIUM | P0-1 to verify live rows | none |
| **P0-4** | **A structured-finalized report stays `status='draft'`** while being treated as signed | `patient-reports.ts:1147-1171` sets `signedAt`, never `status`; filters at `:3467,:3530`, `patientPortal.ts:54`, `resultsEmitter.ts:48` | set the status inside the same transaction (or derive deliverability from `signedAt` + verify state) | signed reports actually reach the patient, delivery tracking and HOPE | SMALL | — | backfill existing rows (data script, `care-migrate` profile) |
| **P0-5** | **An amendment produces an undeliverable draft, so the superseded PDF keeps serving** | `patient-reports.ts:1803-1828` (no status); `radiologyReportVersion.ts:333-342` → `latest_not_deliverable` | same fix as P0-4, plus give the amended row its own deliverability and stamp `report_shares` on the new row | a corrected report replaces the wrong one everywhere | SMALL | P0-4 | none |
| **P0-6** | **No correction path is reachable by the radiologist** | `POST /:id/amend` has **no frontend caller**; `signedReportCorrectionTruth.test.ts:211` even forbids promising "Amend" | wire one button to the existing endpoint (USG already does exactly this) | he can fix a released report without an admin | SMALL | P0-5 | none |
| **P0-7** | **Online refunds never leave the gateway** — the ledger says refunded, the patient's bank says otherwise | `refundPayment` implemented ×7, **0 route call sites**; `bills.ts:2090-2251` writes a negative row | either call the provider's refund in the same transaction boundary as the negative row, or make the UI say "recorded as credit, not returned" | money integrity + trust | MEDIUM | gateway creds live | none |
| **P0-8** | **The public bill-verification page can show the wrong bill** | `verify.ts:25-44` `eq(billNumber).limit(1)`; bill numbers unique **per ledger** since #790; `billByNumber.ts:19-40` refuses on ambiguity and is bypassed | use `billByNumber` and refuse on ambiguity; require the `hash` the page already reads | no cross-patient PHI disclosure | SMALL | — | none |
| **P0-9** | **The missed-payment sweep can never match its own references** | `gateway-webhooks.ts:714-719` (`Set.has` exact, `BILLPAY-<id>-` vs `BILLPAY-<id>-HEX`, third arm `balance>0`) | match by prefix properly (or store the ref on the bill) and drop the `balance>0` arm | unpaid online bills become findable | SMALL | — | none |
| **P0-10** | **Two different Orthanc addresses in use.** `care.env:60` = `172.16.1.139:8042`; the archive answering is `192.168.1.137:8042` | measured; and the D2 verify path reads this same setting | confirm which host is authoritative; make `ORTHANC_INTERNAL_URL` (containers) vs `ORTHANC_URL` (browser) explicit | removes a whole class of "PACS unreachable" false alarms | SMALL | P0-1 | env restart only |

### P1 — reporting quality and workflow

| # | Problem | Evidence | Minimal change | Benefit | Size | Migration/downtime |
|---|---|---|---|---|---|---|
| P1-1 | AI output is three flat strings — no structure, no tables | `master.ts:51-57` vs `findingsDocument.ts:76-89` + `radiologyReportPreviewHtml.ts:205` | add `sections[]`/`tables[]` to the JSON contract; feed the existing renderer | the report looks like a radiologist wrote it | MEDIUM | no |
| P1-2 | No age, sex, prior studies or prior reports in the prompt; `has_prior:false` hardcoded | `types.ts:71-136`; `radiologyD1DraftWriter.ts:217`; the Priors panel exists but AI never sees it | add three snapshot fields + one "COMPARISON" block | biggest single per-case time saving | MEDIUM | no |
| P1-3 | Dictated canal measurements never become a table; the table helper is dead code | `SpineCanalApBox.tsx:377-385`, `spineCanalAp.ts:226-271` | parse `Canal AP …` into rows at insert time; call `canalApTableHtml` | no manual table building | SMALL | no |
| P1-4 | Refinement receives a truncated draft; dropped measurements are advisory only | `composeEngine.ts:60-83`, `validateOutput.ts:428-431` | send the full draft + make measurement/level **conservation** blocking | "preserve all findings" becomes true | SMALL | no |
| P1-5 | `/polish` unreachable — its only caller is never imported | `aiReporting.ts:1565`, `RadiologyAICopilotPanel.tsx:770` (0 importers) | mount the panel, or move Refine into the Composer rail | refinement he can actually click | SMALL | no |
| P1-6 | **Cloud AI is unusable as the primary engine**: no `max_tokens`, no usage/cost capture, `isEnabled` ignored, unknown provider silently → `ollama`, no cross-provider fallback, no cloud token pre-flight | `openAiCompatible.ts:161`, `composeEngine.ts:43-52`, `aiReportComposer.ts:39-97`, `resolveComposerProvider.ts:19-31`, `composeEngine.ts:507,533` | the ordered list in `AI-COMPOSER-AUDIT.md §3.11` items 1–7 | predictable, attributable, affordable cloud drafting | MEDIUM | one nullable column for usage/provider |
| P1-7 | Cloud images blocked (correctly) but the de-id checker is wired to nothing; the allowlist that gates the viewer is empty by default | `imageDeidentification.ts:319` (0 non-test callers), `jobService.ts:432`, `app-config.js:247` | finish PR #910's seam (verify-then-send the *same* list), then one admin consent toggle | image-assisted reporting with identity actually removed | MEDIUM | no |
| P1-8 | D2's three dead legs + not deployed | `EmbeddedWadoViewer.tsx:438` (token-less `setFrameUrl`), `useWorkspaceClinicalUi.tsx:2528` (no caller), `viewport-capture-request` no responder; two 404s measured | the fixes in `PACS-OHIF-MODALITY-AUDIT.md §4.5`, then rebuild `care-ohif` | what he sees is what gets stored | MEDIUM | OHIF rebuild |
| P1-9 | 8 `{false && (` assistance regions; rail claims they exist | `ReportCanvas.tsx:772,804,1016,1431,1579`, `ViewerColumn.tsx:627`, `WorkspaceOverlays.tsx:482` | decide each: re-enable or delete the description; **Start Report** is the one worth switching back on | fewer manual steps per case | SMALL | no |
| P1-10 | Identity hidden while reporting; demography edits lost; accession/UID nowhere; Print vanishes after signing | `useReportSectionChrome.ts:56,99-102`; `useDraftPersistence.ts:462-526`; `ReportExportPanel.tsx:39-43` | keep the identity strip open, persist overrides, show accession+UID, keep Print | safety + minutes per case | SMALL | no |
| P1-11 | Search floods the network per keystroke; finalize does 8–9 sequential calls | `useWorkspaceClinicalUi.tsx:649,735`, `radiology.ts:674`, `useStudyFinalize.ts:167-267` | debounce, filter the visible list, `Promise.all` the three independent finalize calls | measurable latency, no risk | SMALL | no |
| P1-12 | MWL sends no `ScheduledStationAETitle` for MRI/CT/CR/MG | `resolveScheduledStationAeTitle.ts:12-15,195-205`; only the Voluson row is seeded (`index.ts:541-543`) | register each console's AE title in `dicom_modalities` | consoles show the worklist; fewer manual searches | SMALL | no |
| P1-13 | Style rules duplicated across ≥4 homes; one vocabulary for validators, another for renderers | `institutionalReportStyle.ts`, `radiologyReportPreviewHtml.ts`, `reportPresentation.ts`, `validateOutput.ts:25-72`; **no duplicate-conclusion validator** | one DB-backed style source + one preference document for content | consistent reports; one place to edit | MEDIUM | no |
| P1-14 | Formatting drops: dedupe strips `|` and `.` (canals collide); server print escapes into one `<p>` | `reportFieldMerge.ts:102-117`; `radiology-report-generator.ts:2303-2311` | normalise table lines differently; route print through the document renderer | WYSIWYG | SMALL | no |
| P1-15 | Critical results: browser-only detector, flag off, notify route records only, amend re-uses the parent's `isCritical` with no new event | `criticalResults.ts:217`, `useStudyFinalize.ts:252-255`, `radiologyWorkflow.ts:435-464`, `patient-reports.ts:1821` | move detection server-side at finalize; make `notify` actually send; emit on amendment | patient safety | MEDIUM | no |
| P1-16 | Staff can read any report by integer id (`GET /api/patient-reports/:id`) | `routes/index.ts:1006-1010`, `patient-reports.ts:1396` | add the same entity/patient predicate the print/PDF routes use, or accept it explicitly as an internal-trust decision | PHI access control | SMALL | no |

### P2 — operational improvements with a genuine gap

| # | Problem | Evidence | Minimal change | Size |
|---|---|---|---|---|
| P2-1 | Frozen key images (clinical evidence) are **not** in the DB backup; retention unlink swallows errors | `docker-compose.yml:419-423`; `cron.ts:744-760` | add `uploads_data` to the backup job; log+alert on unlink failure | SMALL |
| P2-2 | Retention deletes `radiology_worklist` rows and nulls the study UID — a released report loses its images, with no DB audit | `orthancPurge.ts:293-338` | keep the UID, mark `pacs_archive_status=PURGED`; record deletions | MEDIUM |
| P2-3 | `ENABLE_DICOM_PULL_AGENT` exists in no compose/env file, so the ERP-side Q/R net is inert while jobs keep enqueuing and the watchdog early-returns | `cron.ts:84-90,1020-1086,2003` | either wire the flag + fix the `CONQUESTPACS` default, or delete the path | SMALL |
| P2-4 | Two intake senders with divergent payloads; two dead sidecar variants | `orthancChangesPoller.ts` vs `care_erp_sync(V1/V2/V3)` | delete the unused poller branch and the V2/V3 files; keep one owner | SMALL |
| P2-5 | WhatsApp/recall/feedback jobs are non-idempotent across restarts; backups share the same exact-minute pattern | `cron.ts:51,1162,1256,1286,598` | persist a "last fired slot" like the email path already does (`:1132`) | SMALL |
| P2-6 | `pruneComposeSnapshots` is never scheduled → PHI accrues in `input_snapshot_json` | `jobService.ts:891` | schedule daily | SMALL |
| P2-7 | Unlocked money writer (`bills.ts:2432` super-edit), hard-deleted payment history (`:2530`), waive-due rewrites `total_amount` with no voucher, vouchers swallowed silently | cited in `BILLING-REPORT-LIFECYCLE-AUDIT.md` B-6/B-7/B-8 | FOR UPDATE + tx; delete → cancel; voucher on waive | MEDIUM |
| P2-8 | X-ray peers all disabled; mammography not integrated at all (no laterality/view/BI-RADS/compression identifiers) | `orthanc_auto_puller.py:43-46`; `matchingEngine.ts:185` | enable CR pull; add MG identifiers to the catalog before buying/using a mammo unit | MEDIUM |
| P2-9 | No CT dose report (RDSR/GSPS) handling anywhere | grep zero for `CTDI`/`RadiationDose` | ingest RDSR into the dose field if CT reports are required | MEDIUM |
| P2-10 | Care↔HOPE: one symmetric HMAC secret, two env names, no rotation, hardcoded partner default auto-run at boot; HOPE copy never amended | `bootstrapHopeCareIntegration.ts:21-25`, `outbox.ts:146-156` | make the secret env-only, dead-letter unconfigured targets, propagate amendments | MEDIUM |
| P2-11 | Email delivery has an `attachPdf` option but never attaches; `/report-delivery/send` WhatsApp is a `MANUAL` placeholder | `reportDelivery.ts:141-215` | attach the rendered PDF or remove the option | SMALL |
| P2-12 | `super-admin-portal`: source quarantined, route live via USB | `nginx.conf:189`, `app.ts:341` | decide: keep it (and document the trust model) or disable the route | SMALL |

### P3 — optional

De-duplicate the four viewer-launch builders; merge the two key-image tables; rename "Billing Desk" vs "BillDesk" in code and docs; delete the 406-line `/command-center` route with zero callers; delete the stale `docker-compose.production.yml` and `orthanc/docker-compose.yml`; remove `listBuiltinModels({textOnly:true})` and the two `minimized={false}` no-op props; add a real cryptographic signature (needs a key-management decision, deliberately out of P0/P1).

---

## 4. Things this audit corrected

| Belief | Reality now | Evidence |
|---|---|---|
| "the ERP is deployed but stale" | **the ERP is answering 502 on every route** | measured ×3 |
| "`care-ohif` was rebuilt with D2" | rebuilt 2026-10-10 **from a pre-D2 ref**; D2 scripts 404 | `build-info.json` + two 404s |
| "`/test/compare` is dead" | **live** — mounted from the settings screen | `reportComposer.ts:576` + `AiReportingSettings.tsx:1547` |
| "`/compare` (model comparison) is dead for the right reason" | dead for a **different** reason: the copilot panel is never imported; and `/fallback-chain` has **no server route at all** while its page is routed | `RadiologyAICopilotPanel` 0 importers; grep of `routes/` |
| "`patient_reports.structured_json` is dead" | **the schema comment is stale** — it is read and written ~25× in `patient-reports.ts` (signed-document state, parent chain) | grep |
| "MedGemma stayed silent on the image-only finding, which is ambiguous" | resolved: a persona-free read probe shows it **does** read pixels (2/7 labels) and the silence is the typed-observations-wins prompt rule; gemma3's volunteering is **not stable across runs** (2 of 3) | live probe, 3 A/B runs |
| "BillDesk integration" | *Billing Desk* is the in-house ledger; the live gateway is ICICI Orange Pay | `resolveBillDeskCollector.ts`, `PaymentEngine.ts:21-73` |

## 5. What only a live system can tell you — paste these one at a time

```
docker ps --format '{{.Names}} {{.Status}}'
docker logs --tail 60 care-web
docker logs --tail 60 care-api
curl -s -m 5 http://172.16.1.139:8042/system
curl -s -m 5 http://192.168.1.137:8042/system
docker exec care-ohif sh -c 'ls /usr/share/nginx/html/care/'
docker exec care-erp-sync sh -c 'cat /app/care_erp_sync_state.json'
ls -1 /volume1/docker/care-pacs/orthanc/worklists | wc -l
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select status,count(*) from patient_reports group by status order by 2 desc"'
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from radiology_worklist where study_id is null"'
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select key,enabled from feature_flags order by key"'
docker exec care-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select ollama_base_url,ollama_model,ollama_composer_model,ollama_local_only,ollama_enabled from clinic_settings limit 1"'
```

## 6. Bottom line

The clinical-safety envelope of this system is stronger than most commercial RIS products of this size: identity is server-resolved, AI text cannot be auto-accepted or auto-signed, output validation blocks invented levels, sides and measurements, and every mutation of a signed artifact is refused and audited. **Nothing in the AI layer needs to be weakened to make reporting faster.**

What holds reporting speed back is narrow and fixable: no priors, no structure from the model, refinement that can't see the draft, a viewer identity chain that is code-complete but not deployed, and a production ERP that is currently offline. **Do P0-1 (why is it down) and P0-10 (which Orthanc) first** — every other radiology finding is currently unobservable because the application isn't answering. Then P1-1/P1-2/P1-3/P1-4, which together are what stand between CARE's drafts and the report quality you're asking for.

**No fix has been implemented, no PR created, nothing deployed.** This audit changed exactly six markdown files in `docs/audits/2026-10-11-master-system-audit/` and nothing else.
