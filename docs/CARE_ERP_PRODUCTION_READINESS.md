# CARE ERP / PACS — Production Readiness Matrix

_Assessed 2026-10-13 against `main` = `8ca20cf9` (#950, #951, #952, #954, #955, #957,
#958 merged; #959 open). Owner decision still deferred: production credential rotation
and Git-history remediation are out of scope and untouched by this document._

**A green CI run is not a readiness verdict.** Every row below says which evidence was
measured **LOCALLY on this repository**, which is **CI on Linux**, and which can only be
answered **ON THE BOX** — and no component is marked READY on the strength of CI alone.
Four of the twelve components have an open blocker whose answer requires the NAS or the
clinic database, not a test run.

Overall recommendation: **CONDITIONALLY READY** — see §Summary.

## Status scale

| Status | Means |
| --- | --- |
| READY | measured here, no known blocker; deploy risk is ordinary |
| CONDITIONALLY READY | code is proven, but a named precondition must be satisfied on the box first |
| NOT READY | a known defect or missing artefact blocks it |
| UNVERIFIABLE HERE | the truth exists only on the NAS / clinic database; stated as unknown rather than assumed |

## The matrix

| # | Component | Status | Evidence | Remaining blocker | Deployment risk | Required action |
|---|---|---|---|---|---|---|
| 1 | **CARE ERP** (API + SPA) | CONDITIONALLY READY | Sequential full suite on `main`: **29 failed files / 953 passed / 4 skipped (986)**, **23 failed tests / 12060 passed / 15 skipped**. The same 29 files fail at the pre-merge baseline `cd752a43`, so the six merged PRs regressed nothing while adding 115 passing tests. LOCAL | The 23 local failures are Windows/worktree artefacts, not product defects — but they are not individually triaged either, so they cannot yet be certified as noise | Medium. Nothing on this line stops a deploy; it stops a *clean* claim | Run `pnpm typecheck` and the suite once on the NAS (or accept CI as the arbiter) and reconcile the 23 against CI's green |
| 2 | **HOPE integration** | UNVERIFIABLE HERE | The keys exist and are interpolated (`HOPE_PARTNER_KEY`, `INTEGRATION_HOPE_SIGNING_SECRET`, `INTEGRATION_HOPE_CALLBACK_URL`, `HOPE_CARE_INTEGRATION_FORCE` in `deploy/synology/care.env`, `docker-compose.yml`, and seeded by `deploy-synology.sh:117-120`); `POST /api/internal/radiology/send-report-to-hope` is the outbound leg | Whether the callback is reaching a live HOPE **today** cannot be answered from this repository, and the shared secrets are the ones in tracked files that the owner has deferred rotating | Low–Medium: a broken referral handoff does not stop the ERP serving reports | On the box: `curl` the HOPE callback health from `care-api`, then send one test referral and read both sides' logs. Do not rotate or re-issue anything without the owner's window |
| 3 | **Orthanc** | CONDITIONALLY READY | `ORTHANC_INTERNAL_URL` defaults to `http://care-orthanc:8042`; the worklist bind mounts point at `/volume1/docker/care-pacs/orthanc/worklists`; `pacsImagePicker.request.test.ts` pins attach, multiframe frame selection, cross-study refusal and the PACS-down path | `care-pacs` is a **different compose project on its own bridge network**, so that hostname only resolves if the projects share a network — which is exactly why `ORTHANC_CHANGES_POLLER` exists and must be `false` when `care-erp-sync` runs | Medium: if it does not resolve, image attach silently degrades to whatever is already frozen | Step 10 of `CARE_ERP_DEPLOYMENT_RUNBOOK.md` §12: `docker exec care-api sh -c 'wget -qO- "$ORTHANC_INTERNAL_URL/system"'` and require Orthanc's version JSON |
| 4 | **OHIF viewer** | NOT READY (as deployed) | D2's displayed-image identity work is merged in `care-pacs`/ERP (`presentation_json`, the frame trap, `EmbeddedWadoViewer`); the ERP side renders its own thumbnails through `care-api`, not OHIF | The **`care-ohif` image is built from another repository** and cannot be proven current from here; a code merge in `care-pacs` does not recreate that container | Medium: a stale OHIF shows the viewer without the identity fix while the ERP looks correct | On the box: `docker inspect --format '{{.Image}} {{.Created}}' care-ohif` against the `care-pacs` SHA, and rebuild if older. This repository cannot do it |
| 5 | **PACS image picker** | READY | `pacsImagePicker.request.test.ts` **10 tests pass on `main`** (12 with #959's two new legs); 49 pass across every suite that uses the DICOMweb double (attach, `frozenKeyImages`, `radiologyImageIdentity`). #959 adds the 429 refusal and the attach→label→reorder→reload journey | Browser-level "radiologist clicks Select images from PACS" is not covered by any test; the coverage is HTTP + renderer | Low | Optional follow-up: one Playwright journey on the box. Do not treat the passing request tests as UI proof |
| 6 | **Report generation** | CONDITIONALLY READY | Composer/draft/finalize chains are covered by `composeIdentity`, `composeSourceIdentity`, `keyImageOwnership`, `d5`, `signatureWithdrawalReopensStudy` request tests, all green locally | `structuredReport/renderer.test.ts` fails **4 assertions locally on `main` and at the pre-merge baseline alike** (`FINDINGS:`/`TECHNIQUE:` text differs) — pre-existing, but nobody has proven it is a platform artefact. Separately, `reportComposer/persona/index.ts` carries **duplicated switch arms** (see below) | Medium: the renderer is what prints the clinical text; an unresolved diff there deserves an answer, not a shrug | Run `structuredReport/renderer.test.ts` on Linux/CI and compare; file the persona duplicate as its own cleanup so nobody edits the dead copy |
| 7 | **Browser printing** | READY | `reportPresentation.printLayout.test.ts` drives **real Chromium** with print media emulation: 6 tests pass, page counts come from produced PDF bytes, and #959 adds the caption matrix (labelled / never labelled / cleared-to-whitespace) asserted both in markup and as rendered text with measured box heights. Three mutants of `reportPresentation.ts` were run against it locally and all three were caught, by *different* legs: emitting the caption element unconditionally → markup count `4 ≠ 2`; upper-casing it → the **rendered-text** leg only (the markup check still passed, because `<img alt>` carries the original case); `display:none !important` on `.image-caption` → the **measured-height** leg only (innerText on an unrendered element still returns its text). Reverted byte-exact afterwards (`git diff` on that file empty) | The institutional CSS layer can still win over `reportPresentation` where it uses `!important` — mutation 3 shows the suite now detects that on this page, but only for captions; it is not a general CSS-override test. A full "radiologist clicks Print" journey is not covered | Low–Medium: a layout regression is visible to the radiologist immediately, so it is noticed early | None blocking. Re-run the print suite after any template or CSS change |
| 8 | **Download PDF** | READY | Measured in the sequential run on `main`: `reportPdfGenerator.keyImageCaptions.test.ts` **8 tests ✓**, `reportPdfGenerator.letterpad.test.ts` **3 tests ✓**, plus `allKeyImages`, `markdown`, `signatureFit`, `spacing`. No PDF suite appears among the 29 local failures | `AGENTS.md` still lists `reportPdfGenerator.letterpad` as an environment-dependent failure needing the `pdftotext` binary — on this machine it **passes** (so `pdftotext` is present), and one of its three assertions deliberately avoids the binary by reading the PDF's own text operators (`letterpad.test.ts:77`). The stale note is the risk here, not the code | Low | Correct `AGENTS.md` so nobody dismisses a real letterpad failure as "environmental" |
| 9 | **Durable PDF** (server-rendered artefact) | READY | #954's `reportStudyIdentity.request.test.ts` passes: `pdf`, `public_pdf` and `email` surfaces each carry the accession only when the server can prove it belongs to that patient, and print **nothing** rather than another patient's identifier when the study reference collides in the shared id space | None known in code. What is *not* proven is the clinic's real print volume end to end | Low–Medium: this is the document that leaves the building (WhatsApp/email) | Include one real durable PDF in step 11 of the runbook and read its header lines |
| 10 | **Database migrations** | CONDITIONALLY READY | #955 makes a failed Drizzle file stop the deploy instead of being recorded and skipped forever; `scripts/db-patch-entrypoint.test.mjs` 13 tests + `scripts/audit-migration-ledger.test.mjs` 27 tests pass at `8ca20cf9`, 9/9 parser mutants caught; detection proven on three synthetic databases, and the clean baseline reports **0 critical / 0 warnings / 1 informational**. The audit's *read-only* claim was prose until #961 gave it a source gate | **The ledger audit has never been run against the clinic's database.** Every pre-#955 deploy is a window in which a half-applied migration could have been recorded and then skipped on all later deploys. This is the single largest unknown in the whole matrix | High if unanswered: a deploy over an unverified ledger keeps serving a schema the ledger claims is complete | Step 4 of the runbook: `docker compose run --rm --no-deps schema-verify node scripts/audit-migration-ledger.mjs --json=output/ledger-audit-<date>.json`. Read every critical line before rebuilding anything. Never rewrite a ledger row to silence it |
| 11 | **Deployment script** | CONDITIONALLY READY | #952 replaced a probe that could never pass (port 8080 is not published on the host) with `scripts/deploy-health.mjs` against `${HOST_PORT:-8888}`, and both wait loops now fail on timeout instead of falling through to `DEPLOYMENT COMPLETE` | `deploy-synology.sh` still takes **no backup** before `git reset --hard` + `compose down --remove-orphans`, and it still writes two live Hope secrets into `.env` by name (`deploy-synology.sh:117-120`) | Medium: the backup omission is the difference between a rollback and an incident | Keep step 3 (`synology-nas-backup.sh` + `verify-backup-restore.sh`) as a human gate before running the script. Leave the secrets alone until the owner schedules rotation |
| 12 | **Backup and rollback** | CONDITIONALLY READY | `scripts/synology-nas-backup.sh` dumps with `pg_dump` straight out of `care-db` (works while `care-api` is down), `scripts/verify-backup-restore.sh` restores a real artifact into a throwaway container with `ON_ERROR_STOP=1` and fails when `patients`/`bills` land empty, `scripts/synology-restore.sh` now sniffs gzip magic so both artifact shapes restore | Whether a restore has been **proven recently on this NAS** is not knowable from the repository — only the NAS has the artifacts. Encrypted backups are unreadable if `SESSION_SECRET`/`BACKUP_PASSPHRASE` change without keeping the previous value for the window | High: this is the only real safety net, and migrations are forward-only | Run step 3 before every deploy and keep the verified artifact; record image IDs (`docker inspect --format '{{.Image}}' care-api care-web`) as step 5 does, because the app images are built, not pulled |

## Two findings that belong to no single component

1. **A prompt file with dead arms.** `artifacts/api-server/src/lib/reportComposer/persona/index.ts`
   contains `PROFESSIONALIZE`, `OBSERVATIONS` and `COMBINE` **twice** (lines 77–107 and an
   exact copy at 108–138). esbuild warns on every build —
   `This case clause will never be evaluated because it duplicates an earlier case clause` —
   and the warning is visible in any local test run. Today the first copy wins and both are
   identical, so **behaviour is correct**; the defect is that the visible-looking second copy
   is unreachable, so a future edit there changes no prompt anyone sends. Cleanup is a separate
   change; it is listed rather than fixed here because this document is a report.
2. **A server-side rate limit that cannot be told from an outage.** `grep` for `429` in
   non-test files under `artifacts/api-server/src` finds only CARE's own limiter
   (`middleware/rateLimits.ts`, `app.ts`, `routes/portal.ts`) and WhatsApp's upstream
   handling — **nothing in the PACS path**. `lib/reportImages.ts:186` returns `null` for
   every non-OK response, so a 429, a 500, a timeout and a corrupt object arrive at the
   print/PDF leg as one event. #950 fixed this on the **client** (`fetchApi.ts`,
   `studyUidLookupNotice.ts`, `frozenKeyImageRailState.ts`), and #959 pins the guarantee
   that does hold server-side: a refused attach fabricates no row and no file. Fixing the
   classification means giving `fetchPrintImageBytes` a typed outcome, which touches every
   caller — worth its own ticket.

## Summary — recommendation

**CONDITIONALLY READY.**

Nine of the twelve components are READY or CONDITIONALLY READY on evidence measured in
this repository, with the merges of #950–#957 verified to have introduced **zero** new
failing test files. The system is not READY because of four named, unresolved items, and
three of them are simply questions that have never been asked on the clinic's own box:

1. **Run the migration-ledger audit against the clinic database (component 10).** This is
   the gating item. It is read-only, takes seconds, and is the only thing that can reveal a
   pre-#955 half-applied migration that every deploy since has skipped.
2. **Prove a backup restores, today, on the NAS (component 12)** — `deploy-synology.sh`
   does not do this for you.
3. **Confirm Orthanc resolves from inside `care-api`, and that `care-ohif`'s image is
   current (components 3 and 4)** — both are cross-project questions this repository can
   ask but not answer.
4. **Reconcile `structuredReport/renderer.test.ts` against CI (component 6)** — four local
   assertion diffs on clinical text, identical before and after the merges, are pre-existing
   but unexplained.

Then the deploy sequence in `CARE_ERP_DEPLOYMENT_RUNBOOK.md` §12 is safe to run
**manually, one step at a time, by the owner**. It is not a green light to merge or
deploy anything automatically: nothing in this assessment was executed against the
clinic, no credential was read, changed or rotated, and no production database was
touched.
