# CURRENT STATE — CARE Diagnostics / Hope Hospital platform

Measured 2026-10-20 (IST) against `origin/main` and the GitHub REST API. This file is a
**snapshot with an expiry date**, not a living register: `main` moves up to twice a day on this
project, so re-derive every SHA and PR number with the commands in §8 before repeating a claim
from here.

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

**Volume of undeployed work:** 106 commits on `origin/main` since 2026-10-12 22:30Z, of which 103
are squash-merged PRs. Everything in §3 is invisible in the clinic. A deploy is not automatic:
`deploy-synology.sh:39-47` hard-resets the NAS checkout to `origin/main` and rebuilds; nothing
triggers it.

## 2. What `main` is

| Fact | Value | Evidence |
|---|---|---|
| HEAD at measurement | `c4462041` *"A model that was never shown the picture could still answer as an image reading (#1080)"* | `git log -1 origin/main`, fetched 2026-10-20 02:05Z IST |
| CI on the previous tip `6a31307f` | all 3 jobs **success**, `Tests + migration smoke (real Postgres)` finished 2026-10-19T18:06:30Z | `GET /commits/6a31307f/check-runs` |
| Test totals, read from the Actions log | **15,243 passed / 49 skipped (15,292)** over **1127 test files passed, 5 skipped (1132)**, 619.89s | run `39298095778`, job log `2_Tests + migration smoke (real Postgres).txt` |
| Build identity | `ok A commit is the checkout: expected 6a31307ffb10, got 6a31307ffb10` | job log `0_Build identity …` |
| Typecheck | clean for **every** package, incl. `diagnostic-erp` and `clinic-site` | job log `1_Static checks …` |
| Documentation gate | `grounding-check: 105 architecture claims` (27 table, 21 column, 37 function, 20 contains) over 53 files | `scripts/grounding-check.cjs`, `scripts/grounding.manifest.json` |
| CI on `c4462041` (**current tip**) | **`Tests + migration smoke (real Postgres)` = FAILURE** at 2026-10-19T20:39:23Z; `Build identity` and `Static checks` success | `GET /commits/c4462041/check-runs`, run `39319802877` job log |
| What is failing | `aiReporting.imageEgress.request.test.ts` **TEST 15** — `AssertionError: expected [ 'medgemma1.5:4b', 'qwen3-vl:8b' ] to deeply equal [ 'qwen3-vl:8b', 'medgemma1.5:4b' ]` at `:965:44`. One arm-order assertion; `Test Files 1 failed | 1127 passed | 5 skipped (1133)`. **`main` is red on the tree that carries #1080** | same log, lines quoted verbatim |

**Read that last row before trusting "CI is green".** The tip of `main` fails on an **order-dependent
assertion** in the newest AI-egress suite: `aiReporting.imageEgress.request.test.ts` TEST 15 line 965
compares the two local arms as an ordered list
(`expect(localChats.map(c => c.model)).toEqual([LOCAL_VISION_MODEL, SECOND_LOCAL_MODEL])`), and the
executor returned them the other way round. The same suite **passed** at #1080's own head, so the
outcome is not stable across the merge:

| Commit | What it is | `Tests + migration smoke` |
|---|---|---|
| `6a31307f` | #1077 on `main` | **success** (15,243 tests, 619.89 s) |
| `80a09df4` | #1082 on `main` | **cancelled** — never completed |
| `76fe43b0` | #1080's PR head | success |
| `c4462041` | #1080 squashed onto `main` | **failure** (1 file, TEST 15) |

`main` has therefore had **no completed green test run since `6a31307f`**, and every PR opened on it
inherits the red — including this documentation-only Draft (`38530427`, run `39321817651`,
byte-identical assertion and `file:line`), which is how it was proved to be `main`'s and not the PR's.

CI is three jobs, not four: *Tests + migration smoke (real Postgres)*, *Build identity (disposable
docker build)*, *Static checks (typecheck, migration order, grounding)* (`.github/workflows/ci.yml`
jobs `test`, `identity`, `static`).

## 3. Merged, not deployed — the register that matters

All rows verified as `merged: true` via `GET /pulls/{n}`. None is deployed (§1). The
`Deployed: no` column for the RIS rows is the repo's own register's verdict
(`docs/engineering/RIS-PACS-INTEGRATION-TODO.md:30-46`).

| PR | Merged as | What it changed (one line) | Deployed | Tested |
|---|---|---|---|---|
| #1080 | `c4462041` 2026-10-19 20:29Z | A vision arm that was never sent the image can no longer claim it read it | no | green at head `76fe43b0` (3 jobs); **`Tests` job FAILURE on `main` at `c4462041`** — see §2 |
| #1082 | `80a09df4` 2026-10-19 20:22Z | Composer usability-first re-land (24 files) | no | CI — not read by this pass |
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

## 4. Open work on GitHub (verified 2026-10-20 02:05Z IST)

Exactly **one** open PR in `DrAbinash/care-on-synology1`:

| PR | State | Head | Size | What it is |
|---|---|---|---|---|
| **#1081** | **open, DRAFT**, `mergeable_state: unstable` | `469e928d` (`feat/care-dev-isolated`) | 21 files, +1801/−78 | Isolated local development against a copy of production: `CARE_DEV_ISOLATED`, `pnpm dev:isolated`, **branch-only** files `lib/devIsolation.ts` (320 lines) + `devIsolationEgress.ts` (235) + `devIsolationBoot.ts` (112) — none of these paths exist on `main` yet — ports pinned to `127.0.0.1:8181`/`5173`, refuses to start unless `DATABASE_URL` is the approved development DB, and refuses outbound production integrations. |

`unstable` here means **checks pending/failing on the head, not a content conflict** — re-read
`GET /pulls/1081` before repeating that.

**#1080 was open when this audit was commissioned and merged during it** (2026-10-19 20:29:55Z).
Do not "verify" #1080 as open from an older note.

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
| Schema | `lib/db/src/schema/*.ts` — **187 files, 196 `pgTable` names** | counted on `c4462041` |
| Routes | `artifacts/api-server/src/routes/*.ts` — **196 non-test files** | counted |
| SQL migrations | `migrations/*.sql` — **201 files** | counted on `c4462041` |
| Tests | **1107 `*.test.ts` + 23 `*.test.mjs`** in workspace scope (`find artifacts lib scripts -name "*.test.ts" -not -path "*/node_modules/*" \| wc -l`), of which **73 `*.request.test.ts`**. Two more `.test.ts` sit in `__super_admin_quarantine/`, which `pnpm -r` never runs. | counted on `c4462041` |
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
| `CARE_DEV_ISOLATED=1`, `pnpm dev:isolated` | **does not exist on `main`** — only on `feat/care-dev-isolated` (#1081, Draft). Root `package.json` has `dev`, `dev:doctor`, `dev:erp-local`, `dev:restart`, no `dev:isolated`. |
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
