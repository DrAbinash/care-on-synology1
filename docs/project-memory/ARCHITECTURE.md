# ARCHITECTURE — the 17 subsystems, as built

> **Detail of record, not the current read.** The baseline named below is when these numbers were
> true; `origin/main` has moved since. For a one-minute status read — merged vs deployed, open
> clinical issues, pending migrations, the privacy question, next actions — read
> **[`PROJECT_STATUS.md`](./PROJECT_STATUS.md)**. Nothing in this file was deleted or rewritten.

Baseline `origin/main` `c4462041` (fetched 2026-10-20 02:05Z IST). Every `file:line` below was
grepped from that tree before it was written here — if a symbol moves, the line moves, so re-grep
rather than trusting the number. The checks ran from throwaway scripts under gitignored `tmp/`;
**treat the commands, not the scripts, as the evidence** — every citation here is reproducible with
`git show origin/main:<path> | awk -v n=<line> 'NR==n'`, and that is how the 2026-10-20 re-checks
were done.

**Path shorthand used throughout this directory — every file in `docs/project-memory/` (added 2026-10-20 after it caused a false
citation; it said "these nine files", and the corpus is **ten** now that `OWNER_DASHBOARD.md` is here —
which is precisely why no count of this directory should be trusted and `ls docs/project-memory/*.md`
should):** a bare `lib/foo.ts` or `routes/foo.ts` is relative to the **package named in the
sentence**, and this repository has two packages with the same directory names —
`artifacts/api-server/src/…` (server: print HTML, routes, Composer) and
`artifacts/diagnostic-erp/src/…` (browser: the workspace store, the PDF generator). They are not the
same file. Concretely: `reportPresentation.ts`, `reportImages.ts`, `signedArtifactGuard.ts`,
`reportComposer/*` and every `routes/*` are **api-server**; `zai-workspace/store.ts`,
`observationLedger.ts`, `radiologyReportLifecycle.ts`, `radiologyReportPdfExport.ts`,
`reportPdfGenerator.ts`, `reportSignerEligibility.ts`, `workspaceReportState.ts`,
`abnormalEmphasis.ts` and `components/radiology/workspace/*` are **diagnostic-erp**. Two names exist
in **both** packages, so they must never be cited bare: `store.ts`
(`artifacts/diagnostic-erp/src/lib/zai-workspace/` vs
`artifacts/api-server/src/lib/radiologyCatalog/`) and `index.ts`. When a row names no package,
resolve it with `git ls-tree -r --name-only origin/main | grep <basename>` before quoting — this
pass found three rows that called a browser module "server-side"; they are corrected below, and the
same sweep's markdown findings are recorded in `AUDIT_RECONCILIATION.md` §6.

**Moved since (corrected three times on 2026-10-20 — this is the file's central hazard):** `main` is
now **`dc8c3aba`**. After the `c4462041` baseline above, `c208cbfb` (#1081), `1c80f2d3` (#1086),
`d45370c3` (#1083 docs), `d7abb9b3` (#1084 docs), `47b739c8` (#1085), `8bbac44e` (#1087 docs),
`37a6758c` (#1088) and `dc8c3aba` (#1089) all landed. Four of those change what this file describes:

* **#1081** is the development-isolation code §15 describes as Draft-only — it is **merged**, so any
  `artifacts/api-server/src/devIsolation*` line number cited below was read from a tree that did not
  contain it. Re-grep before quoting.
* **#1085** moved the print/PDF and signature code this file's reporting subsystem depends on: a new
  server-side chooser `artifacts/api-server/src/lib/reportSignerSelection.ts` (imported
  `routes/radiology-report-generator.ts:30`, used `:2409`) replaced a name regex and a hard-coded
  fallback; `lib/reportPresentation.ts` gained the unreadable-image tile; and
  `artifacts/diagnostic-erp/src/lib/abnormalEmphasis.ts` + `reportPdfGenerator.ts` both changed, so any
  line number in this file that points into those four files is read from a tree that no longer
  matches.
* **#1088 then DELETED that chooser** — `reportSignerSelection.ts` and its 109-line test are gone
  (`git grep reportSignerSelection origin/main` → zero hits), which makes the sentence immediately
  above a description of a file that does not exist. Signature authority is now split by package: the
  **server** resolves and refuses (`resolveSignerIdentity()`
  `artifacts/api-server/src/lib/signedArtifactGuard.ts:165`; the `signature_not_active` write refusal
  spans `routes/patient-reports.ts:2599-2605`, the code string at `:2601`), and the **browser** both
  decides eligibility (`artifacts/diagnostic-erp/src/lib/reportSignerEligibility.ts:60,:66`) and
  derives the printable name from the record it fetched
  (`recordedSignerForReport()` `artifacts/diagnostic-erp/src/lib/radiologyReportLifecycle.ts:529`,
  `loadSignerOfRecord()` `:568`). **Dated correction, same pass:** an earlier revision of this bullet
  called that last pair "server-side record resolution", which is wrong on two counts — the file is
  `diagnostic-erp`, so it runs in the tab, and a browser module can only make the **display** match
  the record; it cannot authorize anything. Authorization is still wherever the `signatureId` is
  accepted, which is a role deny-list (§9.3 / decision D-10 in `CLINICAL_SAFETY_REGISTER.md`). An
  unsigned report prints
  `NOT SIGNED` from `signatureSlotHtml()` (`lib/reportPresentation.ts:506`, fed by
  `signerUnsigned` at `routes/patient-reports.ts:3482`); a preview signs nobody
  (`routes/radiology-report-generator.ts:2451`); and the browser PDF path refuses to re-render a signed
  row (`artifacts/diagnostic-erp/src/lib/radiologyReportPdfExport.ts:361`, thrown `:378`). The
  unreadable-image tile also moved again (`reportPresentation.ts:515` → `:548`,
  `reportPdfGenerator.ts:752` → `:772`). **All of it merged, none of it deployed.**
* **#1089** put a ceiling check in front of the vision trial (`lib/reportComposer/trialImageSet.ts:68`,
  called `routes/reportComposer.ts:755`), so the §AI image-comparison description now has a refusal
  path it did not have when written.
* The repository-wide counts live in `CURRENT_STATE.md` §5 and were re-taken at the tip;
  everything else in this file is still `c4462041`-dated.

Status labels are the ones defined in `CURRENT_STATE.md` §0.

---

## 1. CARE ERP (diagnostic-centre ERP)

* **Purpose.** Reception→billing→reporting→delivery ERP for the diagnostic centre: patients,
  worklist, billing/ledger, inventory, staff/HR, documents, admin.
* **Repository.** `DrAbinash/care-on-synology1` (pnpm monorepo).
* **Key source.** `artifacts/api-server/src/index.ts` (API, `PORT` default 8080 — `index.ts:2835`);
  `artifacts/api-server/src/routes/index.ts` (the mount table);
  `artifacts/diagnostic-erp/` (Vite SPA, 5173 — `vite.config.ts:11`);
  `lib/db/src/schema/*.ts` (187 files declaring 196 tables); `migrations/*.sql` (201 files).
* **Databases.** PostgreSQL 16 `diagnostic_erp`, role `erp`; in production reached over the compose
  network, host port published loopback-only (`docker-compose.yml:80`).
* **Integration points.** HOPE (§ out-of-scope subsystem 2), Orthanc/PACS (3–5), Ollama (9),
  cloud AI (10), WhatsApp/payments (optional), Windows emergency bridge (14).
* **Status.** MERGED and DEPLOYED (2026-10-12 build, identity unproven). Financial/concurrency
  hardening (B-11..B-13, bill-number, day-close) is MERGED, **not deployed**.
* **Limitations.** No ESLint config (Prettier only). The `dev` script still filters
  `@workspace/super-admin-portal`, which is not a workspace package (`package.json:12` vs
  `pnpm-workspace.yaml:2-5`) — `pnpm dev` errors on that leg; use `dev:erp-local`.
  `artifacts/radiology-e2e-acceptance/` and `lib/pacs/` match the globs but have no
  `package.json`.
* **Remaining work.** Deploy the merged commits (**114** since the 2026-10-12 deploy at `dc8c3aba`;
  this line read 106 at `c4462041` and 111 at `47b739c8` — count it, never recall it); close the `*.request.test.ts` collection trap
  (`AGENTS.md:33` — without `DATABASE_URL`, ~94 suites fail to *collect*, which is not "skipped").

## 2. HOPE Hospital ERP

* **Purpose.** Separate hospital-side ERP; the counterparty of CARE's outbox/inbound integration.
* **Repository.** `DrAbinash/hope` (own compose project; container `hope_hospital_app`, 5000→host
  **7080**). Last merged PR #191, 2026-10-14. 0 open PRs.
* **Key source (CARE side).** `lib/db/src/schema/integrationOutbox.ts` (`max_attempts` default 8 —
  `:34`), `.../externalResultLinks.ts:15`, `.../electronicFilmArtifacts.ts:13` (`HOPE_PENDING`);
  `artifacts/api-server/src/services/integration/outbox.ts` (`FOR UPDATE SKIP LOCKED` — `:218`,
  `:253`, `:282`); `services/integration/scheduler.ts:82-84` (outbox 1 min, reconcile 5 min, film
  poll 2 min); inbound `/api/integration/v1` mounted at `routes/index.ts:375`; outbound
  `POST /api/internal/radiology/send-report-to-hope` (`routes/internal-radiology.ts:1978`);
  callback default hard-coded `lib/bootstrapHopeCareIntegration.ts:29`.
* **Status.** Code MERGED. **Delivery has never been observed**: CL-6 records `integration_outbox`
  0 rows, `integration_delivery_attempts` 0 rows, `external_result_links` 0/0/0
  (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:724`).
* **Limitations.** The two addresses disagree across documents — `care.env`/README say
  `172.16.1.139:7080`, `NAS_OVERNIGHT_ENV_PATCH.env` says `192.168.1.137:7080`, and the latter TCP
  times out while the former answers HTTP 401 in 88 ms (same gate line). Event-compatibility
  document leaves three facts **UNKNOWN** and warns *"Do not convert `UNKNOWN` to `PASS` to make a
  deploy go"* (`docs/hope-care-integration/07_EVENT_COMPATIBILITY_VERIFICATION.md:164`).
* **Remaining work.** One authoritative callback address, then one observed end-to-end delivery.

## 3. PACS / Orthanc

* **Purpose.** DICOM archive and query/retrieve service.
* **Repository.** `DrAbinash/care-pacs` — **a separate compose project, and the local checkout is
  not on `main`** (`fix/orthanc-mwl-housekeeper-crash` @ `53588a0`, `origin/main` = `247f0cc`).
* **Key source.** `PACS/docker-compose.yml` (services `postgres`, `orthanc` pinned
  `orthancteam/orthanc:26.9.1` + digest `:39-47`, `mwl-guard`, `orthanc-puller`, `care-erp-sync`,
  `orthanc-retention` KEEP_STUDIES 500, `ohif`, `tailscale-ohif`, network `care-pacs-net`);
  `PACS/orthanc/config/orthanc.json` (worklists plugin `:28-33`).
  CARE-side config authority: `artifacts/api-server/src/lib/pacs/pacsConfig.ts:78`
  `getRadiologyConfig()` reading `pacs_settings` (`lib/db/src/schema/pacsSettings.ts:5-13`),
  categories `orthanc|viewer|erp|conquest|network`.
* **Status.** MERGED + DEPLOYED as its own project (`care-orthanc` 8042, `5680:4242` C-STORE/MWL).
* **Limitations.** `care-orthanc` **does not resolve from `care-api`** (ENOTFOUND every 20 s); the
  live `ORTHANC_INTERNAL_URL` is the NAS IP, and the external `care-erp-sync` container is *"the one
  actually working"* (`docker-compose.yml:337-351`, gate CL-4). Sync must run **exactly once**.
  `care-erp-sync` is launched as `python care_erp_sync.py` (`compose:143`) while the `/changes` v3
  logic lives in `care_erp_syncV3.py` — a filename mismatch. The ERP↔PACS link is a shared secret
  only, and the compose ships a weak literal default for it (do not quote it here; see
  `PACS/care-erp-sync/care_erp_syncV3.py` header and `compose:167`).
* **Remaining work.** Align the sync entrypoint with the v3 module, replace the default secret, and
  either fix Docker DNS or delete the misleading default base URL.

## 4. OHIF enterprise viewer

* **Purpose.** Browser image viewer inside the reporting workspace.
* **Repository.** `DrAbinash/care-pacs` (`ohif/enterprise/`); the pinned upstream source sits at
  `C:\Users\Admin\Documents\GitHub\ohif-pinned`.
* **Key source.** `PACS/ohif/enterprise/Dockerfile:10-12` pins `OHIF_REF=v3.10.0`,
  `OHIF_COMMIT=0b6e9cba…`, `CARE_VIEWER_VERSION=1.2.0-p2-radiologist`; the same pin is repeated in
  `docker-compose.yml:182-183` and `docker-compose.production.yml:65-66` (three places, one truth);
  overlays `PACS/ohif/enterprise/default.conf:43,57`, injection script
  `PACS/ohif/enterprise/scripts/inject-care-customization.sh` (invoked at
  `PACS/ohif/enterprise/Dockerfile:62,67`), runtime config bind-mounted as
  `care-config.runtime.js`.
* **CARE-side embedding.** Browser never talks to Orthanc directly: same-origin DICOMweb proxy
  `routes/pacsEnterprise.ts:729` (`/api/radiology/dicom-web`), series QIDO `:788`, instance `:807`,
  `/rendered` `:826`, `/frames/:frame/rendered` `:852`, launch `:645`; client base
  `artifacts/diagnostic-erp/src/lib/browserDicomWeb.ts:12`; iframe/FRAMES renderer
  `components/EmbeddedWadoViewer.tsx:56`; postMessage bridge with an origin+window allowlist
  `lib/ohifViewerBridge.ts:144`.
* **Status.** Image-identity work (D2) is MERGED in both repos; **viewer-side claims FAIL** at CL-5
  — *"Saying 'D2 is live' is false… it is dormant"* (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:723`).
* **Remaining work.** One deploy + one real-browser acceptance pass before D2 is called usable.

## 5. DICOM integration (acquisition, sync, MWL, pull)

* **Orthanc→ERP poller.** `lib/pacs/orthancChangesPoller.ts`: `/changes?since=` (`:368` region),
  `StableStudy` only, POSTs to `/api/internal/radiology/studies` with `Bearer INTERNAL_API_KEY`
  (`:279-281`), SR attached for US (`:339-342`), cursor persisted in `pacs_settings` key
  `orthanc_changes_cursor` (`:54`, `:169-180`), failures → `pacs_logs` +
  `dicom_failed_retrieval_queue`. Started always-on at `index.ts:2958`, enabled unless
  `PACS_PROVIDER!=orthanc` / `ORTHANC_CHANGES_POLLER=false` / no `INTERNAL_API_KEY`
  (`:417-428`).
* **Fast path exists but is unwired.** Webhook route `routes/internal-radiology.ts:1885` and Lua
  hook `docker/orthanc/erp_notify.lua`; the live `PACS/orthanc/config/orthanc.json` has **no
  `LuaScripts` entry** and there is zero `orthanc-webhook` reference in `care-pacs`. So sync is
  polling-only.
* **DIMSE pull agent.** `services/dicom-pull-agent/dimse-agent.ts` (C-ECHO `:213`, C-FIND `:254`/
  `:312`, C-MOVE `:329`/`:366`), started only with `ENABLE_DICOM_PULL_AGENT=1` (`index.ts:2906`).
  Tables `dicom_nodes`, `dicom_modalities`, `dicom_pulled_studies`,
  `dicom_failed_retrieval_queue`.
* **MWL push.** ERP writes `.wl` with DCMTK `dump2dcm` + atomic staging rename
  (`lib/pacs/mwlWorklistWriter.ts:75`, `:120`, `:137`), dir `ORTHANC_WORKLIST_DIR`
  (`docker-compose.yml:401`), consumed by the Orthanc worklists plugin; `mwl-guard` quarantines.
* **Study warmer.** `lib/pacs/mriStudyWarmer.ts`, started unconditionally `index.ts:2965`, gated by
  `pacs_settings.mri_warm_cache_enabled` (default ON), pauses 08:00–18:00 IST.
* **Known defect (CONFIRMED in code, not reproducible live).** RIS-007: a DIMSE "success" with zero
  received instances (`dimse-agent.ts:363`, `:488`) — `docs/engineering/RIS-PACS-INTEGRATION-TODO.md:38`.
* **Security note.** The Orthanc HTTP calls in `routes/pacs.ts:37`, `pacsEnterprise.ts:752` and the
  poller use plain `fetch`; the DNS-rebinding SSRF guard `lib/pacs/providers.ts:214`/`:240` is used
  for TCP probes and email only, and `ALLOW_PRIVATE_IPS=true` (`docker-compose.yml:354`) disables
  private-range blocking. Bases come from env/`pacs_settings` and inputs are regex/tag-whitelist
  filtered (`pacsEnterprise.ts:778-790`). Treat as **guarded by configuration, not by transport**.

## 6. Radiology worklist

* **Purpose.** The queue every report starts from; owns patient/study identity.
* **Key source.** `artifacts/diagnostic-erp/src/pages/RadiologyWorklist.tsx`,
  `components/radiology/workspace/WorklistPanel.tsx`; list route `routes/radiology.ts:340`,
  filters `:544-556`; link logic `lib/pacs/worklistBillingLink.ts:34+`.
* **Databases.** `radiology_worklist`, `radiology_studies`, `bills`, `patient_reports`, `tests`,
  `dicom_nodes`, `pacs_logs`/`pacs_settings`.
* **The identity trap (documented, still live).** `radiology_worklist.id` (row id — the key for
  routes, drafts, locks, queues) and `radiology_studies.id` (billed study id) **overlap by design**;
  handing the row id to `GET /api/patient-reports/from-study/:id` returns another patient's row.
  The canonical mapper is `finalizeContextForWorkspaceStudy()`
  (`artifacts/diagnostic-erp/src/lib/radiologyReportLifecycle.ts:77`, explained `:32-76`).
* **Status.** Fixes are MERGED (#1040 viewer scoping, #1042 archive scoping, #1044 wrong-exam,
  #1058 finalize study-id authority) — **not deployed**.
* **Remaining work.** Deploy, then re-run the browser acceptance that was done on staging.

## 7. Radiology reporting workspace

* **Purpose.** The single authoritative authoring surface.
* **Key source.** `pages/RadiologyReportingWorkspace.tsx` (`/radiology/report/:studyId`, asserted by
  `src/lib/usgWorkspaceContract.test.ts:59-62`); shell `workspace/WorkspaceShell.tsx`,
  `ReportCanvas.tsx`, `ReportingToolsRail.tsx`; Quick Select is **server-owned**
  (`routes/radiologyQuickFindings.ts`, mounted `/radiology/quick-select` at `routes/index.ts:939`),
  client strip `zai-workspace/quick-select-strip.tsx`, rendered from `ReportingToolsRail.tsx:86`.
* **Databases.** `radiology_report_drafts` (`structured_json` envelope, kind
  `care.structured_json_envelope` — `artifacts/api-server/src/lib/structuredJsonColumn.ts:11`),
  `radiology_report_key_images` (`lib/db/src/schema/radiologyReportGenerator.ts:154`),
  `radiology_image_references` (incl. `presentation_json` — `:224`).
* **Write doors** *(line numbers re-grepped at `dc8c3aba`; the ones in brackets are what this file said
  while based on `c4462041`, and three of them have moved)*. `POST /api/radiology/report-generator/save-draft`
  (`routes/radiology-report-generator.ts:1715` [1717]), `GET .../drafts?studyId=` (`:2059` [2061]), sign
  `POST /api/patient-reports/:id/sign` (`routes/patient-reports.ts:2436`), withdraw
  `POST /:id/withdraw-signature` (`:2945` [:2934]).
* **Signer authority added by #1088** (`37a6758c`, merged 2026-10-20 15:11:14Z) — **MERGED, not
  deployed, never reviewed on a rendered page.** Role gate `SIGN_DENY_ROLES`
  (`patient-reports.ts:2442`); inactive signature refused (`signature_not_active`, `:2599-2605`); the
  printed model carries `signerUnsigned` (`:3482`) and the renderer prints `NOT SIGNED` instead of a
  letterhead name (`reportPresentation.ts:506`); the browser PDF path will not re-render a signed row
  (`artifacts/diagnostic-erp/src/lib/radiologyReportPdfExport.ts:361`, thrown `:378`); eligibility and
  choice live in the front end (`artifacts/diagnostic-erp/src/lib/reportSignerEligibility.ts:60`,
  `:66`). **What it did not close:** the USG Studio bridge still takes the name from the request body
  (`routes/internal-reporting-studio.ts:845`, `:889`), no rule binds a staff account to a particular
  signature row, and the verify route (`patient-reports.ts:2650-2680`) still skips
  `checkUnreviewedAiFinalize` while amend (`:2122`), sign (`:2518`) and structured finalize
  (`internal-radiology.ts:1248`) call it.
* **Status.** The "four doors, one rule" supersession work (#1070/#1071/#1072) and
  usability-first (#1077/#1082) are MERGED, **not deployed**; canal AP single-authority print
  (#1054) and the Quick Select factory seed (#1049) likewise.
* **Limitations.** Draft table has **no `technique` column**
  (`radiologyWorkspaceDraftRoundTrip.request.test.ts:259`). `src/lib/quickSelectSlots.ts:1` is
  **Billing** Quick Select despite the name. Naming collision worth a comment in any future PR.
* **Remaining work.** The five-open-decision screenshot-workflow reuse plan
  (`docs/architecture/radiology-ai/AI-SCREENSHOT-WORKFLOW-REUSE-AUDIT.md` §12).

## 8. AI Report Composer

* **Purpose.** Turns recorded context into a professional draft; two paths share one engine.
* **Key source.** `artifacts/api-server/src/lib/reportComposer/`: `types.ts:213` (kinds and
  `PRESERVING_COMPOSE_KINDS`; schema kinds at `lib/db/src/schema/aiReportComposer.ts:28`, `job_kind`
  is plain text with **no CHECK constraint** `:41-43`); `jobService.ts` (`enqueueComposeJob:161`,
  `processComposeJob:421`, `markComposeApplied:902`, image audit call `:571`); `snapshot.ts`
  (`computeSnapshotHashes:233`, `isComposeJobStale:202`); `validateOutput.ts`
  (`detectDefiniteClinicalMutations:332`, `detectConservationLosses:880`,
  `detectDroppedObservations:1616`); `composeEngine.ts` (`buildUserPrompt:245`; `buildSystemPrompt`
  is `@deprecated` `:73`); `persona/` per-modality prompts; interactive route
  `routes/reportComposer.ts` (`/test:598`, `/test/compare:649` [both one lower before #1089 added an
  import], `/vision-trial:726`).
* **Vision-trial image set (added by #1089, `dc8c3aba`) — MERGED, not deployed, not exercised against a
  real model.** `lib/reportComposer/trialImageSet.ts:68` normalises and enforces the ceilings
  (`:25` ≤6 images, 3.5 M chars, `:27` jpeg/png/webp); `routes/reportComposer.ts:755` calls it and
  returns `400 {error, suppliedCount, droppedIndexes}` rather than running a shortened request —
  the "reject the whole set, never a trimmed list" rule the comparison UI (#1079) already followed.
  Two honest limits: the provider still contains its own silent `opts.images.slice(0, 6)`
  (`providers/deepseekVisionTrial.ts:112`) — unreachable through the one gated caller, but not deleted —
  and the only test of the gate is **static** (`reportComposer.visionTrialGate.test.ts:62` asserts the
  handler source contains the call); the DB-backed suite was removed before merge, as the commit message
  records.
* **Canal AP (verified this cycle).** `canonicalCanalAp.ts:39`/`:55` project the canonical record;
  `resolveComposeDraft.ts:117` `loadCanonicalCanalApForWorklist()` resolves it server-side and is
  wrapped whole so an unreachable record costs the canal data, never the draft. MERGED (#1063),
  not deployed.
* **Status.** MERGED broadly; **not deployed**; every interactive-route PHI/egress gate (#1076,
  #1078, #1079, #1080) is merged and unexercised in the clinic.
* **Limitations.** The Composer is **read-only against measurements by design**; the canonical
  record must stay a server-resolved argument, because the compose snapshot hash makes any
  client-supplied clinical data `stale_browser`.
* **Remaining work.** Durable Apply (two-phase) design; the acceptance battery that has never been
  run against a live model on deployed code.

## 9. Local Ollama integration

* **Purpose.** On-prem LLM/vision so PHI can stay in the building.
* **Key source.** `routes/radiologyOllama.ts` (25+ endpoints `:365-1097`, mounted
  `/radiology-ollama` at `routes/index.ts:1064`); adapter
  `reportComposer/providers/ollamaComposerAdapter.ts`; single runtime resolver
  `lib/aiPipeline/runtimeConfig.ts:51` (`ollamaBaseUrl:59`, `ollamaEnabled:69` from
  `clinic_settings`, `localChatVisionModel:120`), bound once by `lib/ai/bindOllamaRuntime.ts:11`
  ("Not a second resolver"); URL guard `lib/ssrf/ollamaUrlGuard.ts:85` with three layers
  (`ALWAYS_BLOCKED:17`, `AI_EGRESS_ALLOWLIST:38-42` authoritative, `PRIVATE_RANGES:25`).
* **Status.** MERGED. **Historically blocked by policy, not code:** an SSRF guard refused LAN Ollama
  unless LAN mode was on, which is why no MRI report ever generated locally.
* **Limitations.** Model choice is request `model` → `localChatVisionModel`; the image leg uses
  `ollama_model`, not the composer model, so a settings screen can show one and run another.
* **Remaining work.** One visible truth for "which local model runs which leg".

## 10. Cloud AI gateway and PHI egress

* **Purpose.** One owner for provider, model, timeout, locality and PHI truth.
* **Key source.** `lib/ai-providers/src/` (`gateway.ts`, `openAiCompatible.ts`,
  `hardenedTransport.ts`, `capabilityRegistry.ts`, `cloudImagePolicy.ts`, and
  **`providerLocality.ts` — note the package path: `lib/ai-providers/src/`, not under
  `artifacts/api-server/`**); `artifacts/api-server/src/lib/ai/interactiveAiGateway.ts`
  (precedence request → task-route → global-default, attribution `providerSource` at `:60`,
  resolution `:79`); `lib/ai/aiSecurityPolicy.ts` (`AI_SECURITY_MODES:31`, **fail-closed to
  `clinical`:36**, `resolveInteractiveImageEgress:197`);
  `reportComposer/providers/assertComposerProviderPolicy.ts` (cloud needs `cloudVisionAllowed`).
* **Status.** MERGED (#1076, #1078, #1079, #1080), **not deployed**.
* **Limitations.** Locality is **derived from the validated URL, not the provider name** — correct,
  but it means a renamed provider can silently change egress class.
* **Remaining work.** Deploy, then one observed cloud run with the audit row present.

## 11. AI model comparison

* **Purpose.** Run the same case across arms (local vs cloud) and record a winner.
* **Key source.** `pages/AiComparisonWorkspace.tsx:141-305`; `routes/aiComparison.ts` →
  `/api/ai-comparison` (`routes/index.ts:1040`): `/run:103`, `/providers:252`, `/save-winner:285`;
  ceilings `MAX_COMPARISON_IMAGES=6`, `MAX_COMPARISON_IMAGE_CHARS=3_500_000`,
  `MAX_COMPARISON_ARMS=6` (`aiComparison.ts:36-40`), gated by `resolveInteractiveImageEgress` and
  `DICOM_REDACTION_PERFORMED`.
* **Status.** MERGED #1079 (2026-10-19), **not deployed**, and **never browser-proven on deployed
  code**.
* **Limitations.** Comparison arms are capped by characters, not pixels; an arm that exceeds the cap
  is refused rather than down-sampled.
* **Remaining work.** One radiologist-run comparison on a real study after deploy.

## 12. Ultrasound reporting

* **Purpose.** USG authoring, Doppler, cine, PCPNDT controls.
* **Key source.** Standalone surface **retired**: `pages/UsgCompanionWorkspace.tsx` deleted, proven
  by `artifacts/diagnostic-erp/src/lib/usgWorkspaceContract.test.ts:48-49`; `/radiology/usg/:studyId`
  redirects to the canonical workspace (`:54-62`). Survivors: in-workspace
  `components/radiology/UsgCompanionPanel.tsx`, orphan widgets `components/radiology/usg/*`
  (contract comment `:35`), pages `UsgReporting`/`UsgDoppler`/`UsgAnalytics`/`UsgAdminSettings`,
  routes `usgReports.ts`, `usgAi.ts`, `usgAdmin.ts`, `usgPrior.ts`, `usgCine.ts`,
  `careUsgCompanion.ts`, persona `reportComposer/persona/usg.ts`.
* **Related repository.** `DrAbinash/usg-reports` is a **separate** no-AI USG pipeline (last merge
  #65, 2026-10-07).
* **Status.** Retirement MERGED (#1077 lineage); `ff_radiology_usg_workspace` still defaults OFF and
  **gates nothing in the ERP**, though the api-server rollout plan still lists it
  (`usgWorkspaceContract.test.ts:29-32`).
* **Remaining work.** Delete or honour the flag; decide the fate of the orphan widgets.

## 13. Synology deployment

* **Purpose.** The only path from `main` to the clinic.
* **Key source.** `deploy-synology.sh` (340 lines): `DEPLOY_BRANCH="main"` and
  `git reset --hard origin/main` `:39-47`; build identity baked `:56-95`; `.env` identity upsert
  `:151-158`; refuses to write the partner key/signing secret `:108-133`; secret posture enforced by
  `scripts/check-env-secrets.mjs` `:162-164`; migration timeout is a failure `:232-264`; health gate
  `scripts/deploy-health.mjs` `:283`; `scripts/verify-deployed-identity.mjs` `:307-317`.
* **Topology.** `docker-compose.yml` chain `db → db-patch-v2 → schema-verify → api → web` (`:5`);
  containers `care-db` `:45` (loopback-published `:80`), `care-db-patch-v2` `:115`,
  `care-schema-verify` `:169`, `care-api` `:230` (`PORT=8080`, **no host port**), `care-web` `:530`
  (`${HOST_PORT:-8888}:80` `:545`), `care-redis` `:624` unpublished, `care-migrate` `:590`
  (profile `manual`). External projects: `care-orthanc` 8042/5680, `care-ohif` 3010,
  `hope_hospital_app` 7080, staging `d2stg-*` 8091/3012/8043.
* **Status.** Working deploy path = **a human running the script**. DSM Container Manager cannot
  advance the checkout or refresh `.env` (`docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md:431-466` §12a).
* **Limitations.** The deploy takes **no database backup** before `git reset --hard` →
  `compose down --remove-orphans` → `up -d --build`
  (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:721`, CL-3). Rollback image IDs are recorded
  best-effort (`deploy-synology.sh:180-189`). DB-identity guard refuses migrations on `app_name`
  mismatch (`docker/db-patch-entrypoint.sh:163-164`).
* **Remaining work.** Bind a backup + restore proof to the deploy; then run it.

## 14. Windows emergency ERP (DS225 / offline billing)

* **Purpose.** Keep billing alive when the NAS or the network is down.
* **Repository.** The emergency app is `DrAbinash/225app` — **not this monorepo**, and
  `docs/WINDOWS_EMERGENCY_CARE.md:20` states plainly: *"Do not deploy this CARE monorepo onto the
  Windows emergency PC."* No `225app` checkout exists on this box.
* **Key source (CARE side).** `deploy/windows-emergency/` (`README.md`,
  `WINDOWS_EMERGENCY_DEPLOY.md`, `docker-compose.windows.yml`, `overlay/`, `scripts`); emergency API
  `PORT: "8898"` and web `${EMERGENCY_HTTP_BIND:-0.0.0.0}:${EMERGENCY_HTTP_PORT:-80}:80`
  (`overlay/docker-compose.yml:46`, `:77`), separate DB host port **5410** (`:25`); the
  Docker-Desktop override defaults the web to host **8080** to avoid needing elevation for port 80
  (`docker-compose.windows.yml:5`, `:12`). Reconciliation route
  `/api/emergency-bridge` is intentionally not behind `requireStaffAuth`
  (`routes/emergencyBridge.ts:8`), fails closed with 503 without a token (`:30`) and 401 on a bad
  `x-emergency-fetch-token` (`:34`); admin reconciliation page mounted `/emergency-billing`
  (`routes/index.ts:444`); master pull default 6 h.
* **Status.** Design MERGED (docs + overlay + bridge route); deployment state on this box is
  **unverified** — nothing CARE-emergency is listening here (8898/5410 absent).
* **Limitations.** Port 8080 is used by two different things in two different places (main API
  container-internal, and this override on a Windows host). The historic NAS deploy bug was probing
  host `:8080` and failing every time (`deploy-synology.sh:266-273`).
* **Remaining work.** One documented port map that both compose files obey.

## 15. Windows development environment

* **Purpose.** The owner's laptop for agent work and local reproduction.
* **Measured 2026-10-20.** `C:\care-development` **absent**. Listening: 5432 (service
  `postgresql-x64-18`, **PostgreSQL 18.3**, password-auth — not connected to by this audit), 5445
  (second cluster, role `erp`, **51 scratch databases**), 11434 (Ollama), 5178 (another session's
  Vite). **Not listening: 5411, 8181, 5173.**
* **Intended.** `C:\care-development`, `care_dev` at `127.0.0.1:5411`, API `127.0.0.1:8181`, SPA
  `127.0.0.1:5173`, `CARE_DEV_ISOLATED=1` — all of it defined by **PR #1081**, which **merged as
  `c208cbfb` on 2026-10-19 21:39Z** (this row formerly said "Draft"):
  `CARE_DEV_DATABASE_URL=postgresql://erp@127.0.0.1:5411/care_dev`, `CARE_DEV_API_PORT=8181`,
  `CARE_DEV_ERP_PORT=5173`, `CARE_DEV_EGRESS_ALLOW`, documented in the added section *"Local
  development isolation"* of `docs/CARE_ERP_ENVIRONMENT_MATRIX.md`. On `main` now:
  `package.json:14` `"dev:isolated": "node scripts/dev-erp-local.mjs --isolated"`,
  `artifacts/api-server/src/devIsolationBoot.ts`, `devIsolationDoors.test.ts`,
  `devIsolationStartup.test.ts`. **Merged is not used** — §"Measured" above still shows 5411/8181/5173
  not listening, because nobody has started it on this box yet.
* **Version gap.** Production/CI are PostgreSQL **16** (`server_version 16.14`;
  `postgres:16-alpine`); this box is **18.3**. Migration/`ON CONFLICT`/collation behaviour can
  diverge, and CI does not cover 18.
* **Scratch discipline actually used.** `TZ=UTC node node_modules/vitest/vitest.mjs run …`
  `--maxWorkers=1`; request tests against `postgres://erp@127.0.0.1:5445/<db>`; typecheck by calling
  `node node_modules/typescript/bin/tsc` directly (pnpm scripts abort on `ERR_PNPM_IGNORED_BUILDS`).
* **Repository hygiene.** `git worktree list` on this repo returns **99 entries** (the primary
  checkout included) under
  `Documents/GitHub`, ~40 of them agent-session leftovers, plus loose `pr9xx.json` files in
  `Documents/GitHub`. The primary checkout `care-on-synology1` is **not usable for work**: 57 dirty
  paths, 1 unmerged `DU` index entry, and local `refs/heads/main` sitting 1 ahead / 184 behind with
  a **superseded** commit `e0991715` (its content reached `main` as PR #929 and evolved there —
  `git merge-base --is-ancestor e0991715 origin/main` is **false**, and the preview script's blob is
  byte-identical to `main`'s).
* **Remaining work.** ~~Merge (or close) #1081~~ — **done 2026-10-19, merged as `c208cbfb`.** What is
  left is to *use* it: create `C:\care-development` once, with `pnpm install --frozen-lockfile`, start
  `pnpm dev:isolated` against a `care_dev` on `5411`, and prune the worktree list. No port on this box
  is listening for it yet (measured above).

## 16. PostgreSQL databases

| Database | Where | Notes |
|---|---|---|
| `diagnostic_erp` | NAS `care-db`, postgres:16-alpine, `${DB_BIND_ADDR:-127.0.0.1}:${DB_HOST_PORT:-5400}` | Production. Schema applied by the `care-db-patch-v2` → `care-schema-verify` chain, **never** `db:push`. |
| `care_dev` | intended on Windows `127.0.0.1:5411` | **Still does not exist.** The guard that requires it is merged (`c208cbfb`), the database itself has never been created on this box. |
| scratch DBs | Windows `127.0.0.1:5445`, role `erp` | 51 databases from past agent sessions; the `care_v4_fresh` DB referenced by older notes is **gone**. |
| second DB in `care-pacs` | `PACS/docker-compose.yml` service `postgres` | Orthanc's own store. |
| HOPE DB | `hope` project | Separate hospital ERP database. |

* **Migrations.** 201 `.sql` files in `migrations/`; order enforced by
  `scripts/check-migration-order.cjs` in CI; `pnpm db:check-migration-order`,
  `pnpm db:migration-manifest`, `pnpm db:smoke`. The repo's own rule (project memory): **never
  `db:push` for a real change — schema changes need a migration file** applied by the
  `care-db-patch-v2` path.
* **Schema coverage.** The Drizzle schema declares **196** distinct table names
  (`grep -rho 'pgTable("[a-z_0-9]*"' lib/db/src/schema/*.ts | sort -u | wc -l`). The owner reports
  the restored production snapshot holding **477** tables. The difference is legacy, integration and
  third-party tables the ORM does not model — unexamined here, and it must be measured on a real host
  (`select count(*) from information_schema.tables where table_type='BASE TABLE'`), not inferred from
  the schema. **Counting trap found during this audit:** a `pgTable\(` regex written with a character
  class inside double quotes in `node -e "…"` was mangled by bash backtick substitution and reported
  **471** tables. Two independent methods disagreed; the grep is right. Quote-harness output is not a
  measurement.

## 17. Backup and disaster recovery

* **Authoritative script.** `scripts/synology-nas-backup.sh:3` — *"the clinic's PRIMARY database
  backup"*; dumps from inside `care-db`, retention 14 days, floor 2 copies, 10 KiB minimum size
  (`:36`); documented install is DSM Task Scheduler daily 03:00 (`:17-24`).
* **The wrong script.** `scripts/synology-backup.sh` pulls a **different (Replit) database** and, in
  its own words, "must never be scheduled" (`:12-14`).
* **Measured reality** (`docs/CARE_ERP_BACKUP_COVERAGE.md:84-85`): live destination
  `/volume1/backup/care-erp/db` holds **1277** `backup_DB_*.sql.enc`, effectively **hourly**, ~30 d
  of history, newest `2026-10-15T09-31-02-967Z`, **zero `.meta` sidecars**; a second job at
  `/volume1/docker/backups/postgres/care` has **20 zero-byte dumps, six consecutive nights
  2026-10-10 → 2026-10-15**. The schedule lives in DSM Task Scheduler, **outside this repository**
  (`:68`).
* **Restore.** `scripts/synology-restore.sh:3-16` sniffs gzip magic to accept both artifact shapes;
  `verify-backup-restore.sh` restores into an unpublished `care-db-restore-sandbox`;
  `scripts/verify-uploads-restore.mjs` covers the uploads volume.
* **Status.** **No NAS-side restore has ever been proven** — CL-2 NOT TESTED,
  `public.backup_verification` has 0 rows (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:719`). The standby
  plan self-labels *"Status: LOCAL, measured at `3f044107`… nothing was executed against either
  NAS"* and says *"Do not automate failover"*
  (`docs/CARE_ERP_SECOND_NAS_DISASTER_RECOVERY.md:28-31`, `:355`).
* **Non-obvious dependency.** Key images live on disk (`data/uploads/radiology-key-images`, volume
  `uploads_data`, `lib/frozenKeyImages.ts:33`) — **a database-only backup loses every frozen image**
  in signed reports.
* **Remaining work.** One proven restore, one proven uploads restore, then the zero-byte job
  explained or deleted.
