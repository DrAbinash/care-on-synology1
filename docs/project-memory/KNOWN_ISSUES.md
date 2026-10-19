# KNOWN ISSUES

Baseline `origin/main` `c4462041`, measured 2026-10-20. Four classes: live risks (§1),
documentation that contradicts the code (§2 — the PHASE 5 corrections), repository/environment
hygiene (§3), and verification traps that have produced false verdicts on this project (§4).

Every claim here was re-read from the tree or from the GitHub API during this audit. Where the
claim came from a subagent and turned out to be wrong, §5 says so — that record is part of the
product.

---

## 1. Live risks, ordered

| # | Issue | Evidence | Why it matters |
|---|---|---|---|
| R-1 | **The clinic is running a build whose commit identity is unproven, and it is 106 commits behind `main`.** | Last recorded deploy `2026-10-12T22:22:4xZ` (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:712`); `/api/health` reported `2d51e8d7` while the checkout was `46d36612`, listed under *"Refuted by this pass"* (`:357`, `:738`) | The merged wrong-patient / wrong-exam P0 fixes (#1040, #1042, #1044, #1058, #1047) are not what is printing |
| R-2 | **Deploy takes no backup and no restore has ever been proven.** | CL-3 `deploy-synology.sh` steps are `git reset --hard` → `compose down --remove-orphans` → `up -d --build` (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:721`); CL-2 `public.backup_verification` 0 rows (`:719`) | A failed deploy has no proven way back |
| R-3 | **20 zero-byte database dumps, six consecutive nights.** | `/volume1/docker/backups/postgres/care`, `care_erp_<date>_<hh-mm>.dump`, `docs/CARE_ERP_BACKUP_COVERAGE.md:85` — 20 of 62 empty, 2026-10-10 → 2026-10-15, owner `abinash:users`, mode 777 | A second job exists that produces nothing and looks like a backup |
| R-4 | **Signed-report images are on disk, not in the dump.** | `lib/frozenKeyImages.ts:33` → `data/uploads/radiology-key-images`, volume `uploads_data`; frozen rows drive print/PDF (`:1-14`), missing file renders the placeholder with `integrityOk:false` (`:46`) | DB-only restore loses every image in every signed report |
| R-5 | **PACS ports published to the whole LAN.** | CL-9 (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:727`): Orthanc **8042** and **5680**, OHIF 3010, `care-web` 8888, HOPE 7080 on `0.0.0.0`; 5680 is `"5680:4242"` in `care-pacs/docker-compose.yml:70` | Any LAN device can `C-STORE` into the production archive unauthenticated |
| R-6 | **No image sent to a cloud provider is de-identified.** | `lib/ai/dicomRedaction.ts:17` `DICOM_REDACTION_PERFORMED = false`; the audit row hard-codes `anonymized: false` with the comment *"nothing in CARE strips identifiers from an image before sending it"* (`lib/ai/imageSendAudit.ts:177-180`, insert at `:163`) | Cloud vision egress moves original pixels. Guarded by the mode/allow-list, not by redaction |
| R-7 | **A development checkout on a copy of production can reach the clinic.** | The refusal mechanism is PR **#1081**, still Draft (`feat/care-dev-isolated`, head `469e928d`). On `main`: boot starts pollers/warmers/consumers unconditionally (`index.ts:2958`, `:2965`) and `.env` from a restore carries real callbacks, SMTP and Orthanc targets | Until #1081 merges, isolation is an operator habit |
| R-8 | **HOPE integration has never delivered anything.** | CL-6 (`:724`): `integration_outbox` 0 rows, `integration_delivery_attempts` 0 rows, `external_result_links` 0/0/0; two different callback hosts are configured in two different files, one of which TCP-times out | All the outbox hardening (#995-#999) is unexercised |
| R-9 | **DICOM pull can report success with zero instances received.** | RIS-007 `dimse-agent.ts:363`, `:488`, status *"CONFIRMED (code) / NOT REPRODUCIBLE live"* (`docs/engineering/RIS-PACS-INTEGRATION-TODO.md:38`) | A study believed acquired may never have arrived |
| R-10 | **Image fetch failures are silent.** | `lib/reportImages.ts:186` `if (!res.ok) return null;` — CL-8 *"NOT TESTED … still returns `null` for every non-OK response on `main`"* (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:728`) | A print/PDF that quietly lost a picture is indistinguishable from one that never had it |
| R-11 | **Staging acceptance cannot be tied to a SHA.** | CL-10 (`:728`): `d2stg-*` stack runs from `/volume1/docker/care-d2-staging/care-erp`, **not a git repository**; `d2stg-orthanc` uses the unpinned `orthancteam/orthanc:latest` | Verdicts from staging are not evidence about production |
| R-12 | **The `care-erp-sync` container is the only working Orthanc→ERP path, and its secret has a weak default.** | `docker-compose.yml:337-351` (the in-process poller ENOTFOUNDs `care-orthanc`; *"RUN EXACTLY ONE"*); `PACS/care-erp-sync/care_erp_syncV3.py` header + `compose:167` ship a literal default key (not reproduced here) and the compose starts `care_erp_sync.py` while the `/changes` v3 logic is in `care_erp_syncV3.py` | Duplicate/absent study sync plus a guessable shared secret |
| R-13 | **`main` is red on CI right now**, on one order-dependent assertion inherited by every later PR. | Run `39319802877` at tip `c4462041`: `FAIL artifacts/api-server/src/routes/aiReporting.imageEgress.request.test.ts > … TEST 15` — `expected [ 'medgemma1.5:4b', 'qwen3-vl:8b' ] to deeply equal [ 'qwen3-vl:8b', 'medgemma1.5:4b' ]` at `:965:44`; `Test Files 1 failed | 1127 passed | 5 skipped`. Reproduced byte-identically on a documentation-only head (`38530427`, run `39321817651`), which proves it is `main`'s, not the PR's. The suite was green at #1080's head `76fe43b0` and `80a09df4`'s test job was `cancelled`, so `main` has no completed green test run since `6a31307f` | "CI green" stops being a usable merge signal until this is sorted; a red that every PR shares is how a real regression gets waved through |

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
| `AGENTS.md:32` | poppler installed at `.github/workflows/ci.yml:85-92`; path `lib/objectStorage.ts`; totals *"12,060 passed / 23 failed … 986 files"* measured 2026-10-13 | poppler is `ci.yml:151-158`; the file is `artifacts/api-server/src/lib/objectStorage.ts`; current CI at `6a31307f` is **15,243 passed / 49 skipped over 1127 files**. The line is *dated and honest about being dated*, but its three specifics are now wrong | `grep -n poppler .github/workflows/ci.yml` |
| `AGENTS.md:35` | *"The React frontends (`diagnostic-erp`, `clinic-site`) fail typecheck … duplicate `@types/react`"* | **CI typechecks every package clean**, including both, at `6a31307f` (`1_Static checks…` log: `artifacts/diagnostic-erp typecheck: Done`, `artifacts/clinic-site typecheck: Done`). The fix is visible in `pnpm-workspace.yaml` — `catalog` pins `@types/react: 19.2.14` plus a repo-wide `overrides` block | read the CI job log; `grep -n "@types/react" pnpm-workspace.yaml` |
| `CONFIG_GUIDE.md:12` | API server default **`localhost:3000`** | `artifacts/api-server/src/index.ts:2835` defaults `PORT` to **8080**, which `AGENTS.md:9` also states | `grep -n 8080 artifacts/api-server/src/index.ts` |
| `CONTRIBUTING.md:96`, `DEVELOPMENT_PRINCIPLES.md:241`, `CHANGELOG.md:213` | *"164+ tests"*, *"all 164+ tests"*, *"2607 pass"* | CI runs **15,243** across **1127 files**; the tree holds 1107 `*.test.ts` + 23 `*.test.mjs`, 73 of them `*.request.test.ts` | count + Actions log |
| `docker-compose.yml:5` vs `CARE_RADIOLOGY_IMPLEMENTATION_GUIDE.md:309` | Guide orders `care-db → care-migrate → care-db-patch-v2 → care-api → care-web` | Compose chain is `db → db-patch-v2 → schema-verify → api → web`; the guide invents `care-migrate` (a `manual`-profile container at `docker-compose.yml:590`) and drops `schema-verify` | read `docker-compose.yml:5` |
| `docs/ai-memory/workspace-analysis.md` | Frozen at 2026-09-27, yet `.cursor/rules/workspace-memory.mdc` makes every agent *"Read docs/ai-memory/workspace-analysis.md first … Never re-derive §1 topology"* | §1 topology is correct, but the instruction to never re-derive it freezes a 24-day-old snapshot as authority | open both files |
| `.cursor/rules/workspace-memory.mdc:3` | `globs: artifacts/diagnostic-erp/src/**, ../../usg-reports/src/**` | The second glob points **outside this repository** and can never match | read the file |
| `.agents/memory/MEMORY.md` | 8 indexed entries | **2 links are dead** (`ai-safety-label.md`, `schema-drift-silent-failures.md`) and **2 files are unindexed** (`ai-model-routing.md`, `ai-table-deploy-migrations.md`) out of 9 files in `.agents/memory/` | `ls .agents/memory` vs the index |
| `docs/architecture/radiology-ai/STAGE1-IMPLEMENTATION-PLAN.md:36`, `:40-41` | Plan says to delete `lib/ai-providers/src/endpointTrustPolicy.ts`; asserts *"the Composer path writes no audit record at all"* | The file is **already absent**; the audit claim is stale (row above). The plan still self-labels *"Planning document only"* with no status banner | `ls lib/ai-providers/src/` |

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

---

## 5. Two claims in circulation that this audit disproved

Recorded because they will come back.

* **"AI Composer reads only prose."** Superseded: `canonicalCanalAp.ts:39`/`:55` and
  `resolveComposeDraft.ts:117` give the Composer a server-resolved, **read-only** view of the
  canonical canal record (#1063 `bae32727`). Not deployed.
* **"The testids fixture is missing."** An agent reported
  `lib/fixtures/radiologyReportingWorkspace.testids.json` as absent and never-committed. It exists at
  the path the test actually uses: `artifacts/diagnostic-erp/src/lib/fixtures/…` (5,042 bytes; 72
  declared ids, 1 dynamic, 1 querySelector template). The claim was an artifact of resolving the path
  from the repo root instead of from the test file's own directory. **Do not "restore" a file that is
  already there.**
