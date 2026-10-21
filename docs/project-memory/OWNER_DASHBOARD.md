# OWNER DASHBOARD — CARE ecosystem

Read this in two minutes. Every row is a measurement taken for this file, with the command or API
call that produced it. Nothing here is inferred from a PR title, a CI badge or an agent's summary.

**Verified at `2026-10-20 17:35Z` (23:05 IST).** `care-on-synology1` `origin/main` = **`c199aea2`**.
Status vocabulary is the five-category set in `CURRENT_STATE.md` §0:
**IMPLEMENTED → TESTED → MERGED → DEPLOYED → CLINICALLY VERIFIED.** A row never moves right without
evidence of the specific step.

---

## 1. Project health

| | State | Evidence |
|---|---|---|
| `main` | `c199aea2` (2026-10-20 17:15:07Z) | `git rev-parse origin/main` after fetch |
| CI on `main` | **3/3 green** — `Build identity`, `Static checks`, `Tests + migration smoke` all `success` | `GET /commits/c199aea2/check-runs` |
| Test volume | **15,622 passed, 49 skipped (15,671)** over **1,150 files, 5 skipped (1,155)** | job `118772471534` log, ANSI stripped |
| Production (Synology) | **NOT DEPLOYED — 117 commits behind `main`**, last verified deploy **2026-10-12** | `git rev-list --count --since=2026-10-12T22:30:00Z origin/main` = 117. The NAS itself was **not contacted this pass** (read-only rule), so the deployed SHA is a carried-forward fact, dated, not re-verified |
| Pending migrations | **None introduced** by #1090/#1091/#1092 | `git show --stat` on all three merge commits lists no `.sql` |
| Critical clinical risks | 3 open + 1 blocking-a-Draft — §4 below | `CLINICAL_SAFETY_REGISTER.md` |

**The single most important sentence:** every fix on this list — signer identity, draft watermarking,
AI attribution, the AI-Apply overwrite gate — is **merged and CI-green and running in nobody's
clinic.** The clinic is still printing the 2026-10-12 build.

---

## 2. Development

**Open PRs: one.** `GET /pulls?state=open` → **#1093** `print-integrity-final`, **Draft**, head
`200f6c8a`, 7 files +135/−10, `mergeable: true`, `mergeable_state: unstable`. Its head **moved twice
during this pass** (`ea00849a` → `200f6c8a`); at the previous head `Static checks` and `Build identity`
were green and `Tests + migration smoke` was red.

> **That red was not #1093's bug.** The job log's only failure is
> `quickSelectClickOrderCensus.test.ts:174` — `Error: Test timed out in 5000ms`, with
> `15,494 passed`. The test is an O(n²) pair census over the shipped brain-tile library, it declares
> no per-test timeout, and `vitest.config.ts` sets no `testTimeout`, so it runs against Vitest's 5 s
> default and loses under load. The print agent is being blocked by a Composer test. See priority 3.

**Merged since the last reconciliation (all 2026-10-20, all squash-merged by `DrAbinash`):**

| PR | Merge | What it actually did (read from the diff) | Files | CI |
|---|---|---|---|---|
| **#1090** Composer 99.9 | `ed04acbc` 17:14:26Z | AI-Apply gate that stops a write when the radiologist typed during the async window (`composerApplyGate.ts`, byte-equality on 3 fields); stale-autosave-ack no longer clears the draft; facet/normal retirement and laterality deselect fixes; **`draftAwarePrintSettings.ts` — an unsigned export now carries a `DRAFT` watermark**; 5 new suites + a permanent clinical acceptance corpus | 29 files **+2,675/−41** code, plus 4 committed PDFs (2.5 MB) | **3/3 green at its head `913c2f18`** |
| **#1091** AI attribution | `0799d175` 17:14:45Z | The local **Restore banner stops stamping AI sentences as human-authored**: `aiAttributionRestore.ts` carries recorded provenance into `setEditorContent`, only for the verified same-report context, exact sentence keys, `manual` fallback otherwise; `storedProvenanceWithLedgerFallback` makes an emptied field defer to the ledger | 6 files +816/−12 | **3/3 green at `b9d8ef51`** |
| **#1092** project memory | `c199aea2` 17:15:07Z | Reconciled the nine memory files to `dc8c3aba`; machine-checked every path and table in them, which found 5 defects including three rows that called a browser module "server-side" | 9 files +1,062/−364 | 3/3 green |

**Merge order note:** #1090 landed, then #1091 **19 seconds later**, both against `dc8c3aba`, both
editing `observationLedger.ts` and `zai-workspace/store.ts`. Each was green only against the *old*
main. The combined tree was therefore unverified until the `main` run at `c199aea2` came back 3/3.
Their two edits to `observationLedger.ts` are complementary, not competing (#1090 exported
`dropProvenanceForRemoved`; #1091 added a new function at a different offset) — verified by reading
both diffs.

**Agent ownership** (unchanged, `AGENT_HANDOFF.md` §3.1): Z.ai — Composer/editor/Quick Select ·
Qoder/Qwen — print, PDF, signer authorization · AI Architecture — providers, vision, provenance,
PACS images · this agent — records, integration analysis, coordination.

**Integration conflicts: none open.** The one real collision #1090 describe — the PDF export door,
where its draft watermark and #1088's signer authority both wrote — was resolved **by the owning
agent**, in branch-side merge commit `104d3f48` ("Merge origin/main (dc8c3aba): signer authority (#1088)
and the DRAFT watermark compose", parents `06befc27` + `dc8c3aba`, 2026-10-20 16:38:21Z, 37 files), by
keeping **two fields with a documented boundary** rather than one, as this directory had prescribed.
*Citation form matters here:* all three of yesterday's merges landed as **single-parent squash commits**
(`ed04acbc` parent `dc8c3aba`; `0799d175` parent `ed04acbc`; `c199aea2` parent `0799d175`), so
`104d3f48` is **not an ancestor of `main`** and `git cat-file -t 104d3f48` fails on a checkout that has
not fetched `refs/pull/1090/head` — it is real, and it is reachable only through the GitHub commits API.
Measured at `c199aea2`: `radiologyReportPdfExport.ts:391` refuses a signed report **before** the key-image
fetch (`:392-395`) and **before** `:397` composes the watermark, so an authoritative document can never be
re-drawn with a `DRAFT` mark. `draftPrintSafety.test.ts` pins the composition — including `:92` *"the
clinic's own configured watermark outranks the draft default"*, which is the behaviour **D-13** below
asks the owner to confirm, and `:97` that the watermark helper does not touch the signature block.
**R-18 is closed** (`KNOWN_ISSUES.md` R-18 carries the full re-measurement and the three residuals it did
**not** close).

---

## 3. Clinical readiness by component

| Component | IMPLEMENTED | TESTED | MERGED | DEPLOYED | CLINICALLY VERIFIED |
|---|---|---|---|---|---|
| Reporting workspace / Composer | yes | 15,622-test suite + new corpus suite | yes (#1090) | **no** | **no** — no human has clicked the combined tree |
| AI-Apply cannot overwrite typed text | yes (`composerApplyGate.ts`) | yes, against the real store | yes (#1090) | no | no |
| AI attribution on draft restore | yes (`aiAttributionRestore.ts`) | unit + 441-line journey suite | yes (#1091) | no | no |
| Print / PDF signer identity | yes (#1088 + #1090 watermark) | yes | yes | no | **partly** — #1093's author ran a real browser + `pdftotext` rig and found 3 defects (§4); the fixes are still a Draft |
| Signing authorization | yes | yes | yes | no | no — and the policy itself is undecided (**D-10**) |
| Report delivery (Report Hub verify → print) | **broken on `main`** | — | fix in Draft #1093 (PI-3) | no | no |
| PACS / OHIF / DICOM | see `ARCHITECTURE.md` | — | — | not inspected this pass | — |
| HOPE integration | implemented | — | — | **never delivered anything** (R-8, 0 rows) | no |

**Integration-status legend applied:** CONNECTED — ERP↔Postgres, ERP↔Orthanc read path.
PARTIALLY CONNECTED — OHIF image selection→ERP, Report Hub→delivery. BROKEN — Report Hub Sign/Verify
dialogs (PI-3, `main`, unfixed until #1093 merges). UNKNOWN / NOT INSPECTED — `futurekind-platform`
(API returns *Not Found* for this token), and the NAS runtime.

**Repositories inspected vs not:**

| Repo | Inspected | How | Head | Open PRs |
|---|---|---|---|---|
| `care-on-synology1` | **yes, deeply** | code + diffs + CI logs + API | `c199aea2` | 1 (#1093) |
| `hope` | metadata only | API | `c2644c7e`, last push 2026-10-14 | 0 |
| `care-pacs` | metadata only | API | `247f0ccf`, last push 2026-10-18 | 0 |
| `usg-reports` | metadata only | API | `9df0364a`, last push 2026-10-07 | 0 |
| `futurekind-platform` | **NO ACCESS** | API → *Not Found* | — | — |

Repositories existing is **not** evidence their systems are integrated. Cross-repo runtime behaviour
was not tested this pass.

---

## 4. Clinical safety — what is open right now

| ID | Risk | State | Where |
|---|---|---|---|
| **PI-3** | A signed report **cannot be verified in the UI**: `ReportHub.tsx` passed `value=""` to a Radix `SelectItem`, which throws while rendering, so neither the Sign nor the Verify dialog opens — and Print/PDF/Share render only for `verified`/`delivered`. The recovery path the sign dialog names out loud ("sign later from Report Hub") leads to a dead end. | reproduced in a browser; fix in **Draft #1093**, not merged | #1093 §3 |
| **PI-2** | **Word export rewrote a signed report**: `handleExportWord` fetched the signed print HTML and then let `finalizePrintPreviewHtml` overwrite body and demographics with live editor text — the produced `.docx` had the authorized findings, **no signer at all**, while the same report's PDF carried name, registration number and timestamp. A signature attached to altered content. | reproduced on the produced `.docx`; fix in **Draft #1093** | #1093 §3 |
| **PI-1** | **An unsaved draft printed the workstation's own signature** ("Dr. Station Alpha MD (Station Default), Reg. No: ALPHA-9") with no `NOT SIGNED` anywhere. Cause: `loadSignerOfRecord(null)` returned `unsigned: false`, so the generator took its `settings.signature` branch. This is the "no report row behind it" case that `CLINICAL_SAFETY_REGISTER.md` §9 recorded as a *deliberate carve-out* — a browser pass has now shown it prints a false authorization. | reproduced twice on clean studies; fix in **Draft #1093** | #1093 §2 |
| **R-19 / D-10** | Any non-denied staff session may apply **any active** signature block — the sign route's subject check is a role deny-list, not a staff↔signature binding. Traceable, not refused. | OPEN, **owner decision required** | register §9.3 |
| **R-14 / C2** | Structured Findings edits stay invisible to dirty-detection, the leave warning and the local backup — unsaved structured work can be lost silently. | OPEN, untouched by all three merges | register §7 |
| **R-10** | The **report** image reader still discards *why* an image failed and can drop image cells by budget with no record of the omission (the vision-trial door was fixed by #1089; this one was never the same door). | OPEN | register §8 |
| **D-11** | `POST /:id/verify` still never calls the unreviewed-AI finalize gate (amend, sign and structured finalize do). | OPEN, owner decision | register §0.1 row 9 |

Closed this cycle: **R-18** (two "unsigned" vocabularies → now one documented boundary), **D-12**
(attribution restore — implemented, tested, merged), **G-16** (#1089, prior cycle).

---

## 5. Decisions needing the owner (only these)

* **D-10 — staff ↔ signature.** Options: (a) 1:1 binding, (b) keep the deny-list + audit, (c) allow
  delegation with an explicit recorded delegate. **Consequence:** (a) stops the single-radiologist
  clinic signing today if signers lack their own accounts. Nothing here should be "fixed" by an agent.
* **D-11 — is `verify` a finalization?** It is the one signed-artifact door with no unreviewed-AI gate.
* **D-13 (NEW) — may a workstation's configured watermark suppress the `DRAFT` mark?** Measured at
  `draftAwarePrintSettings.ts:48`: any non-empty clinic watermark **outranks** `DRAFT`, so an
  unauthorized document leaves that station without a draft indication. Deliberate in the code's own
  words; the owner should confirm or overrule it. ⚠️ *Naming hazard:* this register's `D-n` sequence
  now collides with Composer's internal finding IDs (`#1090`'s `composerApplyGate.ts` header cites
  "D-13's cross-study arm" meaning something else). Reserve `D-n` for this register or the next
  decision read will be ambiguous.
* **D-14 (NEW) — are the 4,975 committed `.doc` report samples clinic *formats* or real *reports*?**
  `docs/report-formats/**` is 280.8 MiB of Word 97 files inside a repository hosted on GitHub. This pass
  **did not open one**, so the question is unanswered and might be nothing: filenames read as a format
  library (`A CT BRAIN - EDH.doc`), not a register. If any header carries a real patient's name, age, UHID
  or referring doctor, then patient data is present in every clone, fork, CI runner and contributor laptop —
  which is a different privacy posture from R-6 (cloud egress), because it is already outside the clinic.
  Options: (a) confirm they are synthetic/consented samples and keep them, documented as such; (b) move
  them to a data store the clinic owns and keep a pointer in the repo; (c) treat as an incident and follow
  retention → move → ignore, in that order, because deleting from `HEAD` does not remove them from
  history. Recommendation: **the owner opens five random files locally** — one minute, no tooling, no
  agent sees the contents. `KNOWN_ISSUES.md` R-22 (size) and R-23 (privacy) carry the measurements.
* **Merge decision on #1093** — it fixes PI-1/PI-2/PI-3, three patient-facing defects with browser
  evidence. Its blocker is a Composer test timeout (§2), not its own code.

Already settled — **do not re-ask**: D-1…D-7, D-9 (answered by #1093's rig), D-8 and D-12 (superseded
by merges).

---

## 6. Five next actions, ranked

| # | Action | Why it matters | Benefit | Owner agent | Dependencies | Acceptance |
|---|---|---|---|---|---|---|
| 1 | **Merge #1093 after its test job is green** (or with the census timeout fixed first — see 3) | PI-3 currently makes verify→print unreachable; PI-2 alters signed content; PI-1 prints a name on an unsigned document | The only clinically-verified-grade print work in the tree | **Qwen** (print/signature) | Its own CI; nothing in `main` blocks it | 3/3 CI green at a head that contains `c199aea2`; re-run the 4-entry-point matrix; `.docx` of a signed report contains the authorized text **and** the signer |
| 2 | **Decide and execute a deploy**, with commit-identity proof | 117 merged commits, zero deployed. Nothing below is felt in the clinic until this happens | Turns merged work into patient-facing reality | **Owner** runs `deploy-synology.sh`; this agent records evidence | #1093 merged first, or accept the current gap | Post-deploy probe reports the running commit = deployed SHA; a real report printed from the clinic is reviewed |
| 3 | **Give the census test a timeout or split it** (`quickSelectClickOrderCensus.test.ts:174`) | A 5 s default on an O(n²) census produces red that lands on whichever agent merges last | Ends cross-agent false blame | **Z.ai** (owns that suite) | none | Two consecutive green runs **plus** a mutation proving the assertion still fails when a tile changes an unrelated tile |
| 4 | **Browser-verify the #1090 + #1091 combined tree** — Restore → AI Apply → typed edit → Print, one study | They merged 19 s apart into the same store; CI green is a unit/request verdict, not a workflow verdict | Converts "merged" toward "clinically verified" for AI attribution and lost-edit protection | **AI Architecture** (provenance) + **Qwen** (print), one report each | a scratch DB only; never the NAS | A dated, reproducible browser transcript per agent naming what each saw, plus what each did **not** test |
| 5 | **Settle D-10 and D-11 as policy, then implement** | Two signing doors still decide authority differently, and one has no gate | One rule, stated by the owner, enforced in code | **Owner decides**; D-10 → Qwen, D-11 → AI Architecture | none | The chosen rule written in `CLINICAL_SAFETY_REGISTER.md` with a test that fails if it is bypassed |

---

## 7. Technical debt noticed this pass (classify only — no code touched)

| Item | Evidence | Class |
|---|---|---|
| Four rendered PDFs committed by #1090 — `artifacts/radiology-e2e-acceptance/reports-v2/CASE-1{A,B}.pdf`, `CASE-2{A,B}.pdf`, **2,522,239 bytes (2.4 MiB)** across 4 files | `git ls-tree -r -l c199aea2 -- artifacts/radiology-e2e-acceptance` | **INVESTIGATE**. Rendered PDFs are timestamp-nondeterministic, so they will churn on every regeneration and cannot serve as byte-goldens; and nothing on `main` reads them back |
| `docs/report-formats/**` — **4,975 files / 280.8 MiB** of legacy Word 97 `.doc` samples (ct 167.6 · usg 65.7 · mri 27.4 · xray 20.0 MiB), 64% of the tracked tree's bytes, committed 2026-07-22 (`92d9b5b9`) and never classified | `git ls-tree -r -l origin/main` summed by directory at `c199aea2` | **INVESTIGATE first, then it splits in two**: the *size* half is RETIRE-able (a data store, not `docs/`), but the *privacy* half is decision **D-14** and no agent may act on it. See `KNOWN_ISSUES.md` R-22/R-23 |
| `.SynologyWorkingDirectory/Sign/**` — **19,596 files / 28.5 MiB** of Synology Drive Client's own signature cache (256 entries × 77 hex buckets), committed wholesale in `5cb9956e` *"initial care erp upload from synology production"* and never removed | same command; 66% of all tracked paths | **RETIRE** — `.gitignore` plus untracking. Not done here: `git rm -r --cached` changes what `deploy-synology.sh`'s `git reset --hard` lays down on the NAS, which is an owner/infra decision, not documentation. It also moved the clinic's deploy payload: 437.0 MiB of tree for a one-line change |
| `CARE_COMPOSER_99_9_PROGRESS.md` — an 11th project-memory file, at the repo root, owned by another agent, referenced by **none** of the other files in this directory until `OWNER_DASHBOARD.md` cited it twice | `grep -rn CARE_COMPOSER_99_9_PROGRESS docs/project-memory/` → only this file | **CONSOLIDATE**. It uniquely records how R-18 was resolved (merge commit `104d3f48`) and also still carries the deleted-module claim this directory corrected: it describes #1085's "server-side `reportSignerSelection`", which #1088 deleted (`git ls-files \| grep -c reportSignerSelection` → 0) |
| Two ID namespaces collide (`D-n` in this register vs `D-n` inside Composer's code comments) | §5 above | **REPAIR** by convention, in writing, at near-zero cost |
| The documentation checks this directory keeps asking for were prototyped here and **the false positives, not the defects, were the work** | this pass ran a throwaway validator over all ten files: **0 table defects**, 44 "dead path" hits of which every one is a documented convention (bare-path shorthand), an other-repo path (`PACS/...`), a deliberately-cited deleted module, a glob placeholder, or this directory's own filenames; 20 "odd backtick" hits of which all are wrapped inline code or a fenced block | **KEEP the check, scope it honestly**: it needs (1) fenced-block skipping and logical-line joining, (2) an allow-list for other repos and for paths cited *because* they are gone, (3) `maxBuffer` raised above 1 MiB or `git ls-tree -r` kills it silently. Zero of the ten files currently fail a *structural* check — `OPEN_WORK.md` priority 10 should build on this, not start over |
| Knowledge loss actually happened: the Composer branch's **nine prior commits were never pushed and died with a container reset**, then were rebuilt from a worklog | `CARE_COMPOSER_99_9_PROGRESS.md` §"Provenance of this branch" | **REPAIR the process** — push-per-stage is now that agent's habit; this dashboard exists so no other agent's only copy lives in a container |

---

## 8. How to re-verify this file in one minute

```
git fetch origin && git rev-parse --short=8 origin/main
gh api repos/DrAbinash/care-on-synology1/commits/$(git rev-parse origin/main)/check-runs
gh api "repos/DrAbinash/care-on-synology1/pulls?state=open"
git rev-list --count --since=2026-10-12T22:30:00Z origin/main
```
If those four disagree with anything above, **they are right and this file is stale** — that is the
normal state of a document about this repository, which is why every row above carries its date.
