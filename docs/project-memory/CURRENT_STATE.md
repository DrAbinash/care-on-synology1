# CURRENT STATE — CARE Diagnostics / Hope Hospital platform

Baseline `origin/main` **`1c80f2d3`**, measured 2026-10-20 (IST) against the tree and the GitHub REST
API; a previous pass of this same file was written at `c4462041` and its corrections are marked, not
deleted. This file is a **snapshot with an expiry date**, not a living register: `main` moves up to
twice a day on this project, so re-derive every SHA and PR number with the commands in §8 before
repeating a claim from here.

Companions in this set: `OWNER_VISION.md` (what the product must do, as approved by the owner),
`AUDIT_RECONCILIATION.md` (which historical audit findings survive on this tree),
`CLINICAL_SAFETY_REGISTER.md` (the nine patient-facing failure classes and their current evidence).

## 0. Status vocabulary — the whole point of this file

| Label | Means | How to verify |
|---|---|---|
| **MERGED** | The commit is an ancestor of `origin/main`. | `git merge-base --is-ancestor <sha> origin/main` |
| **DEPLOYED** | The clinic's NAS containers are running that code. | Only `deploy-synology.sh` does this, on the NAS, by hand. **No document in this repo records a deploy after 2026-10-12 22:22Z.** |
| **TESTED** | A named harness executed and its output was read. | The harness must be named; CI log line preferred over a local run. |
| **NOT TESTED** | Code exists and reads correctly. Nothing ran it. | — |
| **OPEN** | A PR exists, not merged. | `GET /pulls?state=open` |

The three most common agent errors on this repository are: calling MERGED "live", calling a green
local suite "tested", and trusting a document instead of the tree. This file labels all three.

## 1. What the clinic is actually running

**Last deploy anywhere that a document records:** containers `care-api`, `care-web`, `care-db`,
`care-redis` observed `Up 6 hours (healthy)`, created `2026-10-12T22:22:4xZ`, with
`care-db-patch-v2` and `care-schema-verify` `Exited (0)` in the same window —
`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:712-714`. Production database identity in that same pass:
`current_database()=diagnostic_erp`, `server_version 16.14`, not in recovery
(`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:719`, CL-1).

**That deploy's code identity is NOT proven.** The same register lists among claims *"Refuted by
this pass"*: `/api/health` reported commit `2d51e8d7` while the checkout was `46d36612`
(`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:357`, `:738-739`). So the honest statement is: *the clinic is
running something built on or about 2026-10-12, and no artifact proves which commit.* Treat
"deployed" as **2026-10-12, identity unproven** until someone re-runs
`node scripts/verify-deployed-identity.mjs` on the NAS.

**Volume of undeployed work:** **108** commits on `origin/main` since 2026-10-12 22:30Z
(`git rev-list --count --since=2026-10-12T22:30:00Z origin/main`, measured at `1c80f2d3`), almost all
of them squash-merged PRs. Everything in §3 is invisible in the clinic. A deploy is not automatic:
`deploy-synology.sh:39-47` hard-resets the NAS checkout to `origin/main` and rebuilds; nothing
triggers it.

**Which migrations the clinic database has is NOT VERIFIED.** The repo cannot answer it:
`version.json` is stamped *by the deploy* (`deploy-synology.sh:79-82` writes git/build metadata into
it so `resolveVersionInfo()` — `lib/operationsContext.ts:28,53` — reports a real SHA), so the
committed copy is stale by design and the live value only exists on the NAS. What the repo does
establish: `migrations/` carries **201 top-level `.sql` files plus 4 in `migrations/manual-only/`
(3 `.sql` + a README)**, applied by `docker/db-patch-entrypoint.sh` in plain alphabetical order, with
`scripts/check-migration-order.cjs` as the CI preflight; the **second, unrelated** system
`lib/db/drizzle/meta/_journal.json` has **15 entries** (latest `0014_baseline_manifest`). Two
migration systems in one repository is finding M18 of the master audit and it is still open — see
`AUDIT_RECONCILIATION.md` §3.

## 2. What `main` is

| Fact | Value | Evidence |
|---|---|---|
| HEAD at measurement | `1c80f2d3bb005eb82ba5b0bb4f8bcc16fae027aa` *"A two-model comparison was pinned to the order the provider read their sockets (#1086)"*, committed 2026-10-20 08:29:22 +0530 | `git fetch origin main && git log -1 --format="%H %ad %s" origin/main`, fetched 2026-10-20 ~08:40 IST |
| CI on that HEAD | **all 3 jobs success**, one run `39361881382`: `Static checks` 03:01:49Z, `Build identity` 03:00:11Z, `Tests + migration smoke` 03:13:42Z | `GET /commits/1c80f2d3…/check-runs` |
| Test totals, read from the Actions log | **15,406 passed / 49 skipped (15,455)** over **1133 test files passed, 5 skipped (1138)**, Duration **775.25 s** | run `39361881382`, log `1_Tests + migration smoke (real Postgres).txt` lines 9311-9314 |
| The suite that had been red | `aiReporting.imageEgress.request.test.ts **(50 tests)** 2934ms` — green, including the new out-of-order case | same log, line 2033 |
| Migration smoke | `✓ clean-boot + upgrade-safety migration smoke (scripts/migration-bootstrap-smoke.mjs) 6667ms` | same log, line 9193 |
| Build identity | job `Build identity (disposable docker build)` completed/success | `GET /commits/…/check-runs` |
| Typecheck | clean for **every** package: `api-server`, `diagnostic-erp`, `clinic-site`, `diagno-booking-mobile`, `scripts` all `typecheck: Done` | log `0_Static checks …` lines 382-391 |
| Documentation gate | `grounding-check: 105 architecture claims` (27 table, 21 column, 37 function, 20 contains) over 53 files | same log, line 250 |
| Log text that looks like a failure and is not | `[cron] Restore verification: FAIL — verified artifact …` and `FAIL — verified a fresh pg_dump (NO stored backup artifact was available to test)` at 03:10:30Z — emitted by the cron tests while the job stayed **success**. Read the job conclusion, not the word FAIL | same log, lines 8602, 8605 |

**Superseded, kept for the record.** From 2026-10-19 20:29Z to 2026-10-20 02:59Z the tip of `main`
was `c4462041` and its `Tests + migration smoke` job was **red** on one order-dependent assertion in
`aiReporting.imageEgress.request.test.ts` TEST 15 (`expected [ 'medgemma1.5:4b', 'qwen3-vl:8b' ] to
deeply equal [ 'qwen3-vl:8b', 'medgemma1.5:4b' ]` at `:965:44`, run `39319802877`). It was reproduced
byte-identically on a documentation-only head (`38530427`, run `39321817651`), which is how it was
proved to be `main`'s rather than the PR's. **PR #1086 retired it** (merged as `1c80f2d3`): the arm
rows are now asserted as a deterministic `(armIndex, model, imageCount)` table and the transport
order as a sorted multiset, plus a new case (TEST 15b) that forces the arms to complete in the
opposite order behind a 2 s barrier. `main` therefore has a completed green test run again — the
first since `6a31307f`.

CI is three jobs, not four: *Tests + migration smoke (real Postgres)*, *Build identity (disposable
docker build)*, *Static checks (typecheck, migration order, grounding)* (`.github/workflows/ci.yml`
jobs `test`, `identity`, `static`).

## 3. Merged, not deployed — the register that matters

All rows verified as `merged: true` via `GET /pulls/{n}`. None is deployed (§1). The
`Deployed: no` column for the RIS rows is the repo's own register's verdict
(`docs/engineering/RIS-PACS-INTEGRATION-TODO.md:30-46`).

| PR | Merged as | What it changed (one line) | Deployed | Tested |
|---|---|---|---|---|
| #1086 | `1c80f2d3` 2026-10-20 08:29 IST | The two-arm image comparison is no longer asserted in socket-arrival order; a new case forces the opposite order | no | **CI green on `main`** — run `39361881382`, 3/3 jobs, 15,406 tests, suite at 50 tests |
| #1081 | `c208cbfb` 2026-10-19 21:39Z | Isolated local development against a copy of production (`CARE_DEV_ISOLATED`, `pnpm dev:isolated`) | no | yes — CI green at head `1209ae49` |
| #1080 | `c4462041` 2026-10-19 20:29Z | A vision arm that was never sent the image can no longer claim it read it | no | green at head `76fe43b0` (3 jobs); **red after its own squash onto `main`** (TEST 15 arm order), retired by #1086 |
| #1082 | `80a09df4` 2026-10-19 20:22Z | Composer usability-first re-land (24 files) | no | the test job on that merge commit reads **cancelled** — the `ci-${{ github.ref }}` concurrency group killed it when #1080 landed seconds later. Read the PR head, not the merge commit |
| #1079 | `b67869ed` | Model comparison can run a picture, not only a prompt (6 ceilings in `routes/aiComparison.ts:36-40`) | no | request suite `aiReporting.imageEgress.request.test.ts` +909 |
| #1078 | `a787bafb` | Every interactive image route honours the egress mode | no | yes, CI + request tests |
| #1077 | `6a31307f` | Quick Select order-independence, Conclusion retirement, acceptance journeys | no | yes (15,243 tests) |
| #1076 | `66d2c116` | AI security mode is a resolved setting, not a constant | no | yes |
| #1073 | `ed3e00b4` | Screenshot→draft audit doc + corrections to the radiology-ai architecture set | n/a (docs) | n/a |
| #1072/#1071/#1070 | `6b64b2f0`/`d673f1cc`/`02e47dff` | One supersession rule for contradictory normals across all four write doors | no | yes at head |
| #1064 | `8d14b121` | Tracker recording **#1058, #1055, #1057, #1056, #1063 merged, not deployed** | — | — |
| #1063 | `bae32727` | AI Composer reads the canonical canal AP record (read-only) | no | 6 suites + 10/10 mutation battery |
| #1054 | `3d54c552` | Canal AP: one print authority, phrase dedupe removed | no | 20 rendered-artifact cases on real Postgres |
| #1058 | `d1f9b855` | RIS-014 finalize study-id authority + RIS-015 signed-state witness | no | 4/4 + 25/25 + 7/7 on real Postgres, 15/15 mutants killed |
| #1047 | `795eb069` | RIS-006 / RIS-012 linked-sibling report ownership | no | 3 of 8 red→green, mutants N1–N6 killed |
| #1050/#1053 | `1a93e4e4`/`9664a967` | RIS-010 PACS archive transaction safety + its two post-merge regressions | no | 21/21 on CI's Postgres, 28-mutant battery |
| #1044 | `877701f9` | RIS-005 right-patient-wrong-examination in the archive | no | 13/13, battery A–F |

**Consequence:** the P0 patient-identity fixes (#1040, #1042, #1044, #1058) are **not** what the
clinic is printing. That is the single most important sentence in this file.

## 4. Open work on GitHub (verified 2026-10-20 ~08:40 IST)

Exactly **three** open PRs in `DrAbinash/care-on-synology1`, **all drafts, all based on `c4462041`**
(so each is two merges behind `main` — `#1081` and `#1086` — and all three report `mergeable: true`):

| PR | State | Head | Size | What it is |
|---|---|---|---|---|
| **#1083** | open, DRAFT | `2d8fbcea` (`docs/project-memory-reconstruction`) | 6 files, +1188/−0 | This file set — `docs/project-memory/*`. Documentation only; **nothing in `docs/project-memory/` exists on `main`**, so nothing here is authoritative to another agent until it merges. |
| **#1084** | open, DRAFT | `130fc9f5` (`docs/ai-composer-current-state`) | 4 files, +3247/−0 | The AI Composer current-state reconstruction + the G-1..G-24 register and next-phase plan. Docs only. Also **not on `main`**. |
| **#1085** | open, DRAFT | `55de3cce` (`audit/report-print-pdf-quality`) | 10 files, +783/−46 | Print/PDF quality fixes (Doppler emphasis, missing-image honesty, signature-block layout). **Code**, not docs. |

All three were green on their own heads when read this pass (`GET /commits/<head>/check-runs`):
#1083 and #1084 at 2026-10-19 21:03/21:17Z, **#1085 at 2026-10-20 02:39Z — 3 jobs success, completed
02:53:22Z**. #1085 is therefore *implemented and CI-tested*, **not merged, not deployed, and not
browser-verified** — the print/PDF claim can only be settled on rendered output.

`#1081` was the single open Draft when this file set was first written; it **merged during the
pass** as `c208cbfb`. Do not repeat "one open PR" from an older note — re-run
`GET /pulls?state=open`.

Sibling repositories, all with **0 open PRs** at measurement:

| Repo | `origin/main` last merge | Notes |
|---|---|---|
| `DrAbinash/care-pacs` | #19, 2026-10-12 | **Local checkout is NOT on main**: branch `fix/orthanc-mwl-housekeeper-crash` @ `53588a0`, `origin/main` = `247f0cc`. Reading that checkout reads a feature branch. |
| `DrAbinash/hope` | #191, 2026-10-14 | HOPE Hospital ERP |
| `DrAbinash/usg-reports` | #65, 2026-10-07 | Independent USG reporting app (no-AI pipeline) |
| `FuturekindHealth/futurekind-platform` | #9, 2026-10-15 | **not** `DrAbinash/futurekind-platform` — that URL 404s. Org is `FuturekindHealth`. |

## 5. Where the code lives, in one table

| Thing | Path | Verified |
|---|---|---|
| pnpm workspace globs | `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts` | `pnpm-workspace.yaml:2-5` |
| API server | `artifacts/api-server/src/index.ts`, `PORT` default **8080** | `index.ts:2835` |
| ERP SPA | `artifacts/diagnostic-erp/vite.config.ts`, **5173** | `:11` |
| Clinic site | `artifacts/clinic-site/vite.config.ts` 5173 default; mobile booking 3003 | package/vite files |
| Schema | `lib/db/src/schema/*.ts` — **187 files, 196 `pgTable("<name>")` definitions** | counted on `1c80f2d3` |
| Routes | `artifacts/api-server/src/routes/*.ts` — **202 non-test files** | counted on `1c80f2d3` |
| SQL migrations | `migrations/*.sql` — **201**, plus **4** in `migrations/manual-only/` (3 `.sql` + README) | `git ls-tree -r --name-only origin/main -- migrations` |
| Second migration system | `lib/db/drizzle/meta/_journal.json` — **15 entries**, latest `0014_baseline_manifest` | `git show origin/main:lib/db/drizzle/meta/_journal.json` |
| Tests | **1111 `*.test.ts`** in `artifacts lib scripts` + **24 `*.test.mjs`**, of which **73 `*.request.test.ts`**. Two more `.test.ts` sit in `__super_admin_quarantine/`, which `pnpm -r` never runs. CI executes **1138** files (1133 pass, 5 skip). | counted on `1c80f2d3`; Actions log |
| Report section order | `artifacts/api-server/src/lib/structuredReport/renderer.ts` emits **Technique (`:311`) → Findings (`:320`) → Impression (`:241`/`:267`) → Recommendation (`:365`)**; the print/PDF path defaults to `sectionOrder: "Technique,Findings,Impression"` (`routes/radiology-report-generator.ts:1169`, `lib/institutionalReportStyle.ts:629`, `routes/radiology.ts:3543`) | grep on `1c80f2d3` — see `OWNER_VISION.md` |
| Super Admin portal | `__super_admin_quarantine/super-admin-portal` — **outside the workspace**, yet root `dev` still `--filter`s it (`package.json:12`), port 5174 | `pnpm-workspace.yaml` has no match for `super-admin` |
| Non-packages matching the globs | `artifacts/radiology-e2e-acceptance/`, `lib/pacs/` have **no `package.json`** | `pnpm -r` skips them silently |

## 6. This Windows development machine (measured, not assumed)

Nothing here was changed. Full procedure and intent in `ARCHITECTURE.md` §15.

| Intended (per the owner's brief) | Measured on this box |
|---|---|
| `C:\care-development` checkout | **absent** (`ls /c/care-development` → not found) |
| PostgreSQL `127.0.0.1:5411` db `care_dev` | **5411 not listening** |
| API `127.0.0.1:8181` | **8181 not listening** |
| Frontend `127.0.0.1:5173` | **5173 not listening** (a Vite dev server IS up on `127.0.0.1:5178`, another agent's session — left alone) |
| `CARE_DEV_ISOLATED=1`, `pnpm dev:isolated` | **now exists on `main`** — `package.json:14` `"dev:isolated": "node scripts/dev-erp-local.mjs --isolated"`, with `artifacts/api-server/src/devIsolationBoot.ts` and its door/startup tests. **Correction (2026-10-20):** an earlier revision of this file said it existed only on the Draft branch; #1081 merged as `c208cbfb` at 21:39Z while that revision was being written. It is merged, **not deployed**, and nothing on this box has run it — the ports in §6 are still not listening. |
| Restored production snapshot, 477 tables | **owner-reported, unverified by this pass.** Port `5432` answers and is `PostgreSQL 18.3 on x86_64-windows` (service `postgresql-x64-18`, running) but requires password auth, which this audit did not use. Note the version gap: production and CI are **PostgreSQL 16** (`server_version 16.14`, `postgres:16-alpine`); this box runs **18.3**. |
| — | Port `5445` is a second cluster (role `erp`) holding **51 scratch databases** created by past agent sessions. |

**So the intended Windows environment is a plan, not a measurement.** The mechanism it depends on
is one Draft PR away.

## 7. Known-unproven areas (carry these forward)

* **Browser proof of the merged reporting stack: none since 2026-10-16.** `deployed` is 2026-10-12,
  so the clinic has not been shown any of §3.
* **D2 displayed-image identity is dormant, not live.** `docs/CARE_ERP_PREDEPLOYMENT_GATE.md:723`
  (CL-5) fails viewer-side claims; the register's own words: *"Saying 'D2 is live' is false… it is
  dormant."*
* **HOPE delivery has never been observed.** CL-6: `integration_outbox` 0 rows,
  `integration_delivery_attempts` 0 rows, `external_result_links` 0/0/0 — reachability proved
  (HTTP 401 in 88 ms from the NAS to `172.16.1.139:7080`), delivery never
  (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:724`).
* **No restore has ever been proven on the NAS.** CL-2 NOT TESTED; `public.backup_verification`
  has 0 rows (`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:719`).
* **Evaluation/governance machinery is unwired.** `runEvaluation` has no caller
  (`artifacts/api-server/src/lib/ai/evaluationRunner.ts:36` is the only definition site);
  `admitJob` likewise (`lib/ai/aiScheduler.ts:120`); the `ai_golden_cases` table exists
  (`lib/db/src/schema/aiEvaluation.ts:36`) and nothing inserts into it. Docs claiming an
  operating evaluation framework are wrong — see `KNOWN_ISSUES.md` §2.

## 8. Re-derive before quoting

```
git fetch origin main && git log --oneline -1 origin/main
git rev-list --count --since=2026-10-12T22:30:00Z origin/main     # undeployed volume
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  https://api.github.com/repos/DrAbinash/care-on-synology1/pulls?state=open
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  https://api.github.com/repos/DrAbinash/care-on-synology1/commits/<sha>/check-runs
```
Read `merged` / `merged_at`, never `merge_commit_sha` alone — an **open** PR also carries a
non-null `merge_commit_sha` (GitHub's test-merge preview) and it is not on `main`.
