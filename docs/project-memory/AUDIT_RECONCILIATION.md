# AUDIT RECONCILIATION — three historical audits, re-read against current `main`

Baseline `origin/main` **`1c80f2d3`**, measured 2026-10-20. Every row in a §2–§4 table is one of:
a claim **this pass** re-read from the tree (evidence column carries a `file:line` or a CI artefact
read this session), or an explicit **NOT REVALIDATED** — meaning the original audit's words are
recorded, the code was not re-read for this pass, and nobody may cite the row as a current fact.

## 1. Which documents the three audit names map to

The owner's assignment named three audits. **No file in the repository carries any of those three
titles** (`git grep -i -e "completion audit" -e "clinical safety audit"` → zero hits on `main`). The
mapping below is this pass's inference from scope and content, stated so a reader can disagree with
it rather than inherit it silently:

| Owner's name | Document(s) used | Written | Baseline stated in the document | Register it carries |
|---|---|---|---|---|
| **CARE Composer Completion Audit** | `docs/architecture/radiology-ai/AI_COMPOSER_CURRENT_STATE.md`, `AI_COMPOSER_GAPS.md`, `AI_COMPOSER_WORKFLOW.md`, `AI_COMPOSER_NEXT_PHASE.md` — **on PR #1084's branch only** (head `130fc9f5`, base `c4462041`), *not on `main`* | 2026-10-19/20 | `80a09df4` (#1082 merge) | G-1 … G-24 with severity S1/S2/S3 |
| | secondary: `docs/AI_REPORT_COMPOSER_DELIVERABLE.md`, `docs/architecture/radiology-ai/AI-SCREENSHOT-WORKFLOW-REUSE-AUDIT.md` | 2026-10-19 | not stated / measured | A–X letters; §13 five owner decisions |
| **Independent Systems Audit** | `docs/reporting-platform/CARE_PLATFORM_MASTER_AUDIT.md` (255 lines, scorecard 60/100) and `docs/reporting-platform/CARE_PLATFORM_FINAL_INDEPENDENT_AUDIT.md` (61/100); `docs/architecture/radiology-ai/INDEPENDENT_AUDIT.md` for the AI blueprint | 2026-07-16, 2026-07-17, 2026-07-18 | `8200e766` (master); *none* (final independent); *none* (AI) | C1–C4 · H1–H19 · M1–M18 · L1–L20 · A1–A13 |
| **Read-only Clinical Safety Audit** | `docs/audits/radiology-reporting-engine-dependency-map-2026-10-19.md` — its own words: *"Clinical ruling #175 deliverable … **This document implements nothing**"* | 2026-10-19 | `d968fc24` | R-1 … R-7 (one authoritative component per reporting concern) |

Two of the three are **three months old**, written before roughly half of the **729** squash merges
that make up `main`'s history since (`git log --format=%s origin/main | grep -cE '\(#[0-9]+\)$'` = 729;
45 of them landed in July after the 2026-07-16 audit, 293 in August, 130 in September, 261 in October).

**The scores contradict each other, and that is information.** The platform freeze self-assessed
**~96/100**; the master audit (2026-07-16, base `8200e766`) scored **Overall Platform 60/100**
(`CARE_PLATFORM_MASTER_AUDIT.md` §2, derived as a safety/security/reliability-weighted blend); the
final independent audit (2026-07-17) scored **61/100** and says so in its own words: *"Overall
independent score: 61 / 100 (vs the freeze's self-assessed ~96 and the master audit's 60)"*, with its
weakest area at **34/100**. None of these numbers is current: they describe July's tree, and this
reconciliation found one of its Criticals (**C2**) still true and three of its others (**C3**, **H1**,
**C4**-half) since fixed. Treat "96" as a self-assessment that two independent passes rejected, and
treat neither 60 nor 61 as today's state.

## 2. CARE Composer Completion Audit — G-1 … G-24

| ID | Finding (original wording, condensed) | Status on `1c80f2d3` | Evidence read this pass | Severity | Remaining work |
|---|---|---|---|---|---|
| G-1 | AI attribution is lost on reload | **PARTIALLY FIXED** | `fieldProvenance` has 134 hits on `main`, incl. `lib/reportComposer/types.ts`, `lib/voiceReportComposer/validator.ts` and `routes/radiologyWorkspaceDraftRoundTrip.request.test.ts` — the field is typed, validated **and** round-trip tested. Not re-proved end-to-end for the Impression/Findings editor reload path | S1 | prove attribution survives reload in the editor, not only the draft round-trip |
| G-2 | No unresolved-placeholder rule in the Composer validator | **NOT REVALIDATED** | `artifacts/api-server/src/lib/reportComposer/validateOutput.ts` does **not exist** at `1c80f2d3`, so the file the finding named is gone; where the rule lives now was not traced | S1 | locate the live validator and test one placeholder spelling per emitted sentence |
| G-3 | Copilot Insert writes AI text with no tracked change | **VERIFIED OPEN (renamed or absent)** | `git grep -e copilotInsert origin/main -- artifacts` → **zero matches**; the mechanism the finding named is not in the tree under that name | S1 | re-derive the Copilot insert path from current code, then classify |
| G-4 | `verify` and `amend` never call the unreviewed-AI gate | **PARTIALLY FIXED** | `checkUnreviewedAiFinalize` exists and **fails closed** (`lib/reportComposer/unreviewedAiGuard.failClosed.test.ts:81,:86`; `softFinalAiGuard.request.test.ts:5` states the finalize route must call it). The `verify`/`amend` call sites were not enumerated | S1 | prove ordering for verify + amend, or add the call |
| G-5 | The three-way clinical distinction is a prompt wish | **PARTIALLY FIXED** | `screening_limitation` is a real concept (`lib/conceptCanon/contentPacks.ts:2041`) and `mra_screening_limitation` is validated (`lib/mriBrainVascularValidation.test.ts:406`) — the *vocabulary* exists; whether the **validator** enforces present/absent/limited was not re-read | S1 | one validator rule, with a mutation proving it fires |
| G-6 | Capability routing is dead; `resolveModelPin` ignores its model argument | **NOT REVALIDATED** | `resolveModelPin` exists (`lib/ai-providers/src/capabilityRegistry.ts:34`) and is wired as `resolveDigest` (`lib/ai-providers/src/gateway.ts:65`). The body was not re-read to test the "ignores its model argument" claim | S2 | read the function; either fix the pin query or retire the table |
| G-7 | Audit evidence columns are written and shown to nobody | **VERIFIED OPEN** | `endpointLocality` has **zero** matches under `artifacts/diagnostic-erp/src` at `1c80f2d3` — the column is written by the server (`routes/aiComparison.ts` `resolveAuditLocality`) and no ERP screen reads it | S2 | surface locality / image-count / attestation in the existing AI audit page |
| G-8 | Interactive audit-write failures are swallowed | **PARTIALLY FIXED** | `strictAudit` exists in `lib/ai/aiSecurityPolicy.ts` with request-level tests (`aiSecurityPolicy.request.test.ts`). The interactive writers' use of it was not enumerated — note `routes/aiComparison.ts` still wraps its audit insert in `.catch(() => {})` | S2 | apply `strictAudit` to the interactive writers; stop swallowing the comparison audit failure |
| G-9 | No server observations table | **PARTIALLY FIXED** | the ledger persists inside `structured_json` (`lib/impressionBasisPersistence.test.ts:31,:43` — `composeStructuredJsonColumn({ observationLedger })`, `buildCareStructuredJsonPatch`) — a server-side **read-only view**, not a new table, which is exactly the finding's own recommendation | S2 | the read-side view; not re-verified |
| G-10 | Cloud composer vision can never open | **NOT REVALIDATED** | not traced this pass | S3 | — |
| G-11 | De-identification and burned-in OCR are built and never called | **VERIFIED OPEN** | `deidentifyImagesForCloudEgress` is defined at `lib/ai/imageDeidentification.ts:319`; the **only** other occurrences at `1c80f2d3` are in `lib/ai/imageDeidentification.test.ts:31,:301,:325` — a definition and its own tests, no production caller | S3 | one call site on the cloud egress path, or retire the module and say so |
| G-12 | `DICOM_REDACTION_PERFORMED = false` must stay honest | **VERIFIED FIXED (documentation class)** | the constant is still `false` (`lib/ai/dicomRedaction.ts:17`) and the docs around it say so plainly (`imageDeidentification.ts:7` *"records `DICOM_REDACTION_PERFORMED = false` and says plainly that 'No code path…'"*, `imageSendAudit.ts:178`) | S2 | keep the constant honest as code changes; nothing to build |
| G-13 | No measured basis for any model choice | **VERIFIED OPEN** | `runEvaluation` occurs once on `main` — its own definition, `lib/ai/evaluationRunner.ts:36`. Zero callers. Same for `ai_golden_cases` (`CURRENT_STATE.md` §7) | S2 | wire the loop or delete the tables; until then "the AI is improving" is unfalsifiable |
| G-14 | `ai_job_queue` and `admitJob` are a second, non-running orchestration | **NOT REVALIDATED** | composer identity tests exist (`reportComposer/composeIdentity.request.test.ts`); `admitJob` was verified caller-less in the previous pass (`OPEN_WORK.md` §1.3) but not again here | S3 | mark or retire |
| G-15 | No byte limit at key-image attach time | **VERIFIED FIXED** | `const MAX_KEY_IMAGE_BYTES = 8 * 1024 * 1024` and `MAX_KEY_IMAGE_EDGE_PX = 8192` at `routes/radiology-report-generator.ts:163,:165`, used as the multer limit (`:186`) and refused on oversize (`:278-279`) | S3 | — |
| G-16 | `vision-trial` silently truncates the image set | **VERIFIED OPEN** | `opts.images.slice(0, 6)` at `lib/reportComposer/providers/deepseekVisionTrial.ts:112` — it still slices | S3 | refuse instead of slice |
| G-17 | All three interactive cloud arms mislabel every image as JPEG | **NOT REVALIDATED** | the union types at `lib/ai-providers/src/index.ts:633` and `openAiCompatible.ts:14` allow png/gif/webp; whether the senders sniff the real bytes was not read | S3 | — |
| G-18 | No `num_ctx` escalation after `CONTEXT_BUDGET_EXCEEDED` | **PARTIALLY FIXED** | the error code is now detected and surfaced (`lib/ai/aiPipelineSelfTest.ts:792,:821,:1065,:1661` — including a LEGACY arm kept *specifically* to prove `CONTEXT_BUDGET_EXCEEDED`). The bounded retry itself was not found | S3 | one bounded retry, or document that there is none |
| G-19 | Truncation is diagnosed and never persisted | **VERIFIED OPEN** | `git grep -e truncat origin/main -- lib/db/src/schema/aiReporting.ts` → **zero matches**: no truncation columns on that table at `1c80f2d3` | S3 | two columns, then persist |
| G-20 | Comparison workspace has zero tests | **VERIFIED FIXED** | `routes/aiReporting.imageEgress.request.test.ts` runs **50 tests** in CI (`✓ …imageEgress.request.test.ts (50 tests) 2934ms`, run `39361881382` at `1c80f2d3`), covering the `/api/ai-comparison/run` path; #1079 and #1086 both landed tests there | S3 | — |
| G-21 | Apply is a whole-field replace | **NOT REVALIDATED** | design-documentation row; not re-read | S3 | document; do not redesign |
| G-22 | Two auto-compose switches, one of which does nothing | **VERIFIED OPEN** | `autoCompose` appears only in `pages/AiReportingSettings.tsx:432,:747,:858,:1494` and a test helper (`lib/clinicalAcceptanceJourney.test.ts:97`) — a settings screen and a test, no server-side consumer found | S3 | delete the dead setting or wire it |
| G-23 | Personal templates and macros are per-browser | **OUT OF CURRENT SCOPE** | the finding itself says *"out of scope unless the owner asks"*; no attempt was made to re-check storage location | S3 | only if the owner asks |
| G-24 | 73 request-level tests skip silently without `DATABASE_URL` | **PARTIALLY FIXED** | CI does execute them (`postgres:16-alpine` service; `1_Tests + migration smoke` log at `1c80f2d3`: **1133 files passed, 5 skipped of 1138**). The *silence* is not solved: `hasDatabaseUrl` has 155 hit sites, so a local run without a DB still skips ~73 suites and prints a pass | S2 | have the runner say how many request suites ran, and fail when the answer is zero |

## 3. Independent Systems Audit — master platform audit (2026-07-16 at `8200e766`)

The audit's own ⚠️ markers (corroborated by one audit only) are preserved in the description column.
Rows are the audit's IDs; a row that is NOT REVALIDATED is **not** evidence that the issue survives —
it is evidence that nobody has re-checked it in three months.

| ID | Finding | Status on `1c80f2d3` | Evidence read this pass |
|---|---|---|---|
| C1 | Three critical-finding alert systems over three tables; one shadowed by mount order; acknowledge 404 | **PARTIALLY FIXED** | one path is now flag-gated and request-tested: `ff_radiology_critical_result_comms` (`lib/radiologyFeatureFlagRegistry.ts:194`, `wired: true`) refuses with 404 when off (`routes/aiReporting.ts:3492,:3515,:3546`) and has its own suite (`routes/aiReportingCriticalComms.request.test.ts`). The three-table triplication and the mount-order shadowing were **not** re-derived → those halves are NOT REVALIDATED |
| C2 | Silent data loss: structured findings (`findingsMap`) absent from dirty-detection, backup and 401 rescue | **VERIFIED OPEN** | `serializeReportSnapshot` at `lib/workspaceReportState.ts:63-71` serialises exactly `ch, t, rf, im, re, qs` — **no `findingsMap`** — and `isReportDirty` (`:74`) is built on it; the `BackupEnvelope` interface at `:85` carries the same fields. `findingsMap` is still live UI state (`workspace/ReportCanvas.tsx:249`, `:1487`) |
| C3 | Unauthenticated PHI exposure via public booking ⚠️ | **VERIFIED FIXED** | `GET /api/public/booking/my-bookings` is **RETIRED (410)** at `routes/public-booking.ts:406-411`, with the comment naming the old exposure and pointing at the session-authenticated replacement `GET /api/patient/my-bookings` (`routes/patientPortal.ts`) |
| C4 | Stored XSS in report body → server PDF/print/public link, with **CSP disabled** ⚠️ | **PARTIALLY FIXED** | CSP/helmet is no longer off: `artifacts/api-server/src/app.ts:22-26` loads `helmet`, `:35-37` makes a failed load **fatal in production**, `:70` applies it — plus a source-contract test (`lib/securityPerfHardening.sourceContract.test.ts:31`). Whether `reportPresentation.ts` still injects `model.bodyHtml` raw was **not** re-read → the XSS half is NOT REVALIDATED |
| H1 | Sign/verify identity forgery on the DEFAULT legacy path ⚠️ | **VERIFIED FIXED** (ERP path) — with a named exception | `routes/patient-reports.ts:2584-2618`: *"The signer of record comes from the server… A name in the request body is never used — it is only recorded when it differs"*. `resolveSignerIdentity({sessionName, signatureName, callerSuppliedName})`, `400 signer_identity_unavailable` when neither proves a signer, `signatureId` + `signedByName` written, `identitySource` audited; test `routes/signedArtifactTrust.request.test.ts:694`. **Exception:** the USG Studio bridge still writes a body-relayed name — `CLINICAL_SAFETY_REGISTER.md` §9 |
| H2 | `TemplatesTab` defined inside the component → focus loss | **NOT REVALIDATED** | the 5,724-line `RadiologyReportingWorkspace.tsx` named in the finding **no longer exists** on `main`; the workspace is now `components/radiology/workspace/*` — the finding's file anchor is stale |
| H3 | Per-keystroke Copilot/quality recompute, undebounced, each run twice | **NOT REVALIDATED** | — |
| H4 | "Ask Copilot (AI)" non-functional: `{promptText}` vs `{prompt}` | **NOT REVALIDATED** | — |
| H5 | No child memoization → viewer re-renders per keystroke | **NOT REVALIDATED** | — |
| H6 | `transitioning` wedges if the next study fails to load | **NOT REVALIDATED** (superseded in part by the A-01/A-02 atomic study-switch work, #874 lineage) | — |
| H7 | Advisory-only foreign keys across core entities | **PARTIALLY FIXED** | `routes/finalizeIntegrityGuard.request.test.ts:10` exists precisely because `patient_reports` rows were once created for a study that had **zero** rows; the guard refuses. `.references()` coverage was not re-counted |
| H8 | "Send Report" (WhatsApp) reachable on unsigned drafts | **NOT REVALIDATED** | — |
| H9 | Protocol/checklist/Copilot-dismissal/teaching-note state leaks across study switches | **PARTIALLY FIXED** | the A-02 fix made study transition reset state atomically (`COMPLETED_WORK.md` §A) and `emptyClinicalState` is the known reset bucket; per-field omission list was not re-derived |
| H10 | Four hardcoded critical-keyword scanners | **NOT REVALIDATED** | — |
| H11 | `radiology_studies` missing indexes on its main join columns | **NOT REVALIDATED** | — |
| H12 | Dead AI-copilot cluster (~68 KB, 0 importers) | **NOT REVALIDATED** | — |
| H13 | Dead multi-study combine engine + false-defaulted flag | **NOT REVALIDATED** | — |
| H14 | Three parallel voice/dictation systems in one workspace | **PARTIALLY FIXED** | dictation retirement has its own guard (PR #991 lineage: *"its own guard refused it: voice is protected"*); the current count of live voice paths was not re-derived |
| H15 | ~9 overlapping template/findings stores, `StructuredTemplate` defined 3× | **PARTIALLY FIXED** | the consolidation register (`docs/audits/…dependency-map…` §A) now names one authority per concern; the store count itself was not re-counted — see §4 R-3/R-4 |
| H16 | 4–5 report render/PDF producers | **PARTIALLY FIXED** | `jspdf` importers are still spread across server and client (`lib/careLetterheadChrome.ts:14`, `lib/careLetterheadLogo.ts:4`, `lib/institutionalReportStyle.ts:554`, `lib/presentationTemplateSeeds.ts:36`, `components/SummaryExport.pdf.test.ts`) and `reportPdfGenerator` remains a separate producer; **R-2 of the dependency map still records two PDF producers** |
| H17 | Giant files concentrate risk | **PARTIALLY FIXED** | measured at `1c80f2d3`: `lib/zai-workspace/store.ts` **5,086 lines**, `routes/aiReporting.ts` **4,237**, `routes/pacsEnterprise.ts` **3,967**, `workspace/ReportCanvas.tsx` **2,164**; the two worst offenders the audit named (`Settings.tsx`, `RadiologyReportingWorkspace.tsx`) are **gone from `main`** |
| H18 | Unauthenticated PHI served from `/uploads` ⚠️ | **NOT REVALIDATED** | needs a live probe of the deployed nginx, which this pass is forbidden to perform |
| H19 | Copilot architecture documented nowhere but code comments | **VERIFIED FIXED** | `docs/architecture/radiology-ai/` is a 20-part set plus `AI_COMPOSER_*` and the OWUI asset inventory; the documentation problem is now the opposite one (volume/staleness — `KNOWN_ISSUES.md` §2 navigation list) |
| M1–M13 | Finalize confirm wall-of-text, non-idempotent finalize, save not lock-gated after loss, two-tab thrash, stale preview, `findingsMap`↔`rawFindings` dual store, no AI timeouts, two "Copilot" components, dead routers/HL7, fragmented draft storage (5+3 tables), dead CommandCenter cluster, unsurfaced route, ~19 unread flags | **NOT REVALIDATED** as a block | Two are known-changed since: finalize **is** now atomic and identity-bound (#874/#1058, `COMPLETED_WORK.md` §A) and M6's dual store is the same surface as **C2 above**, which was re-verified as OPEN. The rest were not re-read |
| M14 | MRI-hardcoded modality gates block expansion | **PARTIALLY FIXED** | the V4 clinical catalogue seeds 18 examination scopes as data (#1013/#1014 merged) and `clinicalMetadata/anatomyMetadataAudit.ts` exists; the literal `modalityMap` the audit cited was not re-read |
| M15 | ~70 duplicate docs, no entry point | **VERIFIED OPEN** | still no root `README.md`; `docs/` = 5,618 tracked files, `Antigravity/` adds 101 more, `docs/archive/` holds 56 `.md` that live documents cite as authority (`KNOWN_ISSUES.md` §2) |
| M16 | 97 MB `.SynologyWorkingDirectory` + `__super_admin_quarantine` tracked | **PARTIALLY FIXED** | the quarantine is **outside** `pnpm-workspace.yaml` yet still `--filter`ed by root `dev` (`package.json:12`), so the confusing shadow copy is still reachable; repo size was not re-measured |
| M17 | SVG accepted in uploads → stored XSS by direct navigation | **NOT REVALIDATED** | `SAFE_MIME_TYPES` was not re-read |
| M18 | **Two parallel migration systems + journal drift** | **VERIFIED OPEN** | measured at `1c80f2d3`: `migrations/` holds **201 top-level `.sql` + 4 in `migrations/manual-only/`**, applied in plain alphabetical order by `docker/db-patch-entrypoint.sh` (`scripts/check-migration-order.cjs:8-9` records that fact and its history); the Drizzle side is `lib/db/drizzle/meta/_journal.json` with **15 entries**, latest `0014_baseline_manifest`. The audit saw 64 SQL files; the count has since **tripled**, so the divergence risk grew |
| L1–L20 | Accessibility and ergonomics block (8–10 px type, two focus-less modals, no ARIA tablist, muted contrast, `window.prompt` measurements, no in-workspace Amend, preview rebuild per keystroke, 296 KB chunk, unmemoised objects, keydown re-registration, **no server CSP** `:11`, …) | **PARTIALLY FIXED** | L11's "no server CSP" is **superseded by the C4 evidence above** (helmet is now mandatory in production). The typography/modal/ARIA rows were not re-measured. L6 (no in-workspace Amend) contradicts nothing found this pass: amendment remains the post-sign path |

## 4. Read-only Clinical Safety Audit — dependency map R-1 … R-7 (2026-10-19 at `d968fc24`)

One day old at measurement, so most rows survive by construction; two of its own premises moved.

| ID | Finding (the audit's verdict word) | Status at `1c80f2d3` | Note read this pass |
|---|---|---|---|
| R-1 | `mergeTwoFormats` is an alias, not a second engine — **KEEP** | **NOT REVALIDATED** | alias, not a duplicate: no action |
| R-2 | Two PDF producers, one template — **REPLACE over time** | **VERIFIED OPEN** | agrees with H16 above; `reportPdfGenerator` + the client letter-pad producer both remain |
| R-3 | Two Quick Select box sources, only one surface merges them — **MERGE** | **PARTIALLY FIXED** | `lib/quickSelectBoxRules.ts` + `quickSelectSlots.ts` + `routes/radiologyQuickFindings.ts` all exist; whether the second source still bypasses the merge was not re-derived |
| R-4 | A second impression authority that nothing runs — **RETIRE or wire deliberately** | **NOT REVALIDATED** | the one-authority direction is `store.ts:1909 generateProfessionalReport`; dead second authority not re-located |
| R-5 | Two AI-adjacent report writers with a real boundary — **KEEP, guard the seam** | **NOT REVALIDATED** | — |
| R-6 | Dead surfaces that read as live — **RETIRE** | **PARTIALLY FIXED** | the B-10 family retired `UsgCompanionWorkspace.tsx` and the Command Center authoring surface (`COMPLETED_WORK.md` §C) — after which the map was written, so its live/dead table is partly stale |
| R-7 | The contradiction rule itself — **KEEP, protect it from re-forking** | **VERIFIED OPEN as a guard obligation** | the rule is `normalClaimSupersededBy` + `sentenceOwnedBySlot` behind one supersession contract across all four write doors (#1070/#1071/#1072); "protect from re-forking" is a standing review rule, not a defect |
| — | The map's own citation of #1070/#1071 as *"Neither is merged; neither is deployed"* | **NOW FALSE** | both merged (`02e47dff`, `d673f1cc`); recorded in `KNOWN_ISSUES.md` §2 so the document is not silently wrong |

## 5. What this reconciliation changes in practice

1. **One Critical from July is still live and is patient-visible:** **C2** — findings entered in the
   structured UI are not part of `serializeReportSnapshot`, so dirty-detection, the leave warning and
   the local backup can all be blind to them. Highest-priority code item this matrix produced.
2. **H1 is fixed on the ERP path and open on the Studio path.** The distinction is exactly the one the
   owner asked to keep: a *printed name* is not a *signature*. See `CLINICAL_SAFETY_REGISTER.md` §9.
3. **G-11, G-13, G-16, G-19, G-22 are confirmed dead or half-built code**, with `file:line` evidence
   above — they are not "PR waiting to merge" items, they are decisions (wire it or delete it).
4. **M18 got worse, not stale:** the hand-written SQL set tripled since the audit while the Drizzle
   journal stayed at 15 entries.
5. **G-20's claim was wrong on current `main`** — the comparison workspace has a 50-test CI suite.
   It is recorded as VERIFIED FIXED with the Actions line quoted, because a stale "zero tests" claim
   in a Draft document will otherwise keep steering work.
6. **Nothing above is deployed.** Every status is a statement about `origin/main` `1c80f2d3`, whose
   clinic counterpart is a 2026-10-12 build of unproven identity (`CURRENT_STATE.md` §1).

## 6. Rules applied, and one self-correction

* No finding was marked fixed because a related PR merged. Each VERIFIED FIXED row quotes a file
  (C3, H1, G-15, G-20) or a CI artefact read this session (G-20, G-24).
* **Self-correction recorded:** the first harness for this pass shelled out through `execSync`, which
  on Windows runs `cmd.exe`, where `grep` does not exist. Every "result" it printed was the string
  *"The system cannot find the path specified."*, and it produced derived counts (e.g. *"journal json
  lines = 2"*) that were error text, not data. It was discarded and re-run with `execFileSync` +
  `git grep`. A second trap surfaced the same way: `git grep`/`git ls-tree` invoked from a
  sub-directory silently scope to that prefix, which made three real patterns look absent. Both are
  now `KNOWN_ISSUES.md` §4 items 17–18.
