# CARE ERP / PACS — Production Readiness Matrix

_Assessed 2026-10-13 against `main` = `f3dbb974` (#950, #951, #952, #954, #955, #957, #958,
#959, #960, #961 merged). #965 merged after that run — `.gitattributes` rules,
`scripts/line-endings.test.mjs` and three documents, no product code — so every measurement
below is still at `f3dbb974`. Owner decisions still deferred by choice: production credential
rotation and Git-history remediation are out of scope, and nothing in this document touches
a credential. Nothing here was executed against the clinic._

**A green CI run is not a readiness verdict, and a local failure is not necessarily a
defect.** Every row says which class of evidence supports it, and four rows carry a blocker
that only the NAS can answer. The evidence classes are deliberately separate, because
collapsing them is how "tested" becomes a lie:

| Tag | Means |
| --- | --- |
| **[CI]** | verified by GitHub Actions on Linux with PostgreSQL 16, sequential (`vitest run --no-file-parallelism`), including the clean-boot migration smoke |
| **[L]** | measured locally on this Windows box in this session, with the command and the number |
| **[NAS]** | infrastructure verified **on the clinic box** |
| **[NOT VERIFIED]** | the truth exists only on the NAS; stated as unknown, never assumed |

Severity: **P0** blocks a deployment. **P1** must be corrected before clinical rollout.
**P2** can be scheduled.

Overall recommendation: **CONDITIONALLY READY** — see §Decision.

## The matrix

| # | Component | Status | Evidence | Remaining blocker | Severity | Required action | Production risk |
|---|---|---|---|---|---|---|---|
| 1 | **CARE ERP** (API + SPA) | CONDITIONALLY READY | **[CI]** every PR merged into `main` this cycle was green on both jobs, and `f3dbb974` is the tip of that sequence. **[L]** sequential full suite at `f3dbb974`: **12,063 passed / 23 failed / 15 skipped across 987 files (30 failing)**, 373 s. The failing-test **name set** is identical to the pre-merge baseline `cd752a43` except one swap in, one swap out — both now proven state-dependent, not code (see §Local failures). `tsc -p artifacts/api-server/tsconfig.json --noEmit` → exit 0 | The 23 local failures are machine artefacts and every one is now classified, but no human has read the 20 files that fail to *collect* in this junctioned worktree (`lib/ai-providers`, `lib/report-quality`, `scripts/src`) — they are dependency-resolution, not assertions, and they are reported as unmeasured rather than passed | P2 (local-only). Nothing here blocks a deploy | Run the suite once on Linux (or accept CI as the arbiter). The worktree-collection list is a property of this machine's `node_modules` junctions |
| 2 | **HOPE integration** | NOT VERIFIED | **[L]** the keys exist and are interpolated (`HOPE_PARTNER_KEY`, `INTEGRATION_HOPE_SIGNING_SECRET`, `INTEGRATION_HOPE_CALLBACK_URL`, `HOPE_CARE_INTEGRATION_FORCE` in `deploy/synology/care.env` + `docker-compose.yml`, seeded by `deploy-synology.sh:117-120`); `POST /api/internal/radiology/send-report-to-hope` is the outbound leg | **[NOT VERIFIED]** whether the callback is reaching a live HOPE **today**, and whether the shared secrets still match on both sides. The values live in tracked files the owner has chosen not to rotate yet | P1 for referral traffic, not for the ERP serving reports — but it cannot be answered from here | On the box: call the HOPE health endpoint from inside `care-api`, then send one test referral and read both sides' logs. Rotate nothing without the owner's window |
| 3 | **Orthanc** | CONDITIONALLY READY | **[L]** `ORTHANC_INTERNAL_URL` defaults to `http://care-orthanc:8042` (`docker-compose.yml:336`); `pacsImagePicker.request.test.ts` **12 tests pass** on `main` **[CI]** pinning attach, multiframe frame selection, cross-study refusal, PACS-down and the new 429 refusal; the worklist bind mounts are `/volume1/docker/care-pacs/orthanc/worklists` | **[NOT VERIFIED]** `care-pacs` is a different compose project on its own bridge (`care-pacs-net`), so that hostname resolves only if the two projects share a network. Also: a container cannot reach the NAS's own LAN IP on a published port (hairpin), so a `192.168.1.137:8042` failure from inside a container proves nothing | P1 — if it does not resolve, image attach silently degrades to whatever is already frozen | `docs/CARE_ERP_CLINIC_READINESS_CHECKS.md` §C.1–C.3: `$ORTHANC_INTERNAL_URL/system`, then the network membership of `care-api` and `care-orthanc`, then a QIDO study query |
| 4 | **OHIF viewer** | NOT VERIFIED | **[L]** D2's displayed-image identity work is merged in both repos (`presentation_json`, the frame trap, `EmbeddedWadoViewer`); the ERP renders its own thumbnails through `care-api`, not OHIF | **[NOT VERIFIED]** `care-ohif` is built from `care-pacs` and its image is **not** rebuilt by an ERP deploy. `build-info.json` gives `ohifRef`/`ohifCommit`/`careViewerVersion`/`builtAtUtc` but **no `care-pacs` SHA**, so "is the running viewer current" cannot be answered from this repository | P1 — a stale OHIF shows the viewer without the identity fix while the ERP looks correct | §C.4: read `build-info.json`, the image creation time, and the injected `<script src>` list in the served `index.html`, and compare that list against `care-pacs` main. Rebuild is the owner's call |
| 5 | **PACS image picker** | READY | **[CI]** + **[L]** `pacsImagePicker.request.test.ts` **12 tests** (10 before #959) pass on a real Postgres; 49 pass across every suite that uses the DICOMweb double. #959 added the refusal leg (a 429 fabricates no row and no file) and the attach→label→reorder→reopen journey | No test drives the browser UI (a radiologist clicking *Select images from PACS*). The coverage is HTTP + renderer, which is real but is not a session | P2 | Optional: one Playwright journey on the box. Do not read the request tests as UI proof |
| 6 | **Report generation** | READY (was CONDITIONALLY READY) | **[CI]** `structuredReport/renderer.test.ts` is green in CI at every merged head. **[L]** the 5 local failures there are now **proven** to be a CRLF checkout artefact, not clinical text: same tree, same commit `f3dbb974`, fixtures normalised to LF → **23 passed / 0 failed**; restored byte-exact afterwards. Composer/draft/finalize chains (`composeIdentity`, `keyImageOwnership`, `signatureWithdrawalReopensStudy`) pass locally | `reportComposer/persona/index.ts` carries duplicated switch arms (see §Cross-cutting) — behaviour correct today, second copy unreachable | P2 | The `.gitattributes` rules merged in #965 make the renderer failures impossible on a fresh checkout — verified in a clean Windows worktree at `0e801cf1` with `core.autocrlf=true`: **65 passed / 65** across `line-endings` 3, `renderer` 23, `dockerCompose` 10, `audit-migration-ledger` 29; the persona duplicate is its own cleanup |
| 7 | **Browser printing** | READY | **[CI]** `reportPresentation.printLayout.test.ts` runs real Chromium in CI (the job installs Playwright deps) and is green at `f3dbb974`. **[L]** 6 tests pass; three mutants of `reportPresentation.ts` were caught, each by a **different** leg: an always-emitted caption (markup count `4 ≠ 2`), an upper-cased caption (rendered text only — the markup still matched because `<img alt>` keeps the case), `display:none !important` (measured box height only — `innerText` on an unrendered element still returns its text) | Institutional CSS can still override `reportPresentation` elsewhere on the page; the suite detects it for captions, not generally | P2 | Re-run the print suite after any template or CSS change |
| 8 | **Download PDF** | READY | **[L]** re-run 2026-10-13 at `f3dbb974`: `reportPdfGenerator.letterpad.test.ts` **3 ✓** and `reportPdfGenerator.keyImageCaptions.test.ts` **8 ✓** (11/11, sequential, exit 0); **[CI]** green in the full suite. Two of the three letterpad cases shell out to `pdftotext`, which CI installs (`poppler-utils`, `.github/workflows/ci.yml:85-92`) | `AGENTS.md` used to list letterpad as a known environmental failure — corrected in #960. A letterpad failure with `pdftotext` present is a defect, not noise | P2 | If letterpad goes red, check for the binary first |
| 9 | **Durable PDF** | READY | **[CI]** + **[L]** #954's `reportStudyIdentity.request.test.ts` passes: `pdf`, `public_pdf` and `email` each carry the accession only when the server can prove it belongs to that patient, and print nothing rather than another patient's identifier when the study reference collides in the shared id space | What is not proven is the clinic's real print volume end to end — one durable PDF from today's queue, read by a human | P2 | §C.6 final step / runbook §12 step 11: open one and read its header lines |
| 10 | **Database migrations** | CONDITIONALLY READY | **[L]** `scripts/audit-migration-ledger.test.mjs` **29 tests** pass; the read-only claim is now asserted by the suite, not by prose: every `client.query(` site must be a literal `SELECT`/`SHOW`, the site count must equal the call-site count (so a dynamically built statement cannot hide), and both halves of the `default_transaction_read_only` guard must be present. 4/4 mutants of `audit-migration-ledger.mjs` turned that gate red, and `scripts/line-endings.test.mjs` (merged in #965) guards the rules that make the Windows collection failure impossible. **[CI]** green at `f3dbb974`. Detection proven on three synthetic databases; clean control **0 critical / 0 warnings / 1 informational** | **[NOT VERIFIED]** **the audit has never been run against the clinic's database.** Every pre-#955 deploy is a window in which a half-applied migration was recorded and then skipped forever. This is the single largest unknown in the matrix | **P0 for a deployment that touches the schema** — and the only way to clear it is a read-only command that takes seconds | `docs/CARE_ERP_CLINIC_READINESS_CHECKS.md` §A (target + identity + read-only pre-flight, then the audit). Read every critical line before rebuilding anything. Never rewrite a ledger row to silence it |
| 11 | **Deployment script** | CONDITIONALLY READY | **[L]** line-cited against `deploy-synology.sh` at `f3dbb974`: HOST_PORT parse `:187-196`, health gate `node scripts/deploy-health.mjs … --host-port "$HOST_PORT"` `:254`, migration-timeout failure `:230-235`, defaults `MIGRATION_TIMEOUT_SECONDS:-240` / `DEPLOY_HEALTH_TIMEOUT_SECONDS:-300`. **#952 removed the probe that could never pass** (port 8080 is not published on the host) and made both wait loops fail on timeout. **[CI]** `deploy-health.test.mjs` green | `deploy-synology.sh` still takes **no backup** before `git reset --hard` + `compose down --remove-orphans`, and still appends two live Hope secrets into `.env` by name (`:117-120`) | P1 for the backup omission (it is the difference between a rollback and an incident); P2 for the secrets line, which the owner has deferred | Keep §12 step 3 as a human gate before running the script. Do not "fix" the secrets by rotating them unasked |
| 12 | **Backup and rollback** | CONDITIONALLY READY | **[L]** `scripts/synology-nas-backup.sh` dumps with `pg_dump --clean --if-exists` out of the `care-db` container (so it works while `care-api` is down), gzip-validates and refuses a <10 KiB artifact, optional AES-256-CBC/PBKDF2, 14-day retention; `scripts/verify-backup-restore.sh` restores into container `care-db-restore-sandbox` with **no published port** and `ON_ERROR_STOP=1`, refuses a non-schema-complete dump, fails when `patients`/`bills` land empty, and cleans up on every exit path; **[L]** `restoreVerify.integration.test.ts` **2 ✓** once `pg_dump`/`psql`/`createdb` are on `PATH` (it failed for want of them before — now measured, not assumed) | **[NOT VERIFIED]** whether a restore has been proven **recently on this NAS** — only the NAS has the artifacts. Encrypted backups are unreadable if `SESSION_SECRET`/`BACKUP_PASSPHRASE` change without keeping the previous value for the window | P1 — the only real safety net, and migrations are forward-only | §B end-to-end, plus record image IDs (`docker inspect --format '{{.Image}}' care-api care-web`) before the build, because the app images are built, not pulled |

## Local failures at `f3dbb974`, classified

Sequential (`--maxWorkers=1 --fileParallelism=false`), `TZ=UTC`, `DATABASE_URL` on a
migrate-built PostgreSQL 18.3, 335–374 s per run. **23 failing tests / 30 failing files** —
and every one of them is accounted for:

| Count | Where | Cause | Proof |
| --- | --- | --- | --- |
| 10 | `dockerCompose.test.ts` | CRLF working copy of `docker-compose.yml` | normalise that one file → **10 passed** |
| 5 | `structuredReport/renderer.test.ts` | CRLF golden `.body.txt` files | normalise 5 fixtures → **23 passed**; diff was `\r` only, words identical |
| 1 | `scripts/audit-migration-ledger.test.mjs` | **`#!/usr/bin/env node` + CRLF**: vite's SSR transform leaves the shebang, V8 throws `SyntaxError: Invalid or unexpected token` and the suite reports `(0 test)` | two independent fixes: convert to LF → **29 passed**; delete the shebang, keep CRLF → collects. `.gitattributes` + `line-endings.test.mjs` now pin it |
| 2 | `backupHealth.test.ts` | POSIX path assumptions (`/app/data`) | not attempted; no assertion about product behaviour |
| 1 | `pacs/mwlDeploymentStatus.test.ts` | filesystem/path semantics on Windows | not attempted |
| 1 | `aiQueryContract.test.ts` | Windows path separator | not attempted |
| 1 | `bills.searchFilters.request.test.ts` | this scratch cluster's timezone is `Asia/Calcutta` (`show timezone`, measured) while the test computes `today` from `toISOString()` (always UTC) | `ALTER DATABASE … SET timezone='UTC'` → **8 passed** |
| 1 | `restoreVerify.integration.test.ts` | `pg_dump`/`psql` not on `PATH` | with `PATH` including `C:/Program Files/PostgreSQL/18/bin` → **2 passed** |
| 1 | `internal-reporting-studio.request.test.ts` | **new in this run.** The test pages with `limit=2` and asserts < 20 pages, so any accumulated pending row updated after 2026-09-21 breaks it | fresh migrate-built database → **23 passed**. Same class as the baseline-only failure that disappeared (`a study scanned inside the polling grace…`) |
| 0 tests | 20 files under `lib/ai-providers`, `lib/report-quality`, `lib/integrations-gemini-ai`, `scripts/src` | this worktree's `node_modules` junctions do not cover those packages, so they fail to **collect** | reported as unmeasured, not as passing |

**Genuinely new failures versus the `cd752a43` pre-merge baseline: zero.** One-for-one name
swap, both halves reproduced as DB-state effects.

## Two findings that belong to no single component

1. **A prompt file with dead arms.** `artifacts/api-server/src/lib/reportComposer/persona/index.ts`
   contains `PROFESSIONALIZE`, `OBSERVATIONS` and `COMBINE` **twice** (77–107 and an exact copy
   at 108–138). esbuild warns on every build — `This case clause will never be evaluated because
   it duplicates an earlier case clause` — and the warning is visible in any local test run. The
   first copy wins and both are identical, so **behaviour is correct**; the defect is that the
   second copy is unreachable, so a future edit there changes no prompt anyone sends. **P2.**
2. **A server-side rate limit that cannot be told from an outage.** `lib/reportImages.ts:186`
   returns `null` for every non-OK response, so a 429, a 500, a timeout and a corrupt object
   arrive at the print/PDF leg as one event. #950 fixed this on the **client** (`fetchApi.ts`,
   `studyUidLookupNotice.ts`, `frozenKeyImageRailState.ts` — 34 tests pass locally) and #959
   pinned the guarantee that does hold server-side (a refused attach fabricates nothing). Fixing
   the classification means giving `fetchPrintImageBytes` a typed outcome, which touches every
   caller. **P2 for a deploy; P1 for the clinic's ability to trust "PACS is down" on a busy
   morning** — the message a radiologist sees is the diagnosis they act on.

## Decision

**CONDITIONALLY READY.**

There is **no P0 in the code**. The outstanding items are one P0-shaped unknown that only a
read-only command on the clinic database can settle, and three NAS-side verifications that
this repository can ask but cannot answer:

1. **Run the migration-ledger audit against the clinic database** (component 10). Gating. It
   takes seconds, it cannot write, and it is the only thing that can reveal a pre-#955
   half-applied migration that every deploy since has skipped. **Until it has been run, a
   deploy that adds or changes schema is not cleared.**
2. **Prove a backup restores, today, on the NAS** (component 12) — `deploy-synology.sh` does
   not do this.
3. **Confirm Orthanc resolves from inside `care-api`, and establish which `care-pacs` commit
   the running `care-ohif` actually is** (components 3 and 4).
4. **HOPE callback liveness** (component 2) — required before clinical rollout of referrals,
   not before the ERP serves reports.

Then the sequence in `CARE_ERP_DEPLOYMENT_RUNBOOK.md` §12 is safe for the **owner to run
manually, one step at a time**. Each of those four items is carried, with the exact condition
that closes it and whether it blocks a code-only versus a schema-touching deploy, as CL-1…CL-8
in `CARE_ERP_PREDEPLOYMENT_GATE.md` Part 2. This is not a green light for anything automatic:
nothing in this assessment was executed against the clinic, no credential was read, changed or
rotated, no production database was touched, and no container was restarted.
