# KNOWN ISSUES

Baseline `origin/main` `1c80f2d3`, measured 2026-10-20 (first written at `c4462041` the same day; the
rows that moved are corrected in place, with the old wording kept where it carries a lesson). Four
classes: live risks (§1), documentation that contradicts the code (§2 — the PHASE 5 corrections),
repository/environment hygiene (§3), and verification traps that have produced false verdicts on this
project (§4).

Every claim here was re-read from the tree or from the GitHub API during this audit. Where the
claim came from a subagent and turned out to be wrong, §5 says so — that record is part of the
product.

---

## 1. Live risks, ordered

| # | Issue | Evidence | Why it matters |
|---|---|---|---|
| R-1 | **The clinic is running a build whose commit identity is unproven, and it is 111 commits behind `main`.** | Last recorded deploy `2026-10-12T22:22:4xZ` (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:712`); `/api/health` reported `2d51e8d7` while the checkout was `46d36612`, listed under *"Refuted by this pass"* (`:357`, `:738`). The 111 is `git rev-list --count --since=2026-10-12T22:30:00Z origin/main` at `47b739c8` — it was 106 at `c4462041` and 108 at `1c80f2d3` the same day | The merged wrong-patient / wrong-exam P0 fixes (#1040, #1042, #1044, #1058, #1047) are not what is printing |
| R-2 | **Deploy takes no backup and no restore has ever been proven.** | CL-3 `deploy-synology.sh` steps are `git reset --hard` → `compose down --remove-orphans` → `up -d --build` (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:721`); CL-2 `public.backup_verification` 0 rows (`:719`) | A failed deploy has no proven way back |
| R-3 | **20 zero-byte database dumps, six consecutive nights.** | `/volume1/docker/backups/postgres/care`, `care_erp_<date>_<hh-mm>.dump`, `docs/CARE_ERP_BACKUP_COVERAGE.md:85` — 20 of 62 empty, 2026-10-10 → 2026-10-15, owner `abinash:users`, mode 777 | A second job exists that produces nothing and looks like a backup |
| R-4 | **Signed-report images are on disk, not in the dump.** | `lib/frozenKeyImages.ts:33` → `data/uploads/radiology-key-images`, volume `uploads_data`; frozen rows drive print/PDF (`:1-14`), missing file renders the placeholder with `integrityOk:false` (`:46`) | DB-only restore loses every image in every signed report |
| R-5 | **PACS ports published to the whole LAN.** | CL-9 (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:727`): Orthanc **8042** and **5680**, OHIF 3010, `care-web` 8888, HOPE 7080 on `0.0.0.0`; 5680 is `"5680:4242"` in `care-pacs/docker-compose.yml:70` | Any LAN device can `C-STORE` into the production archive unauthenticated |
| R-6 | **No image sent to a cloud provider is de-identified.** | `lib/ai/dicomRedaction.ts:17` `DICOM_REDACTION_PERFORMED = false`; the audit row hard-codes `anonymized: false` with the comment *"nothing in CARE strips identifiers from an image before sending it"* (`lib/ai/imageSendAudit.ts:177-180`, insert at `:163`) | Cloud vision egress moves original pixels. Guarded by the mode/allow-list, not by redaction |
| R-7 | **A development checkout on a copy of production can reach the clinic.** *(corrected 2026-10-20)* | This row said the refusal mechanism was "PR **#1081**, still Draft". **#1081 merged as `c208cbfb`** at 21:39Z on 2026-10-19 — while this file was being written. On `main` now: `package.json:14` `dev:isolated`, `artifacts/api-server/src/devIsolationBoot.ts`, `devIsolationDoors.test.ts`, `devIsolationStartup.test.ts`. What has **not** changed: it is not deployed, and nothing on this Windows box has run it — ports `8181`/`5173`/`5411` are still not listening (`CURRENT_STATE.md` §6), so **the isolation is available, not in use** | Until an operator actually starts `pnpm dev:isolated`, isolation is still an operator habit |
| R-8 | **HOPE integration has never delivered anything.** | CL-6 (`:724`): `integration_outbox` 0 rows, `integration_delivery_attempts` 0 rows, `external_result_links` 0/0/0; two different callback hosts are configured in two different files, one of which TCP-times out | All the outbox hardening (#995-#999) is unexercised |
| R-9 | **DICOM pull can report success with zero instances received.** | RIS-007 `dimse-agent.ts:363`, `:488`, status *"CONFIRMED (code) / NOT REPRODUCIBLE live"* (`docs/engineering/RIS-PACS-INTEGRATION-TODO.md:38`) | A study believed acquired may never have arrived |
| R-10 | **Image fetch failures are silent at the reader, though no longer silent on the page.** *(corrected 2026-10-20 after #1085)* | `lib/reportImages.ts:147` and `:186` still `if (!res.ok) return null;`, and `resolveDraftKeyImages` turns that into `src: src ?? ""` (`:254`). **What changed:** the rendered surfaces now label such a cell — `lib/reportPresentation.ts:515`, `lib/radiologyReportPdfExport.ts:131` (`IMAGE COULD NOT BE READ`) and `lib/reportPdfGenerator.ts:752` (`KEY IMAGE #n COULD NOT BE READ`) — merged at `47b739c8`, **not deployed**. **What did not change:** the reason (down vs timeout vs 0 bytes vs over-max) is still discarded, and `if (budget < reserve) continue` (`:238`) can print fewer cells than the draft has attachments with nothing recording the omission. CL-8 in `docs/CARE_ERP_PREDEPLOYMENT_GATE.md:728` still quotes the old behaviour and needs re-reading against a deployed build | A patient no longer gets a black square pretending to be a dark study; an operator still cannot tell why a picture is missing, and a report can lose images by budget rather than by choice |
| R-11 | **Staging acceptance cannot be tied to a SHA.** | CL-10 (`:728`): `d2stg-*` stack runs from `/volume1/docker/care-d2-staging/care-erp`, **not a git repository**; `d2stg-orthanc` uses the unpinned `orthancteam/orthanc:latest` | Verdicts from staging are not evidence about production |
| R-12 | **The `care-erp-sync` container is the only working Orthanc→ERP path, and its secret has a weak default.** | `docker-compose.yml:337-351` (the in-process poller ENOTFOUNDs `care-orthanc`; *"RUN EXACTLY ONE"*); `PACS/care-erp-sync/care_erp_syncV3.py` header + `compose:167` ship a literal default key (not reproduced here) and the compose starts `care_erp_sync.py` while the `/changes` v3 logic is in `care_erp_syncV3.py` | Duplicate/absent study sync plus a guessable shared secret |
| R-13 | **`main` was red on CI — RESOLVED 2026-10-20 by #1086.** *(kept in place; the lesson is the point)* | Original finding, measured at tip `c4462041`: run `39319802877` failed `aiReporting.imageEgress.request.test.ts > TEST 15` with `expected [ 'medgemma1.5:4b', 'qwen3-vl:8b' ] to deeply equal [ 'qwen3-vl:8b', 'medgemma1.5:4b' ]` at `:965:44` (`Test Files 1 failed | 1127 passed | 5 skipped`). Reproduced byte-identically on a documentation-only head (`38530427`, run `39321817651`), which proved it was `main`'s and not the PR's. **Resolution:** #1086 (`1c80f2d3`) established that arm *dispatch* order is the kernel's decision and arm→row mapping is deterministic, so the test now asserts the deterministic `(armIndex, model, imageCount)` table plus a **sorted** transport multiset, and TEST 15b forces the opposite completion order behind a 2 s barrier with a positive control. CI at `1c80f2d3`: 3/3 jobs success, **50 tests** in that suite | The lesson stands: **a red that every PR inherits is how a real regression gets waved through**, and the fix was to stop demanding a non-deterministic order, not to delete the assertion |
| R-14 | **Structured Findings edits are invisible to dirty-detection, the leave warning and the local backup.** *(new, measured this pass)* | `lib/workspaceReportState.ts:63-71` `serializeReportSnapshot` hashes only `ch, t, rf, im, re, qs` — **not `findingsMap`**; `isReportDirty` (`:74`) and `BackupEnvelope` (`:85`) are built on it, while `findingsMap` is live UI state (`workspace/ReportCanvas.tsx:249,:1487`) | This is finding **C2** of the July 2026 independent audit, still true 3 months and ~700 PRs later. Unsaved structured work can be lost silently — see `CLINICAL_SAFETY_REGISTER.md` §7 |
| R-15 | **The entire structured clinical path is switched off by default.** *(new; not a defect, an unrecorded decision)* | `ff_radiology_structured_final` `defaultValue: false` (`lib/radiologyFeatureFlagRegistry.ts:55-56`), `ff_radiology_structured_read` `defaultValue: false` (`:68-69`) with the rollback text *"disable → read surfaces fall back to stored legacy HTML/body"*, `ff_radiology_critical_result_comms` `defaultValue: false` (`:194`) | Sign/finalize, print/PDF reading and critical-result comms all take the legacy route in a fresh deploy. Every claim about "structured" behaviour must say which flag state it assumes |
| R-16 | **A signed report can carry a signer name the server was told, not a signer the server authenticated.** *(new)* | `routes/internal-reporting-studio.ts:845` takes `boundRelayedPersonName(b.radiologistName, "Reporting Studio")` and writes it at `:889`/`:891`; the router is guarded by a machine key (`requireStudioKey` `:77,:91`), not a staff session. The ERP path by contrast refuses to use a body name at all (`routes/patient-reports.ts:2584-2618`) | Two doors, two proof levels for the same printed name. The owner's rule — a display name is not a signature — is enforced on one door only (`CLINICAL_SAFETY_REGISTER.md` §9) |
| R-17 | **A report with no signer can still print "Signed: Dr. …".** *(new, found while re-checking #1085 at `47b739c8`)* | `lib/reportPresentation.ts:715-717`: when `model.signatures` has no name and no image, the letter-pad layout substitutes `{ name: pad.radiologist, qualification: pad.credentials, label: "Signed:" }` from the **static** clinic letterhead (`lib/careLetterheadChrome.ts:24-25`). `routes/patient-reports.ts:3334` returns `null` from `sigModel` when a report has neither a `signatureId` row nor a `signedByName`, so `signatures: []` is reachable — and `GET /api/patient-reports/:id/print` (`:3524`) has **no signed-status gate**. The behaviour is pinned by a test: `reportPresentation.test.ts:202` (*"letter-pad header, footer, Sugandha default…"*), `:214` asserts the name. #1085 removed the same class of invented name from the **preview** door (`- const fallbackName = "Dr. Sugandha Priyadarshini"`) and replaced it with the structural chooser `lib/reportSignerSelection.ts`, which returns `null` → no signer prints | This is the owner's *"never confuse a report display name with an authorized digital signature"* rule, violated on a patient-facing surface. It needs an **owner decision** before code: either the letter-pad default uses `printSigner()` (null → nothing prints) or the print route refuses the fallback for unsigned reports. Do not "fix" it silently — a one-radiologist clinic may want the letterhead default on *previews* |

---

## 2. Documentation that contradicts the code (PHASE 5 corrections)

Historical documents are **not deleted or rewritten** by this audit. Each row says what the file
claims, what the tree does, and how to re-check.

| Document | Claim | Reality, verified this pass | Re-check |
|---|---|---|---|
| `docs/audits/radiology-reporting-engine-dependency-map-2026-10-19.md:12-15`, `:191` | *"Neither is merged; neither is deployed"* about #1070/#1071 | **Both merged**: #1070 `02e47dff`, #1071 `d673f1cc`. The doc also cites #1071's head as `1de6b02b`; the merged head was `0e7a2726` | `GET /pulls/1070` / `1071`; `git merge-base --is-ancestor 02e47dff origin/main` |
| `docs/engineering/RIS-PACS-INTEGRATION-TODO.md:37` (RIS-006), `:43` (RIS-012) | #1047 `Merged: no` | **Merged** as `795eb069` (3 files, +1136/−6) | `GET /pulls/1047` |
| `docs/architecture/radiology-ai/15-security-model.md:53` | Audit chain *"**Permanent** — never updated or deleted (`REVOKE UPDATE/DELETE`, unique `chain_hash`)"* | Three separate falsehoods. (a) `scheduleAuditLogPurge` deletes rows daily (`cron.ts:66`, `:865`, `RETENTION_DAYS = 730` `:875`); (b) **no `REVOKE UPDATE`/`REVOKE DELETE` exists anywhere** in `migrations/`, `lib/` or `artifacts/`; (c) `chain_hash` is indexed by a **non-unique** btree — `CREATE INDEX IF NOT EXISTS "audit_chain_hash_idx"` (`migrations/zz_schema_reconcile_20260709.sql:26625`). The same file **corrects itself at `:30-43`** — a correction banner 14 lines above the false table row | `grep -rn "REVOKE " migrations lib`, `grep -n audit_chain_hash_idx migrations/*.sql` |
| `docs/architecture/radiology-ai/15-security-model.md:41-43` | *"image sends on the report-Composer path write no audit row at all (no audit insert exists anywhere in `artifacts/api-server/src/lib/reportComposer/`)"* | **Now false.** `reportComposer/jobService.ts:571` calls `recordImageSendAudit` (`lib/ai/imageSendAudit.ts:153`), which inserts into **`ai_reporting_audit_logs`**. Landed with #1076 `66d2c116` / #1078 `a787bafb`, after the banner was written | `grep -n recordImageSendAudit artifacts/api-server/src/lib/reportComposer/jobService.ts` |
| `docs/architecture/radiology-ai/04-ai-gateway.md:134` | *"**Every** cloud egress is written to the hash-chained `audit_logs`"* | The image audit writes `ai_reporting_audit_logs`, **not** the hash-chained `audit_logs`. Different table, no chain hash | `sed -n '163,190p' lib/ai/imageSendAudit.ts` |
| `docs/architecture/radiology-ai/ARCHITECTURE_CHECKLIST.md:18` | *"One evaluation framework ✅ (P2) — golden set + runs + shadow/candidate/live human gate"* | The framework is **unwired**: `runEvaluation` occurs only at its definition (`lib/ai/evaluationRunner.ts:36`); `admitJob` only at `lib/ai/aiScheduler.ts:120` + tests; **zero inserts** into `ai_golden_cases` (`lib/db/src/schema/aiEvaluation.ts:36`) | `grep -rn "runEvaluation" --include=*.ts artifacts lib` |
| `docs/architecture/radiology-ai/14-safety-risk-and-failure-recovery.md:128` | `audit_logs` loss target *"0 (must never lose)"* | Purged at 730 days (cron.ts:865), archived first to `data/archives/audit-logs` — so a restore that omits that directory loses the older spine | read `cron.ts:882-907` |
| `CARE_RADIOLOGY_IMPLEMENTATION_GUIDE.md:590` and `:2197` | *"there is no purge job"*; *"individual rows are never deleted"* | Both contradicted by `scheduleAuditLogPurge` (`cron.ts:66`, `:865`) — and `:2197` is specifically about the `audit_logs` chain | same |
| `AGENTS.md:32` | poppler installed at `.github/workflows/ci.yml:85-92`; path `lib/objectStorage.ts`; totals *"12,060 passed / 23 failed … 986 files"* measured 2026-10-13 | poppler is `ci.yml:151-158`; the file is `artifacts/api-server/src/lib/objectStorage.ts`; current CI at tip `1c80f2d3` is **15,406 passed / 49 skipped over 1133 files (1138 total)** in 775.25 s. The line is *dated and honest about being dated*, but its three specifics are now wrong | `grep -n poppler .github/workflows/ci.yml`; Actions run `39361881382` log |
| `AGENTS.md:35` | *"The React frontends (`diagnostic-erp`, `clinic-site`) fail typecheck … duplicate `@types/react`"* | **CI typechecks every package clean**, including both, at `6a31307f` (`1_Static checks…` log: `artifacts/diagnostic-erp typecheck: Done`, `artifacts/clinic-site typecheck: Done`). The fix is visible in `pnpm-workspace.yaml` — `catalog` pins `@types/react: 19.2.14` plus a repo-wide `overrides` block | read the CI job log; `grep -n "@types/react" pnpm-workspace.yaml` |
| `CONFIG_GUIDE.md:12` | API server default **`localhost:3000`** | `artifacts/api-server/src/index.ts:2835` defaults `PORT` to **8080**, which `AGENTS.md:9` also states | `grep -n 8080 artifacts/api-server/src/index.ts` |
| `CONTRIBUTING.md:96`, `DEVELOPMENT_PRINCIPLES.md:241`, `CHANGELOG.md:213` | *"164+ tests"*, *"all 164+ tests"*, *"2607 pass"* | CI runs **15,243** across **1127 files**; the tree holds 1107 `*.test.ts` + 23 `*.test.mjs`, 73 of them `*.request.test.ts` | count + Actions log |
| `docker-compose.yml:5` vs `CARE_RADIOLOGY_IMPLEMENTATION_GUIDE.md:309` | Guide orders `care-db → care-migrate → care-db-patch-v2 → care-api → care-web` | Compose chain is `db → db-patch-v2 → schema-verify → api → web`; the guide invents `care-migrate` (a `manual`-profile container at `docker-compose.yml:590`) and drops `schema-verify` | read `docker-compose.yml:5` |
| `docs/ai-memory/workspace-analysis.md` | Frozen at 2026-09-27, yet `.cursor/rules/workspace-memory.mdc` makes every agent *"Read docs/ai-memory/workspace-analysis.md first … Never re-derive §1 topology"* | §1 topology is correct, but the instruction to never re-derive it freezes a 24-day-old snapshot as authority | open both files |
| `.cursor/rules/workspace-memory.mdc:3` | `globs: artifacts/diagnostic-erp/src/**, ../../usg-reports/src/**` | The second glob points **outside this repository** and can never match | read the file |
| `.agents/memory/MEMORY.md` | 8 indexed entries | **2 links are dead** (`ai-safety-label.md`, `schema-drift-silent-failures.md`) and **2 files are unindexed** (`ai-model-routing.md`, `ai-table-deploy-migrations.md`) out of 9 files in `.agents/memory/` | `ls .agents/memory` vs the index |
| `docs/architecture/radiology-ai/STAGE1-IMPLEMENTATION-PLAN.md:36`, `:40-41` | Plan says to delete `lib/ai-providers/src/endpointTrustPolicy.ts`; asserts *"the Composer path writes no audit record at all"* | The file is **already absent**; the audit claim is stale (row above). The plan still self-labels *"Planning document only"* with no status banner | `ls lib/ai-providers/src/` |
| **A documentation maintainer's own brief** (2026-10-20) | *"Read CARE_COMPOSER_OWNER_VISION.md"* — treating the owner's approved vision as an existing tracked file | **No such file exists**, and no file matches the titles *"CARE Composer Completion Audit"*, *"Independent Systems Audit"* or *"Read-only Clinical Safety Audit"* either (`git grep -i -e "completion audit" -e "clinical safety audit"` → zero on `main`). The vision now has a home: `docs/project-memory/OWNER_VISION.md`; the three registers are mapped in `AUDIT_RECONCILIATION.md` §1, which states the mapping is an inference. **That home is on this branch only** — `git ls-tree -r --name-only origin/main | grep -i vision` is **empty at `47b739c8`** | `git ls-tree -r --name-only origin/main \| grep -i vision` |
| `docs/project-memory/*` (this set) | Reads as the project's memory | **It IS on `main` now** — merged as `d45370c3` (#1083, 2026-10-20 03:48:31Z), with the Composer docs landing at `d7abb9b3` (#1084) minutes later. **Correction (same day):** an earlier revision of this row said *"It is not on `main`… only on branch `docs/project-memory-reconstruction` = Draft #1083"*; that was true when written and stopped being true while it was being written. **The contradiction has not gone away, it changed shape:** the copy that merged is the `c4462041` snapshot, so `main` carried a memory file asserting (a) `main`'s test job is red, (b) #1081 is a Draft, (c) three PRs are open — all three overtaken within hours, and now corrected in place by the follow-up commit on this branch. Treat any file in this directory as **dated, not current**: read its baseline SHA and re-run `CURRENT_STATE.md` §8 before quoting it | `git ls-tree -r --name-only origin/main -- docs/project-memory` → **6 files** on `main`, **9** on this branch: `OWNER_VISION.md`, `AUDIT_RECONCILIATION.md` and `CLINICAL_SAFETY_REGISTER.md` are **still unmerged**, so the owner's vision and the two newest registers are invisible to an agent starting from `main`; `GET /pulls?state=open` |
| PRs **#1076** and **#1077** | #1076's body: *"Status: DRAFT. Not merged, not deployed, nothing enabled."* · #1077's **title**: *"Draft — Composer usability-first…"* | Both are **merged** (`66d2c116`, `6a31307f`). A merged PR whose own text says Draft is a navigation hazard for the next reader — and for #1077 it is partly true: its body records that only the *first round* merged and a corrections round is outstanding. Fix the body/title when the next change lands on that branch, do not "clean it up" silently | `GET /pulls/1076`, `GET /pulls/1077` |

### Navigation problems (same class, no single file to blame)

* **No root `README.md`.** `AGENTS.md` exists but does not point at `docs/`, and nothing routes an
  agent away from stale material.
* **`docs/` is 5,618 files** (278 `.md`, 241 subdirectories) and `Antigravity/` adds **101** more,
  including two byte-identical copies of the same security audit under different names.
* **~40 loose `.md` at the repo root**, among them a 555 KB `CARE_RADIOLOGY_IMPLEMENTATION_GUIDE.md`
  that carries the false retention claims above.
* **`docs/archive/` holds 56 `.md`** that live documents still cite as authority
  (`docs/CARE_HOPE_CREDENTIAL_ROTATION_RUNBOOK.md:389`, `docs/CARE_STAFF_HR_AUDIT.md:136`,
  `docs/FINGERPRINT_ATTENDANCE_INTEGRATION.md:157`).
* The most current register of open work is `docs/engineering/RIS-PACS-INTEGRATION-TODO.md`
  (running table `:30-46`, PR + SHA evidenced, tracks merged-but-not-deployed). Secondary:
  `docs/CARE_ERP_PREDEPLOYMENT_GATE.md` CL-1..CL-10 and
  `docs/architecture/radiology-ai/AI-SCREENSHOT-WORKFLOW-REUSE-AUDIT.md` §12/§13.

---

## 3. Repository and environment hygiene (measured on this machine)

* **99 git worktrees** under `C:\Users\Admin\Documents\GitHub` for one repository, ~40 of them
  agent-session leftovers (`care-m1-red`, `care-p5-integration`, `care-933-integration`, …), plus
  loose `pr973.json`…`pr979.json` in `Documents/GitHub`.
* **The primary checkout `care-on-synology1` is not usable for work**: 57 dirty paths, one unmerged
  `DU` index entry, and local `refs/heads/main` **1 ahead / 184 behind**, where the ahead commit
  `e0991715` is *superseded* — its content reached `main` through PR #929 and evolved there
  (`git merge-base --is-ancestor e0991715 origin/main` → false; `scripts/preview-staff-reconciliation.mjs`
  blob identical to `main`'s). Do not `git reset --hard` it without the owner: those 57 paths are
  someone's in-progress work.
* **PostgreSQL version split**: production and CI are **16** (`server_version 16.14`,
  `postgres:16-alpine`); this Windows box runs **18.3** (`postgresql-x64-18`, service running) with a
  second cluster on 5445 holding **51 scratch databases**. Nothing in CI covers 18.
* **`care-pacs` checkout is on a feature branch** (`fix/orthanc-mwl-housekeeper-crash` @ `53588a0`,
  `origin/main` = `247f0cc`) — reading that directory reads unreleased code.
* **`futurekind-platform` is under `FuturekindHealth`**, not `DrAbinash`; the `DrAbinash` URL 404s.

---

## 4. Verification traps that have produced wrong verdicts here

1. **`merge_commit_sha` is non-null on open PRs** (GitHub's test-merge preview). Read `merged` /
   `merged_at`.
2. **A 404 from a hand-built API URL is a URL bug, not a dead token.** A dead token answers 401.
3. **`mergeable_state` vocabulary**: `dirty` = content conflict; **`unstable` = checks pending or
   failing**; `clean` = both. The clinic's "1013 & 1014 conflict" reports were `unstable`.
4. **A hung `POST /pulls` may have created the PR.** Enumerate `GET /pulls?state=all` before
   retrying.
5. **Git Bash `/tmp` is invisible to native Windows binaries** (`curl.exe`, `python.exe`, `psql`
   paths). Write helper files under the repo's own `tmp/` and convert with `cygpath -w`.
6. **The GitHub token exists only in the primary checkout** (`tmp/gh_token.txt`, gitignored); sibling
   worktrees do not have it. Never pass it in argv; never print it.
7. **`git credential fill` hangs** under a detached shell (GCM prompts suppressed). Push via
   `git -c credential.helper= -c credential.helper="store --file=…"`, and delete the file after.
8. **`grep -c` on a test file is not a test count** — loop-generated suites silently mislead; use
   runtime counts, and print executed/skipped so a `describe.skipIf` no-op cannot masquerade as a
   pass.
9. **Working trees are CRLF**; a multi-line source anchor needs EOL normalisation or the write
   silently no-ops and the mutation battery reports a false catch.
10. **`vi.mock` stops at package edges** — a relative mock in `artifacts/api-server` does not intercept
    an internal import inside `lib/*`.
11. **A mutation survivor usually means a missing test**, but check the mutant applied byte-for-byte
    before believing either.
12. **PDF bytes are timestamp-nondeterministic.** Prove layout from print/screen HTML.
13. **Request tests need a DB and do not skip cleanly**: `describe.skipIf(!hasDatabaseUrl())` guards
    execution, not module-scope `import { db }`, so without `DATABASE_URL` ~94 suites fail to
    **collect** (`AGENTS.md:33`).
14. **CI has a ~10-minute Vitest cap** — a red `main` has been the cap, not the code. Read the step
    and the `Test Files` line before diagnosing.
15. **A merged parent makes its stacked child look `dirty` when the two trees are identical.** Prove
    with `git diff --stat <parent-tip> origin/main` before resolving anything.
16. **A quoted `node -e` harness can silently corrupt its own regex.** Backticks inside
    `node -e "…"` are shell command substitution. This pass got **471** declared tables from such a
    harness and the true **196** from a plain `grep | sort -u | wc -l`; the two methods disagreed and
    only the second was right. Never publish a number produced by one method
    (`ARCHITECTURE.md` §16 records the case).
17. **`execSync` on this box runs `cmd.exe`, not bash — so `… | grep …` returns error text, not
    data.** *(new, caused by this pass)* A re-verification harness built on
    `execSync("git grep … | grep -c …")` printed *"The system cannot find the path specified."* for
    **every** probe and happily reported derived counts (`"journal json lines = 2"` — the real answer
    was **15**). Nothing failed loudly; only inspecting the strings exposed it. Use
    `execFileSync("git", […])` and filter in JavaScript, and make the harness print
    `executed N calls, M errored` so a silent sweep cannot pass as a result.
18. **`git grep`, `git ls-tree` and `git show` scope to the current sub-directory.** *(new, cost this
    pass three false negatives)* A `grep` for *"USG Studio"* and *"Name of Examination"* run from
    `tmp/<something>/` returned **zero matches**, which reads exactly like "the phrase is absent from
    the repository". The phrase was present; `git grep` had restricted itself to the untracked
    `tmp/` prefix. `git ls-tree origin/main` from that directory printed **nothing at all**. Print
    `pwd` before believing any zero, or run from the repo root with an absolute `cd`.
19. **A CI log can contain the word FAIL in a green job.** *(new)* The successful
    `Tests + migration smoke` run `39361881382` at `1c80f2d3` includes
    `[cron] Restore verification: FAIL — verified a fresh pg_dump (NO stored backup artifact was
    available to test)` twice (log lines 8602, 8605). Those are exercised code paths, not failures.
    Read the check-run **conclusion**, then the `Test Files` line, before the noise.
20. **Which month a squash-merge belongs to depends on whether you read author date or committer
    date.** *(new, cost this pass a wrong number)* `git log --date=format:%Y-%m --format="%ad"` put
    **45** PRs in 2026-07; `git log --since=2026-07-01 --until=2026-08-01` (committer date) put **51**
    there, and **49** in the days *after* the 2026-07-16 master audit. Both are true; they answer
    different questions — a squash's author date is when the branch commit was written, its committer
    date is when it landed on `main`. "How much work arrived after this audit?" is a **committer**-date
    question. Say which field a count came from.
21. **A failed `git show` pipes straight into `wc -l` and reports 0.** *(new; produced two wrong rows
    in `AUDIT_RECONCILIATION.md`)* `git show origin/main:artifacts/api-server/src/lib/zai-workspace/store.ts`
    is fatal — the file lives in **`diagnostic-erp`** — yet `| wc -l` prints `0` and exits 0, so a
    pipeline reads it as "empty file" rather than "wrong path". The same pass cited four *comment
    lines that mention* `jspdf` as if they were `import` statements, because the line numbers were real.
    Two rules: **check that the read succeeded before trusting its number**, and **grep the exact
    construct you are claiming** (`import … from "jspdf"`, not `jspdf`).

---

## 5. Claims in circulation that this pass disproved

Recorded because they will come back.

* **"The comparison workspace has zero tests."** Stated as finding **G-20** of the Composer completion
  audit (written at `80a09df4`, i.e. before #1079's and #1086's tests landed). At `1c80f2d3` CI executes
  `routes/aiReporting.imageEgress.request.test.ts` at **50 tests** (`✓ … (50 tests) 2934ms`, run
  `39361881382`) against the real `/api/ai-comparison/run` route. Do not build tests that already exist;
  do not cite G-20 as open.
* **"AI Composer reads only prose."** Superseded: `canonicalCanalAp.ts:39`/`:55` and
  `resolveComposeDraft.ts:117` give the Composer a server-resolved, **read-only** view of the
  canonical canal record (#1063 `bae32727`). Not deployed.
* **"The testids fixture is missing."** An agent reported
  `lib/fixtures/radiologyReportingWorkspace.testids.json` as absent and never-committed. It exists at
  the path the test actually uses: `artifacts/diagnostic-erp/src/lib/fixtures/…` (5,042 bytes; 72
  declared ids, 1 dynamic, 1 querySelector template). The claim was an artifact of resolving the path
  from the repo root instead of from the test file's own directory. **Do not "restore" a file that is
  already there.**
