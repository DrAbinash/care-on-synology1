# OWNER DASHBOARD — CARE ecosystem

Read this in two minutes. Every row is a measurement taken for this file, with the command or API
call that produced it. Nothing here is inferred from a PR title, a CI badge or an agent's summary.

**Verified at `2026-10-21 02:20Z` (07:50 IST).** `care-on-synology1` `origin/main` = **`b0610551`**.
Status vocabulary is the five-category set in `CURRENT_STATE.md` §0:
**IMPLEMENTED → TESTED → MERGED → DEPLOYED → CLINICALLY VERIFIED.** A row never moves right without
evidence of the specific step. "Browser-tested" is reported separately from "regression-tested", and
who ran the browser is named — this pass ran no browser.

**The one-line state:** the three print-integrity defects (PI-1/PI-2/PI-3) are **fixed in source and
merged** (`2ec675ab`), their regressions pass locally at that commit, and **none of it is in the
clinic** — the deployed build is still 121 commits behind. This pass also measured the repository's
legacy report corpus, and the privacy question D-14 posed as unknown now has an answer: the files are
real clinical records. See §5 D-14.

---

## 1. Project health

| | State | Evidence |
|---|---|---|
| `main` | `b0610551` (2026-10-21 02:07:31Z) — three squash merges since `c199aea2`: `9fcd1e8e` (#1094), `93fb53ad` (#1095, this directory), `b0610551` (#1096) | `git fetch origin && git rev-parse --short=8 origin/main`; parentage `git log --format='%h parents=%p'` |
| CI on `main` | **3/3 green at the tip** — `Build identity`, `Static checks`, `Tests + migration smoke` all `success` | `GET /commits/b0610551/check-runs` |
| CI on the two merges below it | `9fcd1e8e` = all three **cancelled** (superseded within 20 s by the next merge), `93fb53ad` = **no check-runs recorded at all** | `GET /commits/<sha>/check-runs` for each — "it merged, therefore it was tested" is not how this repo's CI behaves |
| Test volume | **15,622 passed, 49 skipped (15,671)** over **1,150 files, 5 skipped (1,155)** — *carried forward, dated 2026-10-20, not re-measured*: Actions job logs return 404 for this token | job `118772471534` log, ANSI stripped. Re-derive from a job log, never from the check-run verdict |
| Production (Synology) | **NOT DEPLOYED — 121 commits behind `main`** (was 117), last verified deploy **2026-10-12** | `git rev-list --count --since=2026-10-12T22:30:00Z origin/main` = 121. The NAS was **not contacted this pass** (read-only rule), so the deployed SHA stays a carried-forward, dated fact |
| Pending migrations | **None introduced** by #1093/#1094/#1095/#1096 | `git show --stat` on all four merge commits lists no `.sql` |
| Critical clinical risks | 0 open print-integrity defects; 3 standing risks (D-10, R-14, R-10) + 1 newly measured privacy exposure (D-14) — §4 | `CLINICAL_SAFETY_REGISTER.md`, and §5 below for the corpus |

**The single most important sentence:** every fix on this list — signer identity, the unsigned-export
watermark, the Word/PDF live-merge gate, AI attribution, the AI-Apply overwrite gate, the audit page's
egress columns — is **merged and CI-green and running in nobody's clinic.** The clinic is still printing
the 2026-10-12 build, which is 121 commits behind `main`.

---

## 2. Development

**Open PRs: two, both Drafts** (`GET /pulls?state=open`, read 2026-10-21 02:15Z). Both are still based
on `2ec675ab`, i.e. two squash merges behind `main`.

| PR | Owner | State at read | Real blocker |
|---|---|---|---|
| **#1097** Composer Phase 2 — regional regression expansion | Z.ai | Draft, 11 files +763/−16, `mergeable: true`, `mergeable_state: **unstable**`, 2/3 green, `Tests + migration smoke` **failure** | **Not** the census test. Its check-run annotations name `scripts/src/generateQuickSelectFactoryBoxes.test.ts:71` — *"the newest seed revision carries `2f4326815314` but the catalogue now hashes to `215e2a0c52d9`. Run: `pnpm --filter @workspace/scripts run generate:quick-select-factory-boxes`"* — and `:81`, the same corpus. Its 6 tile edits add `impressionSentence`/`conflictGroup`, which is exactly what that gate exists to catch. It also carries a byte-identical copy of `composerIntegrationJourney.test.ts`, which `#1096` has since merged (§7) |
| **#1098** Vision capability by server claim, not by name | AI Architecture | Draft, 2 files +107/−10, `mergeable: true`, `mergeable_state: **clean**`, **3/3 green** | Nothing mechanical. It moves an authority: which local model may see images is decided by Ollama's `/api/show` capability list instead of CARE's name table (see §4.1) — an owner-level reading, not a CI one |

> **What happened to the census timeout that blocked #1093.** It did not recur. #1093 merged at
> 2026-10-20T17:38:08Z as `2ec675ab`, and `main` has been 3/3 green at `2ec675ab` and again at
> `b0610551` since. This pass measured the test directly (see priority 4 and `KNOWN_ISSUES.md` R-20):
> in isolation its heavy case runs in **2,326 ms and 2,409 ms** on this box against Vitest's 5 s
> default, and it also fires **834 un-awaited `POST /api/radiology/report-formats/:id/use` calls**,
> each of which schedules a real ~400 ms backoff timer because no server is listening in a unit test.
> It is a slow test carrying network noise, not a broken one, and it is not any print agent's bug.

**Merged since the last reconciliation — four, all squash-merged by `DrAbinash`, three of them inside
44 seconds of each other:**

| PR | Merge | What it actually did (read from the diff, not the title) | Files | CI |
|---|---|---|---|---|
| **#1093** print integrity | `2ec675ab` 2026-10-20 17:38:08Z | **PI-1/PI-2/PI-3** — `loadSignerOfRecord(null)` now answers `unsigned: true` (fail closed); `handleExportWord` asks the record who signed and passes `authorizedArtifact` so a signed report's Word export is no longer re-merged from live editor text; `SIGN_WITHOUT_BLOCK = "as-me"` sentinel replaces the `value=""` that threw while rendering and killed both dialogs | 7 files +135/−10, of which 3 are test files (+94) | 3/3 green at head `200f6c8a`; **this pass re-ran its three suites at `2ec675ab`: 45 tests, 3 files, all pass in 696 ms** |
| **#1094** AI audit visibility | `9fcd1e8e` 2026-10-21 02:06:47Z | The audit page renders what the API already returned: `endpoint_locality`, `image_source_types`, `job_reference`, `correlation_id`, via a new pure `aiAuditDisplay.ts`. Missing locality is **LOCALITY UNKNOWN, never "local"**; an image-source list shorter than the pixel count is **PROVENANCE UNVERIFIED**. No policy, provider, signing or access-control change | 3 files +522/−18 | 3/3 at head; **cancelled on `main`** 20 s later when #1095 stacked over it |
| **#1095** this directory | `93fb53ad` 2026-10-21 02:07:07Z | Reconciled the ten memory files to `c199aea2` and added `OWNER_DASHBOARD.md`; machine-checked paths/tables, which is how R-22's byte census was found | 13 files, markdown only | **no check-runs recorded on `main`** — markdown is not excluded from CI here, it simply never ran |
| **#1096** composer integration journey | `b0610551` 2026-10-21 02:07:31Z | One 344-line suite that chains the owner's 16 steps across #1090/#1091/#1088 at the real store/exporter boundary on synthetic data. Its own header records the limit: *"this container has no browser and no PostgreSQL … never claims a rendered page or a database row"* | 1 file +344/−0 | 3/3 green, including on `main` at this SHA |

**Merge order note (this is the third occurrence of the same pattern, so it is a process fact now):**
#1094, #1095 and #1096 all targeted `2ec675ab` and landed at 02:06:47Z, 02:07:07Z and 02:07:31Z. Each
was green against the *old* main; #1094's `main` run was cancelled by the next merge and #1095 recorded
nothing at all. The combined tree is only verified by the run on the **tip**, which is green.
#1096 landed **24 seconds after the documentation pass that describes the tree it changed** — the same
race that produced R-21 when #1088 landed 24 s after the docs PR it invalidated. Nothing was wrong with
either PR; it means a documentation verdict must be re-read against the tip, which is what this pass did.

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
**Re-read at `b0610551`, because #1093 rewrote the same file's neighbours:** the composition is unchanged
and still in the right order — `radiologyReportPdfExport.ts:391` refuses a signed report **before** any
key image is fetched (`:393-396`) and **before** `:397` composes the watermark through
`draftAwarePrintSettings(loadPrintSettings(), { unsigned: input.unsignedDraft })`, so an authoritative
document can never be re-drawn with a `DRAFT` mark. `draftPrintSafety.test.ts` still pins the
composition — `:92` *"the clinic's own configured watermark outranks the draft default"*, which is the
behaviour **D-13** below asks the owner to confirm, and `:97` that the watermark helper does not touch
the signature block. **R-18 stays closed** (`KNOWN_ISSUES.md` R-18 carries the full re-measurement and
the three residuals it did **not** close).

---

## 3. Clinical readiness by component

TESTED here means *regression-tested* — an assertion in the repo that fails when the rule is broken.
**Browser-tested is a different grade and is named in the last column, with who ran it.** Nothing on
this table is DEPLOYED.

| Component | IMPLEMENTED | TESTED | MERGED | DEPLOYED | CLINICALLY VERIFIED |
|---|---|---|---|---|---|
| Reporting workspace / Composer | yes | 15,622-test suite + clinical acceptance corpus | yes (#1090) | **no** | **no** — no human has clicked the combined tree |
| AI-Apply cannot overwrite typed text | yes (`composerApplyGate.ts`) | yes, against the real store | yes (#1090) | no | no |
| AI attribution on draft restore | yes (`aiAttributionRestore.ts`) | unit + the 344-line journey suite (#1096) | yes (#1091) | no | no |
| Print / PDF signer identity | yes (#1088 + #1090 watermark + #1093 gates) | yes — 45 tests in 3 files, re-run by this agent at `2ec675ab`, all pass | yes (`2ec675ab`) | no | **no** — the *author* of #1093 reproduced all three defects in a real browser and re-ran them against the fix; this pass did not repeat that, and no clinician has reviewed a printed report since |
| Signing authorization | yes | yes | yes | no | no — and the policy itself is undecided (**D-10**) |
| Report delivery (Report Hub verify → print) | was **broken on `main`**; the dead-end dialog is fixed | yes (`SIGN_WITHOUT_BLOCK` sentinel + its regressions in #1093) | **yes** (`2ec675ab`) | **no** | **no** — so in the clinic today verify→print is *still* unreachable: the deployed build predates the fix |
| AI audit visibility (locality / image provenance) | yes (`aiAuditDisplay.ts`) | 21 unit tests, author reports 8/8 mutants killed and 16/16 browser checks | yes (`9fcd1e8e`) | no | no — the browser checks are the author's, not reproduced here |
| Cross-agent workflow (Mode A → Quick Select → AI Apply → restore → sign) | n/a (test only) | yes, at the store/exporter boundary: one 16-step journey, 2 `it`s | yes (`b0610551`) | no | **explicitly not** — the file's own header records "no browser and no PostgreSQL … never claims a rendered page or a database row" |
| PACS / OHIF / DICOM | see `ARCHITECTURE.md` | — | — | not inspected this pass | — |
| HOPE integration | implemented | — | — | **never delivered anything** (R-8, 0 rows) | no |

**Integration-status legend applied:** CONNECTED — ERP↔Postgres, ERP↔Orthanc read path.
PARTIALLY CONNECTED — OHIF image selection→ERP, Report Hub→delivery. FIXED-BUT-NOT-LIVE — Report Hub
Sign/Verify dialogs: PI-3 was a hard break on `main`, the fix is merged at `2ec675ab`, and because
nothing has deployed since 2026-10-12 **it is still broken in the clinic**. That is the whole difference
between "merged" and "verified", in one row. UNKNOWN / NOT INSPECTED — `futurekind-platform`
(API returns *Not Found* for this token), and the NAS runtime.

**Repositories inspected vs not:**

| Repo | Inspected | How | Head | Open PRs |
|---|---|---|---|---|
| `care-on-synology1` | **yes, deeply** | code + diffs + CI check-runs + API + one local Vitest run | `b0610551` | 2 (#1097, #1098, both Draft) |
| `hope` | metadata only | API | `c2644c7e`, last push 2026-10-14 | 0 |
| `care-pacs` | metadata only | API | `247f0ccf`, last push 2026-10-18 | 0 |
| `usg-reports` | metadata only | API | `9df0364a`, last push 2026-10-07 | 0 |
| `futurekind-platform` | **NO ACCESS** | API → *Not Found* | — | — |

Repositories existing is **not** evidence their systems are integrated. Cross-repo runtime behaviour
was not tested this pass.

---

## 4. Clinical safety — what is open right now

The three PI findings are kept below **with their original wording**, because the finding is the
history; only the State column moves. Each now carries the five-category verdict separately, since the
categories are what changed this cycle.

| ID | Risk (as found) | Fixed in source | Regression-tested | Browser-tested | Deployed | Clinically verified |
|---|---|---|---|---|---|---|
| **PI-3** | A signed report **cannot be verified in the UI**: `ReportHub.tsx` passed `value=""` to a Radix `SelectItem`, which throws while rendering, so neither the Sign nor the Verify dialog opens — and Print/PDF/Share render only for `verified`/`delivered`. The recovery path the sign dialog names out loud ("sign later from Report Hub") leads to a dead end. | **yes** — `ReportHub.tsx:1004` `SIGN_WITHOUT_BLOCK = "as-me"`, converted back to `null` at `:1019`/`:1072`, used by both dialogs at `:1041`/`:1096`. Re-read at `b0610551` | yes, in #1093's own suites (see the line below this table) | **by #1093's author only** — reproduced in a real browser before and after; this pass ran no browser | **no** | **no** |
| **PI-2** | **Word export rewrote a signed report**: `handleExportWord` fetched the signed print HTML and then let `finalizePrintPreviewHtml` overwrite body and demographics with live editor text — the produced `.docx` had the authorized findings, **no signer at all**, while the same report's PDF carried name, registration number and timestamp. A signature attached to altered content. | **yes** — `useWorkspaceExportShare.ts:258` asks the record (`loadSignerOfRecord(reportId).signerOfRecord !== null`) and `:261` passes it as `authorizedArtifact`; `radiologyReportPrintLiveMerge.ts:381` returns the server artifact untouched when set (option declared `:362`). Re-read at `b0610551` | yes — `radiologyReportPrintLiveMerge.test.ts` (8 tests) | **by #1093's author only** — proven on the produced `.docx` | **no** | **no** |
| **PI-1** | **An unsaved draft printed the workstation's own signature** ("Dr. Station Alpha MD (Station Default), Reg. No: ALPHA-9") with no `NOT SIGNED` anywhere. Cause: `loadSignerOfRecord(null)` returned `unsigned: false`, so the generator took its `settings.signature` branch. This is the "no report row behind it" case that `CLINICAL_SAFETY_REGISTER.md` §9 recorded as a *deliberate carve-out* — a browser pass has now shown it prints a false authorization. | **yes** — `radiologyReportLifecycle.ts:579` now returns `{ signerOfRecord: null, unsigned: true }` (fail-closed), with the same shape on the load-failure path at `:588`; `loadSignerOfRecord` itself at `:575`, `recordedSignerForReport` at `:529`. Re-read at `b0610551` | yes — `radiologyReportLifecycle.test.ts` (27 tests) + `radiologyReportPdfExport.signedArtifact.test.ts` (10 tests) | **by #1093's author only** — reproduced twice on clean studies | **no** | **no** |

**Regression evidence this pass added, not the author's:** those three suites were run locally at
`2ec675ab` (the merge that carries them) — **45 tests, 3 files, all pass, 696 ms**. That re-confirms the
assertions exist and hold on the merged tree; it is *not* a mutation proof (the author's claim, "6
assertions fail with these three changes removed", was not re-derived here) and it is not a render.

Standing, untouched by any of the four merges:

| ID | Risk | State | Where |
|---|---|---|---|
| **R-19 / D-10** | Any non-denied staff session may apply **any active** signature block — the sign route's subject check is a role deny-list, not a staff↔signature binding. Traceable, not refused. | OPEN, **owner decision required** | register §9.3 |
| **R-14 / C2** | Structured Findings edits stay invisible to dirty-detection, the leave warning and the local backup — unsaved structured work can be lost silently. | OPEN | register §7 |
| **R-10** | The **report** image reader still discards *why* an image failed and can drop image cells by budget with no record of the omission (the vision-trial door was fixed by #1089; this one was never the same door). | OPEN | register §8 |
| **D-11** | `POST /:id/verify` still never calls the unreviewed-AI finalize gate (amend, sign and structured finalize do). | OPEN, owner decision | register §0.1 row 9 |
| **D-13** | A workstation's configured non-empty watermark **outranks** the `DRAFT` mark, so an unauthorized export can leave that station with no draft indication. | OPEN, confirmed unchanged at `b0610551` (`draftAwarePrintSettings.ts:46-49`) | §5 below |
| **PIV-1** *(new this pass)* | Images of real patients and their clinical text sit in a **public-repository-hosted directory tree whose folder names are personal names** — see D-14. This is a standing exposure, not a code defect, and it is the only item in this register that no agent may act on. | OPEN, measured, **owner decision required** | §5 D-14, `KNOWN_ISSUES.md` R-23 |

### 4.1 What #1098 would change, stated so it can be decided

Draft #1098 (green, clean, 2 files) moves one authority: `assertVisionCapableModel` no longer refuses a
model whose *name* matches `OLLAMA_TEXT_ONLY_NAME_PATTERNS` before asking the server. The `/api/show`
capability probe now runs first, and the name table only ever *withholds confidence* afterwards
(unknown still fails closed). The PR's own measurement: `gemma4:latest` answers
`["completion","vision","audio","tools","thinking"]` while `/^gemma(?!3)/i` matched its name — so the
clinic's own Ollama said "this model sees" and CARE refused on the name anyway.
**Two facts that bound the risk, both measured on `main`:** the PHI egress decision is upstream of this
door (`composeEngine.ts:597` `assertComposerProviderPolicy`, with `:621` "cloud egress refused", then
`:638`/`:643` the vision check), and neither file #1098 touches is that gate. So #1098 can only widen
which *local* model sees images; it cannot open a cloud door. The reading that needs an owner is the
opposite direction: **CARE now trusts a server's self-reported capability list over its own table.**

Closed this cycle: **PI-1, PI-2, PI-3** as *source and CI* items (all three merged at `2ec675ab`) — they
remain open as *clinic* items until the deploy in priority 1. Closed earlier and still closed: **R-18**,
**D-12**, **G-16**.

---

## 5. Decisions needing the owner (only these five, in priority order)

### D-14 — the legacy report corpus. **Answered, and the answer is worse than the question.**

Last pass this was posed as unknown ("are the `.doc` samples clinic *formats* or real *reports*?"). It
has now been measured read-only, with **no file opened in an editor, no value printed, and nothing
reproduced into any document**. The exposure category is **patient-identifiable clinical records in a
public source-code repository**, and three separate things carry it:

| What | Measured at `b0610551` | How |
|---|---|---|
| **The repository is public** | `visibility: "public"`, `private: false`, 0 forks, 0 stars, 166 MiB packed | `GET /repos/DrAbinash/care-on-synology1` |
| **Directory names are personal names** | **17 distinct name-shaped path components** under `docs/report-formats/`, with **738 tracked files** living beneath them — so a patient name is in the *path*, visible in `git ls-files`, in every clone's filesystem tree, and in GitHub's code search, without any file being opened | `git ls-files docs/report-formats` scanned for components holding 2+ capitalised non-anatomy tokens |
| **The bodies carry a clinical header** | Of 4,990 files: **4,161** match a name/age/sex/referrer header block, **2,089** carry guardian / relation / "son of · d/o" filiation phrasing, **990 distinct** name-shaped values, **1,029** date-shaped, **8** UHID/OP-ID-labelled, **3** mobile-shaped, **3** twelve-digit-shaped; **204** files are too short or opaque to read | Byte-level printable-run extraction (ASCII + UTF-16LE) over every tracked blob; counts and categories only |
| **Format census** | 4,022 Word 97 OLE2, 286 OOXML zip, 492 other binary, 19 plain text, 16 XML/HTML, **7 PDF**, **5 JPEG**, 128 zero-byte. By directory: ct 2,016 / 167.8 MiB · usg 1,962 / 65.7 · xray 691 / 20.1 · mri 320 / 27.5 · total **4,990 files / 281.2 MiB** | magic-byte census + `git ls-tree -r -l` |
| **Not needed at runtime** | No shipped code reads `docs/report-formats/**`. The only code hits for that string are the unrelated API route `/api/radiology/report-formats` and one comment naming `docs/mri-report-formats/`. The runtime asset is the **derived** `artifacts/diagnostic-erp/public/data/radiology-findings-library.json` (**1,232,106 B tracked**, `git ls-tree -r -l`), whose own README already claims *"the library holds no patient data"* — a claim about the derived JSON, not the corpus under it | `git grep` over `origin/main` |
| **Historical, not active** | 3 commits, all on 2026-07-22 (`92d9b5b9` + `78c1efbf` + `cab0d9c1`), never revisited | `git log --format -- docs/report-formats` |
| **`.SynologyWorkingDirectory/` is a different case** | 19,596 files / 28.5 MiB, 14,422 opaque binaries + 5,174 zero-byte. **No long printable run, no word-like sequence, no date or phone shape in any file** — Synology Drive's signature cache, not a document store. Size/hygiene problem, **not** a privacy one | the same extraction over every blob in the directory |

**Limits of this evidence, stated so it is not over-read.** OLE2 `.doc` and OOXML `.docx` bodies are not
parsed here — text is recovered from raw printable runs, so **a negative is not proof of absence**: the
286 OOXML files (whose text lives in compressed parts), the 7 PDFs and the 5 JPEGs (a scanned report is
PHI by nature) were counted by type and not read. The name-shaped and header-block detectors are
patterns, not identities: they can match a referring doctor or a city. None of this changes what the
owner must decide, because the *directory names* need no parsing at all to be identifying.

**Recommended order of actions — every one of them is the owner's to take; no agent may execute any
of them, and none is done by editing code:**

1. **Stop the widening, before anything else.** Decide whether this repository stays public. Every
   clone, fork, CI runner, contributor laptop and GitHub-side cache already has the tree; while the
   repo is public the population is not bounded by the 0 forks the API reports.
2. **Confirm the category in one minute, locally**: open five random files from the largest directory in
   Word and read the header block only. This step belongs to the owner because he knows whether these
   came off the clinic's printer or out of a de-identified sample set — and because doing it himself
   means the contents never pass through an agent.
3. **Decide retention, then move, then ignore — in that order.** Retention is a clinical-records question
   (whose signatures are on those reports, and does the clinic need them as records). Moving means
   `git rm -r --cached docs/report-formats` + a `.gitignore` entry + a `README` pointer to wherever the
   clinic keeps them. **Deleting from `HEAD` does not remove them from history**, so step 3 alone leaves
   the exposure open in every existing clone and in `git log`.
4. **History rewrite only with explicit owner approval, and treated as a separate decision.** `git
   filter-repo` (or BFG) rewrites every commit after the first, which invalidates every open branch and
   PR — there are two Drafts right now and ~90 worktrees on this box — and requires a force-push to
   `main`, which then breaks the NAS's `git fetch && git reset --hard origin/main` deploy flow for any
   checkout that has the old history. It is also not a recall: clones taken before the rewrite keep the
   files. If the corpus must be gone from GitHub's own copies, the documented route is a GitHub
   support removal request (sensitive data), not a rewrite the owner performs locally.
5. **Whichever path is chosen, record the decision** in `CLINICAL_SAFETY_REGISTER.md` as D-14's closure,
   with the date and the reasoning, so the next agent does not re-litigate it — and so the register
   shows that the clinic found it, measured it, and answered it, rather than an agent quietly deleting
   files.

The two mechanical halves that follow from this and are **not** privacy decisions — untracking
`.SynologyWorkingDirectory/` and shrinking the deploy payload — sit in §7 as RETIRE items.

### D-10 — signature ownership policy (unchanged, still first among the code decisions)

Any non-denied staff session may apply **any active** signature block: the sign route's subject check is
a role deny-list, not a staff↔signature binding (R-19, register §9.3). Options: (a) 1:1 binding,
(b) keep the deny-list + audit, (c) allow delegation with an explicit recorded delegate.
**Consequence:** (a) stops the single-radiologist clinic signing today if signers lack their own
accounts. Nothing here should be "fixed" by an agent.

### D-11 — is `verify` a finalization?

`POST /:id/verify` is the one signed-artifact door with **no unreviewed-AI gate** (amend, sign and
structured finalize all have one). It is now reachable again for real users — PI-3 merged — so the door
that was theoretical last cycle has a working handle. Owner's call, then one rule enforced in code.

### D-13 — may a workstation's configured watermark suppress the `DRAFT` mark?

Measured again at `b0610551`, **unchanged**: `draftAwarePrintSettings.ts:46-49` — any non-empty clinic
watermark **outranks** `DRAFT`, and `draftPrintSafety.test.ts:92` pins that as intended behaviour. So an
unauthorized document leaves that station with no draft indication. Deliberate in the code's own words;
the owner should confirm or overrule it. ⚠️ *Naming hazard:* this register's `D-n` sequence collides with
Composer's internal finding IDs (`#1090`'s `composerApplyGate.ts` header cites "D-13's cross-study arm"
meaning something else). Reserve `D-n` for this register.

### D-15 — deployment readiness: is "not deployed" a policy or an accident?

121 merged commits, last verified deploy **2026-10-12**. Every clinical row in §3 and §4 above stops at
MERGED for the same reason. This is now the largest single gap between what the codebase promises and
what the clinic does: PI-3's dead-end dialog, PI-1's borrowed workstation signature and PI-2's rewritten
Word export are all **live in the clinic right now**, because the fix that closed them is not deployed.
The owner decides when to run `deploy-synology.sh` (a NAS deploy takes the clinic down); what is needed
from this directory is that the decision is *recorded*, so "merged" is never again read as "done" and so
the 2026-10-12 → 2026-10-21 accumulation gets a deliberate date rather than drifting.

Already settled — **do not re-ask**: D-1…D-7, D-9 (answered by #1093's rig), D-8 and D-12 (superseded by
merges). Closed by events: the **merge decision on #1093** — it merged at 2026-10-20T17:38:08Z as
`2ec675ab` with its three suites passing.

---

## 6. Five next actions, ranked

| # | Action | Why it matters | Benefit | Owner agent | Dependencies | Acceptance |
|---|---|---|---|---|---|---|
| 1 | **Decide and execute a deploy**, with commit-identity proof (D-15) | PI-1/PI-2/PI-3 are fixed in source and merged but **still live in the clinic**, because the deployed build predates them. 121 commits of clinical work are unfelt | Turns merged work into patient-facing reality, and retires the "merged = done" illusion in the same step | **Owner** runs `deploy-synology.sh`; this agent records evidence | a deploy window; nothing in `main` blocks it (tip is 3/3 green) | Post-deploy probe reports the running commit = `b0610551` or later; one real signed report and one unsaved draft printed from the clinic, and the four entry points (PDF, Word, print, verify) reviewed on each |
| 2 | **Answer D-14: is this repository allowed to stay public, and what happens to `docs/report-formats/`?** | Measured: 738 files sit under name-shaped directories, 4,161 files match a clinical header block, and the repo is `visibility: public`. This is the only item here that is not a code problem | Stops an active exposure; everything else in this table is quality | **Owner** alone — an agent must not delete, rewrite history, or open the files | none; it is independent of every other row | A dated decision in `CLINICAL_SAFETY_REGISTER.md`: visibility + retention + which of the four remediation steps is taken, and which are explicitly refused |
| 3 | **Get #1097 green and rebased** — run the factory-box generator its own gate names, then rebase onto `b0610551` | Its red is not the census: `generateQuickSelectFactoryBoxes.test.ts:71` shows the catalogue hash moved `2f4326815314 → 215e2a0c52d9` because 6 tiles gained `impressionSentence`/`conflictGroup`. Rebasing also drops the 344-line file `#1096` already merged | Unblocks the only regional-coverage suite in flight, and removes a duplicated blob from the review surface | **Z.ai** (owns Composer/Quick Select) | the generator is in the same repo | 3/3 CI at a head whose base is `b0610551` or later; `composerIntegrationJourney.test.ts` no longer appears in the PR's file list; the regional corpus's new pairs shown failing before the tile fix |
| 4 | **Give the census test an explicit, measured timeout** (`quickSelectClickOrderCensus.test.ts`, the 29-tile pair loop) | Measured 2,051 / 2,326 / 2,409 ms in isolation against a 5,000 ms default, plus 834 fire-and-forget `POST …/use` calls each scheduling a real ~400 ms backoff timer in a test that has no server. One timeout in ~41 runs, and the run it landed on was **someone else's PR** | Ends cross-agent false blame and removes a reason to re-run CI | this agent may propose it as a **separate tooling Draft PR**; Z.ai owns the assertion | none | The `it` carries an explicit timeout derived from measurement, **no assertion is changed or removed**, a mutation that lets one tile alter an unrelated tile still fails, and two consecutive green runs |
| 5 | **Browser-verify the combined tree** — Restore → AI Apply → typed edit → Print → verify → audit page, one study, on `b0610551` | #1096 gives this a store-boundary journey but its own header says it stops there: no browser, no PostgreSQL. #1094's audit columns are rendered logic nobody has looked at in a browser but the author | Converts "merged" toward "clinically verified" for attribution, lost-edit protection and egress visibility | **AI Architecture** (provenance, audit) + **Qwen** (print), one report each | a scratch DB only; never the NAS | A dated, reproducible browser transcript per agent naming what each saw **and what each did not test**; specifically the D-13 case (clinic watermark set, report unsigned) |

---

## 7. Technical debt noticed this pass (classify only — no code touched)

| Item | Evidence | Class |
|---|---|---|
| Four rendered PDFs committed by #1090 — `artifacts/radiology-e2e-acceptance/reports-v2/CASE-1{A,B}.pdf`, `CASE-2{A,B}.pdf`, **2,522,239 bytes (2.4 MiB)** across 4 files, byte-identical in size at `b0610551` | `git ls-tree -r -l origin/main -- artifacts/radiology-e2e-acceptance` | **INVESTIGATE**. Rendered PDFs are timestamp-nondeterministic, so they will churn on every regeneration and cannot serve as byte-goldens; and nothing on `main` reads them back |
| `docs/report-formats/**` — **4,990 files / 281.2 MiB** (ct 2,016 / 167.8 · usg 1,962 / 65.7 · xray 691 / 20.1 · mri 320 / 27.5), 64% of the tracked tree's bytes, committed 2026-07-22 (`92d9b5b9`) and never classified | `git ls-tree -r -l origin/main` summed by directory at `b0610551` | **SPLIT**. The *privacy* half is decision **D-14** and is now measured — no agent may act on it. The *size* half is RETIRE: nothing at runtime reads the directory, the derived `radiology-findings-library.json` is the asset. Note the correction: last pass this row said 4,975 / 280.8 MiB with ct 2,011 · mri 316 · xray 685; the per-directory parse under-counted 15 files. Both counts came from the same command, so the difference is this directory's parser, not a change on `main` |
| The tracked tree is **437.1 MiB over 29,688 paths**, of which these two directories are 70.8% of bytes and 82.8% of paths | same command over the whole tree at `b0610551`; last pass read 437.0 MiB / 29,684 paths | **RETIRE the two blocks, then re-measure.** Consequence unchanged: `deploy-synology.sh` does `git reset --hard origin/main` on the NAS, so a one-line change ships 437 MiB; and `execFileSync`'s 1 MiB default `maxBuffer` kills any tool that shells out to `git ls-tree -r` here (that is how R-22 was found) |
| `.SynologyWorkingDirectory/Sign/**` — **19,596 files / 28.5 MiB** of Synology Drive Client's own signature cache, committed wholesale in `5cb9956e` *"initial care erp upload from synology production"* | magic-byte + text census over every blob: 14,422 opaque binary, 5,174 zero/tiny, **no** long printable run, **no** word-like sequence, **no** date or phone shape | **RETIRE** (hygiene, not privacy — this pass can now say that from a measurement instead of a guess). `.gitignore` plus untracking; not done here because `git rm -r --cached` changes what the NAS's `git reset --hard` lays down, which is an owner/infra decision |
| **Two suites run against Vitest's 5,000 ms default with no declared timeout** — the census pair loop, and now `composerIntegrationJourney.test.ts:124`, a 16-step chain across three merged systems. `vitest.config.ts` still sets no `testTimeout` | `Read vitest.config.ts`; `grep -nE "\},\s*[0-9_]+\);"` over both files → no matches | **REPAIR, cheap.** Priority 4 covers the census. The journey file is the larger prize: it is the *only* cross-agent workflow guard, its own header admits it stops at the store boundary, and if it ever flakes in CI the agents will read that as a Composer/print integration failure rather than a clock. Add a derived timeout to both; change no assertion |
| Unit tests fire real network calls: the census run emits **834 `POST /api/radiology/report-formats/:id/use`** failures, one warning each, because `store.ts:2371` and `:2641` do `void bumpReportFormatUsage(...)` and `reportFormatsApi.ts:65` posts through `fetchApi`, whose first-failure path schedules a jittered ~400 ms backoff timer | counted from `[fetchApi]` warnings in two local runs (834 both times); `fetchApi.ts:104-106` `MAX_RETRIES = 3`, `BASE_DELAY_MS = 400` | **INVESTIGATE, then REPAIR in the test, not the store.** Fire-and-forget is right in a browser (a template-use counter must not block a click) and wrong in a unit test with no server. A `fetch` stub inside the census file removes 834 real timers and their log noise without touching one clinical assertion. Not done here: this is Z.ai's suite and the counter is production behaviour |
| **#1097 carries a byte-identical copy of a file `main` already has**: its `composerIntegrationJourney.test.ts` blob is `c65098fe…`, the same object `#1096` merged | `git rev-parse gh/1097:… origin/main:…` after fetching `refs/pull/1097/head` | **REBASE, don't review twice.** Identical blob ⇒ git will auto-resolve, so this is *not* a conflict — but the PR's file list still shows +344 for work that has landed, which is 45% of its diff and invites a reviewer to read a merged test as new. It exists only because #1097's base (`2ec675ab`) predates `b0610551`. See priority 3 |
| `CARE_COMPOSER_99_9_PROGRESS.md` — an 11th project-memory file, at the repo root, owned by another agent, referenced by **none** of the other files in this directory until `OWNER_DASHBOARD.md` cited it twice | `grep -rn CARE_COMPOSER_99_9_PROGRESS docs/project-memory/` → only this file | **CONSOLIDATE**. It uniquely records how R-18 was resolved (merge commit `104d3f48`) and also still carries the deleted-module claim this directory corrected: it describes #1085's "server-side `reportSignerSelection`", which #1088 deleted (`git ls-files \| grep -c reportSignerSelection` → 0) |
| Two ID namespaces collide (`D-n` in this register vs `D-n` inside Composer's code comments) | §5 above | **REPAIR** by convention, in writing, at near-zero cost |
| The documentation checks this directory keeps asking for were prototyped here and **the false positives, not the defects, were the work** | this pass ran a throwaway validator over all ten files: **0 table defects**, 44 "dead path" hits of which every one is a documented convention (bare-path shorthand), an other-repo path (`PACS/...`), a deliberately-cited deleted module, a glob placeholder, or this directory's own filenames; 20 "odd backtick" hits of which all are wrapped inline code or a fenced block | **KEEP the check, scope it honestly**: it needs (1) fenced-block skipping and logical-line joining, (2) an allow-list for other repos and for paths cited *because* they are gone, (3) `maxBuffer` raised above 1 MiB or `git ls-tree -r` kills it silently. Zero of the ten files currently fail a *structural* check — `OPEN_WORK.md` priority 10 should build on this, not start over. This pass re-ran it over the rewritten files before committing (§8) |
| Knowledge loss actually happened: the Composer branch's **nine prior commits were never pushed and died with a container reset**, then were rebuilt from a worklog | `CARE_COMPOSER_99_9_PROGRESS.md` §"Provenance of this branch" | **REPAIR the process** — push-per-stage is now that agent's habit; this dashboard exists so no other agent's only copy lives in a container |

---

## 8. How to re-verify this file in one minute

```
git fetch origin && git rev-parse --short=8 origin/main
gh api repos/DrAbinash/care-on-synology1/commits/$(git rev-parse origin/main)/check-runs
gh api "repos/DrAbinash/care-on-synology1/pulls?state=open"
git rev-list --count --since=2026-10-12T22:30:00Z origin/main
gh api repos/DrAbinash/care-on-synology1 -q .visibility          # D-14: public or private, right now
git ls-tree -r -l origin/main -- docs/report-formats | wc -l      # and its byte sum, same command
node node_modules/vitest/vitest.mjs run artifacts/diagnostic-erp/src/lib/quickSelectClickOrderCensus.test.ts --reporter=verbose
node node_modules/vitest/vitest.mjs run artifacts/diagnostic-erp/src/lib/radiologyReportLifecycle.test.ts \
  artifacts/diagnostic-erp/src/lib/radiologyReportPdfExport.signedArtifact.test.ts \
  artifacts/diagnostic-erp/src/lib/radiologyReportPrintLiveMerge.test.ts
```

The last two lines are what this pass added to the method: **the census numbers and the 45-test print
verdict come from a run, not from a badge** — so they are this box's timings, not CI's, and re-measure
before quoting them elsewhere. `--reporter=basic` does not exist in Vitest 4 and silently runs nothing;
read the `Test Files` line before believing any result.

If the first four disagree with anything above, **they are right and this file is stale** — that is the
normal state of a document about this repository, which is why every row above carries its date.
