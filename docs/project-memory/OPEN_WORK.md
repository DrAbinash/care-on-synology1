# OPEN WORK — what is not finished, and what is next

Two different lists, deliberately. §1 is **work in flight** (PRs, registers, unwired code).
§2 is the **ranked next ten**, ordered by the weighting the owner set: patient safety → clinical
workflow reliability → reporting speed → data integrity → system availability → AI reliability →
user experience → maintainability.

Baseline `origin/main` `47b739c8`, measured 2026-10-20 (rewritten from `c4462041`, then from
`1c80f2d3`, the same day; the open-PR rows moved twice while this file was being written).

---

## 1. In flight

### 1.1 Open PRs — **zero on `main`'s side; this branch is the outstanding work**

**Correction (2026-10-20, later the same day):** this section opened *"Open PRs — three, all Draft,
all two merges behind `main`"* and listed #1083, #1084 and #1085. **All three were marked ready and
merged by the owner inside one minute of each other** while the revision was in progress:

| PR | Merged as | Time | What it delivered | What it left behind |
|---|---|---|---|---|
| #1083 | `d45370c3` | 03:48:31Z | the six `docs/project-memory/*` files, in their `c4462041` form | **the merged copy is stale** — it says `main`'s test job is red, #1081 is a Draft and three PRs are open. Corrected in place by this branch |
| #1084 | `d7abb9b3` | 03:48:48Z | the four `AI_COMPOSER_*.md` docs, 4 files +3,393/−0 | its **G-20 row is false** against today's tree (`AUDIT_RECONCILIATION.md` §2) |
| #1085 | `47b739c8` | 03:49:09Z | print/PDF **code**: Doppler emphasis, `IMAGE COULD NOT BE READ`, `lib/reportSignerSelection.ts`, +320 harness lines | merged, not deployed, and **no human has reviewed a rendered page or PDF from it**; class 9's letter-pad default still open (`CLINICAL_SAFETY_REGISTER.md` §9) |

`GET /pulls?state=open` on `DrAbinash/care-on-synology1` now returns an empty list; every one of those
branches was deleted on merge, so **the only way to change what they say on `main` is a new PR** —
which is this documentation set. Its three new files are **not on `main`**: `OWNER_VISION.md`,
`AUDIT_RECONCILIATION.md` and `CLINICAL_SAFETY_REGISTER.md` exist only here
(`git ls-tree -r --name-only origin/main -- docs/project-memory` → 6, this branch → 9).

Re-fetch before quoting any of these numbers — `merge_commit_sha` on an open PR is a test-merge
preview, not a merge, and a squash merge usually deletes the branch that produced it — `gh`'s PR
payload reports the head repo as absent, and re-pushing that branch creates a **new** ref, not a
reopened PR (a merged PR cannot be reopened).

**What is open now: Draft PR #1087** — `docs/project-memory-reconstruction` at `db264aa5`, base `main`,
9 files **+1,052/−126**, documentation only: this branch's corrections plus the three files that never
merged (`OWNER_VISION.md`, `AUDIT_RECONCILIATION.md`, `CLINICAL_SAFETY_REGISTER.md`). Its own CI verdict
is in `CURRENT_STATE.md` §2; it must not be merged without the owner.

### 1.2 Registers with live rows

| Register | Rows still open | Verbatim status |
|---|---|---|
| `docs/engineering/RIS-PACS-INTEGRATION-TODO.md` | RIS-007, RIS-009, RIS-011 (+ every `Deployed: no`) | RIS-007 *"CONFIRMED (code) / NOT REPRODUCIBLE live"*; RIS-009 *"PARTIAL — the Chromium multi-navigation re-probe was not re-run this session"*; RIS-011 *"TODO"* |
| `docs/CARE_ERP_PREDEPLOYMENT_GATE.md` CL-1..CL-10 | CL-1, CL-2, CL-3, CL-5, CL-6, CL-7, CL-8, CL-9, CL-10 | CL-2 *"NOT TESTED — the artifacts exist and are fresh; restorability is unproven"*; CL-9 *"FAIL — exposure, not a fault of this deploy"* |
| `docs/architecture/radiology-ai/AI-SCREENSHOT-WORKFLOW-REUSE-AUDIT.md` §13 | five owner decisions | *"Decisions the owner still owes before Stage 1 is implemented"* — includes which model interprets, and whether image-derived findings are provisional proposals or draft text |

### 1.3 Written but never wired

| Thing | Where | Evidence it is dead |
|---|---|---|
| Evaluation framework | `lib/ai/evaluationRunner.ts:36` `runEvaluation` | The only non-test occurrence in the repo is the definition itself |
| Night scheduler admission | `lib/ai/aiScheduler.ts:120` `admitJob` | Definition + tests only |
| Golden dataset | `lib/db/src/schema/aiEvaluation.ts:36` `ai_golden_cases` | Zero inserts anywhere (`grep -rn "ai_golden_cases" --include=*.ts`) |
| Orthanc→ERP fast path | `routes/internal-radiology.ts:1885` + `docker/orthanc/erp_notify.lua` | `PACS/orthanc/config/orthanc.json` carries **no** `LuaScripts` entry; `orthanc-webhook` appears nowhere in `care-pacs` |
| Super Admin portal dev leg | `package.json:12` filters `@workspace/super-admin-portal` | The package lives in `__super_admin_quarantine/` and matches no `pnpm-workspace.yaml` glob |
| USG workspace flag | `ff_radiology_usg_workspace` | *"still defaults OFF and gates nothing in the ERP"* (`usgWorkspaceContract.test.ts:29-32`) while the api-server rollout plan still lists it |

### 1.4 Feature work that stops short of "done"

* **Canal AP gap 4 — two stores at entry time.** Print is folded to one rule; the AI-tab box still
  writes both. Closing it needs viewer capture moved into the rail grid — an owner call about UI, not
  a defect (`docs/engineering/RIS-PACS-INTEGRATION-TODO.md` §"Remaining gaps").
* **V4 in a browser is unproven.** The local database has no dorso-lumbar reporting format, so the DL
  canvas and table never mount locally; `mriBrainCanvasPlacement.test.ts` is still a source-text
  guard over UI that renders zero elements (the `{false && (` block is deliberately disabled).
* **Composer durable Apply** — two-phase design with three columns, four things open.
* **Findings caret-reveal deferral** (#1031) — deferred until the acceptance battery can see it.
* **Critical-result comms** sit behind a default-OFF toggle (#843): shipped, not enabled.

### 1.4b New open items produced by this pass (2026-10-20, all re-read from `1c80f2d3`)

* **Structured Findings are outside the dirty-check.** `lib/workspaceReportState.ts:63-71` omits
  `findingsMap` from `serializeReportSnapshot`, on which `isReportDirty` (`:74`) and `BackupEnvelope`
  (`:85`) depend. One field, one function, three protections blind. July's finding C2, still true —
  and **re-verified true at `47b739c8`**, because #1085's diff does not include that file.
  `CLINICAL_SAFETY_REGISTER.md` §7. **This is the #1 code priority.**
* **An unsigned report can print "Signed: Dr. …".** `lib/reportPresentation.ts:715-717` falls back to
  the static letterhead's radiologist + credentials when `model.signatures` is empty, and
  `routes/patient-reports.ts:3334` produces exactly that empty array for a report with neither a
  `signatureId` nor a `signedByName` — on `GET /api/patient-reports/:id/print` (`:3524`), which is not
  gated on signed status. Pinned by `reportPresentation.test.ts:202,:214`. Found while re-checking
  #1085, which closed the identical invented-name fallback on the **preview** door and shipped
  `lib/reportSignerSelection.ts` (returns `null` → no signer prints) for the other. **Owner decision
  first** (`KNOWN_ISSUES.md` R-17): apply the chooser to the letter-pad, or gate the print route.
* **Image honesty is merged but the *reason* is still thrown away.** `lib/reportImages.ts:147`/`:186`
  return `null` for every failure mode, and `:238` can drop key images when the byte budget is spent
  without recording the omission (#1085 fixed the *page*, not the *reader*).
* **The USG Studio bridge attributes signatures from a relayed name.**
  `routes/internal-reporting-studio.ts:845` → `:889`/`:891` vs the ERP path at
  `routes/patient-reports.ts:2584-2618`. Needs either a `signatureId` on the studio path or an explicit
  statement that the printed name on a studio-relayed report is not an authenticated signature.
* **No register defines the owner's six-section order.** `renderer.ts:311→:320→:241/`:267→:365` and the
  stored `sectionOrder` default `"Technique,Findings,Impression"` are two mechanisms; Demography and the
  examination name are a third and fourth. `OWNER_VISION.md` §4.1.
* **De-identification is built and never called.** `deidentifyImagesForCloudEgress`
  (`lib/ai/imageDeidentification.ts:319`) has no production caller — only its own test file. Wire it or
  retire it and say so (finding **G-11**).
* **Two honesty gaps in the vision path, both small:** `deepseekVisionTrial.ts:112` still
  `images.slice(0, 6)` instead of refusing (**G-16**), and `lib/db/src/schema/aiReporting.ts` has **no**
  truncation columns, so a truncated answer is diagnosed in the UI and never persisted (**G-19**).
* **`autoCompose` has no server consumer.** Settings UI only
  (`pages/AiReportingSettings.tsx:432,:747,:858,:1494`) — a switch that does nothing (**G-22**).

### 1.5 CI integrity on `main` — **closed 2026-10-20 by #1086**; kept because the reasoning is the asset

This section formerly read *"`Tests + migration smoke` is **failing on the tip of `main`**
(`c4462041`, run `39319802877`)…"* and set the reader a choice: *either arm order is meaningful and
must be deterministic … or it is not (then the assertion should compare as a multiset)*.

**Answer chosen and shipped: arm order is not meaningful.** `Promise.all` dispatch order in
`routes/aiComparison.ts` is the kernel's decision, while the row→arm mapping (`armIndex`, `model`
resolved through `identity()`, `imageCount`) is deterministic. The test now asserts the deterministic
`(armIndex, model, imageCount)` table and compares transport order as a sorted multiset, and a new case
(**TEST 15b**) forces the two arms to complete in the opposite order behind a 2 s barrier, with a
positive control that fails if the barrier never engaged. Mutation M2 (rows assembled in completion
order) is caught **only** by the new case — which is how "coverage preserved" was proved rather than
asserted. `main` at `1c80f2d3`: 3/3 jobs green, that suite at 50 tests — **and still 3/3 green at the
current tip `47b739c8`** (run `39366275815`, `Tests + migration smoke` completed 04:00:37Z, the same
suite at **50 tests / 2,281 ms**, 15,427 tests overall). Nothing red on `main` at the time of writing.

**What remains in this class:** nothing red. The standing obligations are (a) read the failing **step**
before attributing red — the `apt`/`exit=124` mirror stall and a `cancelled` merge-commit test job are
both not code — and (b) never write a test that shells out to `git diff origin/main…HEAD`, because CI
checks out a detached single commit and cannot resolve it.

---

## 2. The next ten priorities

**Urgent** = a patient or the record is exposed until it is done. **Optional** = worth doing, not
dangerous to delay.

### URGENT

**1. Deploy `main` and prove the identity of what got deployed.**
Rank driver: *patient safety*. The merged P0 fixes for wrong-patient/wrong-exam identity (#1040,
#1042, #1044, #1058, #1047) are **not running**; the clinic is on a 2026-10-12 build whose commit
identity is unproven (the last recorded check showed `/api/health` reporting `2d51e8d7` while the
checkout was `46d36612` — refuted in `docs/CARE_ERP_PREDEPLOYMENT_GATE.md:357`).
Concrete shape: run `deploy-synology.sh` (a human decision, a clinic-outage window), then
`node scripts/verify-deployed-identity.mjs` **inside the api container**, not on the host.
This is the only item that makes the other nine visible to patients.

**2. Bind a backup to the deploy and produce one restore proof.**
Rank driver: *patient safety via recoverability*. CL-3: `deploy-synology.sh` takes **no** backup and
its own steps are `git reset --hard` → `compose down --remove-orphans` → `up -d --build`
(`docs/CARE_ERP_PREDEPLOYMENT_GATE.md:721`). CL-2: **no restore has ever been proven**,
`public.backup_verification` has 0 rows. Item 1 without item 2 is an unguarded write to the only
copy of the clinic's records.

**3. Publish the uploads volume in the backup set.**
Rank driver: *data integrity*. Frozen key images live on disk
(`data/uploads/radiology-key-images`, volume `uploads_data`, `lib/frozenKeyImages.ts:33`) and drive
print/PDF when present (`:1-14`). A database-only restore silently loses every image in every signed
report. `scripts/verify-uploads-restore.mjs` exists; its verdict has never been recorded on the NAS.

**4. Put `findingsMap` inside the report snapshot — the silent-loss Critical that is still true.**
Rank driver: *patient safety via record integrity*. *(Replaces "merge or close #1081", which the owner
did on 2026-10-19: merged as `c208cbfb`.)* `serializeReportSnapshot`
(`artifacts/diagnostic-erp/src/lib/workspaceReportState.ts:63-71`) hashes
`clinicalHistory, technique, rawFindings, impression, recommendation, quickSelectIds` and **not
`findingsMap`**, so `isReportDirty` (`:74`), the leave warning and the local `BackupEnvelope` (`:85`)
are all blind to structured-mode Findings edits, while `findingsMap` is what the workspace renders and
edits (`workspace/ReportCanvas.tsx:249`, `:1487`). It is one field in one pure function with three
dependents; write the red test first (type into a structured section, do not save, reload), then the
fix, then a mutation that proves the guard fires. This is July finding **C2**, unchanged ~700 PRs later.

**4b. Stop an unsigned report from printing "Signed: Dr. …".**
Rank driver: *patient safety — signature attribution*. `lib/reportPresentation.ts:715-717` substitutes
the static letterhead radiologist (`lib/careLetterheadChrome.ts:24-25`) whenever the renderer is handed
no signature, and `routes/patient-reports.ts:3334` produces exactly that when a report has neither a
`signatureId` row nor a `signedByName`. The surface is `GET /api/patient-reports/:id/print` (`:3524`)
with no signed-status gate, and `?preview=true` is documented as rendering *the same artifact*. The
behaviour is pinned (`reportPresentation.test.ts:202`, `:214`), so **this is an owner decision before
code**: should a report the clinic has not signed ever carry a "Signed:" line? Two honest answers — use
the chooser #1085 shipped (`lib/reportSignerSelection.printSigner`, which returns `null` and therefore
prints no signer), or keep the letterhead default for previews and gate it out of the real print.
Smallest fix in this file, and the only one that changes what a patient holds.

**5. Close the LAN exposure on the PACS box (CL-9).**
Rank driver: *system availability / confidentiality*. As recorded: `care-orthanc` **8042 and 5680**,
`care-ohif` 3010, `care-web` 8888 and the HOPE app 7080 are published on `0.0.0.0`; port 5680 is
`"5680:4242"` in `care-pacs/docker-compose.yml:70`, so *any device on the clinic LAN can C-STORE into
the production index unauthenticated* and read the whole DICOMweb query surface at 8042. `care-db` is
correctly loopback-only, which proves the fix is a two-line change of the same kind. Owner decision
on the publication/firewall surface; **this is a configuration change on shared infrastructure and
must not be done by an agent.**

**6. Resolve the callback address disagreement, then observe one HOPE delivery.**
Rank driver: *clinical workflow reliability*. CL-6 says the outbox has never had a row, while
`care.env`/README and `NAS_OVERNIGHT_ENV_PATCH.env` name two different hosts, one of which TCP-times
out. Fixing the retry logic (#995-#999) is invisible until a delivery is *seen* in
`integration_delivery_attempts`.

### OPTIONAL

**7. Give the deployed build a browser acceptance pass, and version the staging tree (CL-10).**
Rank driver: *reporting speed + trust in the evidence*. Staging runs beside production from
`/volume1/docker/care-d2-staging/care-erp`, **which is not a git repository**, so acceptance results
cannot be tied to a SHA, and `d2stg-orthanc` uses the unpinned `orthancteam/orthanc:latest`. Either
version the tree or stop presenting its verdicts as production evidence.

**8. Take up the five owner decisions in `AI-SCREENSHOT-WORKFLOW-REUSE-AUDIT.md` §13, then wire the
evaluation loop.**
Rank driver: *AI reliability*. Vision model choice is currently a name in settings
(`qwen3-vl:8b` is recorded as the default that returned empty twice); `runEvaluation`, `admitJob` and
`ai_golden_cases` exist with no caller (§1.3). Without a golden set, "the AI is getting better" is
unfalsifiable.

**9. Fix the documentation that contradicts the code, then make the corpus navigable.**
Rank driver: *maintainability*, but it is also the reason agents keep shipping stale claims. `KNOWN_ISSUES.md`
§2 lists seven verified cases, including a retention table that contradicts its own correction banner
14 lines above, and a checklist row that still marks the unwired evaluation framework ✅. Secondary:
`docs/` holds 278 `.md` files among 5,618, `Antigravity/` holds 101 more, there is no root `README.md`,
and this repo has **99 git worktrees**.

**10. Adopt the repository's own verification discipline as a PR gate.**
Rank driver: *maintainability + trust*. `grounding-check.cjs` already fails the build on 105
architecture claims; extend the same machine-checked treatment to the retention/egress claims that
are wrong today, keep preferring `*.request.test.ts` over source-text greps (`AGENTS.md:34` records a
green grep-test that shipped an HTTP 500 route), and record for every merged clinical PR which of
CI / local / browser / rendered-artifact actually ran.

### Deliberately not on this list

* **Do not automate NAS failover** — the standby plan says so explicitly
  (`docs/CARE_ERP_SECOND_NAS_DISASTER_RECOVERY.md:355`).
* **Do not re-raise the two owner-accepted risks** (Orthanc auth posture, DICOM replication) — they
  are recorded as accepted decisions, not defects.
* **No `db:push` against any real database**; schema changes go through `migrations/*.sql` and the
  `care-db-patch-v2` → `care-schema-verify` chain.
* **No port 80 assumption on Windows.** The emergency overlay defaults to host 8080 precisely to
  avoid elevation (`deploy/windows-emergency/docker-compose.windows.yml:5,12`).
