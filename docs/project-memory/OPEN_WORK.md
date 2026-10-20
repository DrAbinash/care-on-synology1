# OPEN WORK — what is not finished, and what is next

Two different lists, deliberately. §1 is **work in flight** (PRs, registers, unwired code).
§2 is the **ranked next ten**, ordered by the weighting the owner set: patient safety → clinical
workflow reliability → reporting speed → data integrity → system availability → AI reliability →
user experience → maintainability.

Baseline `origin/main` `dc8c3aba`, measured 2026-10-20 (rewritten from `c4462041`, then from
`1c80f2d3`, then from `47b739c8`, the same day; the open-PR rows moved **three** times while this file
was being written, and six PRs merged across those passes — so read the SHA above, not the prose).

---

## 1. In flight

### 1.1 Open PRs — **two (#1090 conflicting with `main`, #1091 a Draft that fixes an open finding)**

**Correction (2026-10-20, third pass, at `dc8c3aba`):** this section read *"zero on `main`'s side; this
branch is the outstanding work"* and named Draft **#1087** as the open PR. #1087 was merged by the owner
as `8bbac44e` (15:10:50Z), **so all nine `docs/project-memory/*` files are now on `main`** — the
"invisible to an agent starting from `main`" hazard this file warned about twice is closed, and
replaced by its opposite: `main` now carries a memory set that cites `lib/reportSignerSelection.ts`,
a module **#1088 deleted four minutes later** (`KNOWN_ISSUES.md` §2 and §4 item 24).

| PR | Merged as | Time | What it delivered | What it left behind |
|---|---|---|---|---|
| #1083 | `d45370c3` | 03:48:31Z | the six `docs/project-memory/*` files, in their `c4462041` form | **the merged copy is stale** — it says `main`'s test job is red, #1081 is a Draft and three PRs are open. Corrected in place by #1087 |
| #1084 | `d7abb9b3` | 03:48:48Z | the four `AI_COMPOSER_*.md` docs, 4 files +3,393/−0 | its **G-20 row is false** against today's tree (`AUDIT_RECONCILIATION.md` §2), and its **G-1 row is now refuted as worded** (`KNOWN_ISSUES.md` §5) |
| #1085 | `47b739c8` | 03:49:09Z | print/PDF **code**: Doppler emphasis, `IMAGE COULD NOT BE READ`, `lib/reportSignerSelection.ts`, +320 harness lines | `reportSignerSelection.ts` **no longer exists** — deleted by #1088. Merged, not deployed, and **no human has reviewed a rendered page or PDF produced by it** |
| **#1087** | `8bbac44e` | 15:10:50Z | this documentation set, **9 files +1,067/−126**, documentation only | **corrected here:** this file recorded it as "+1,052/−126", which was the branch before its final commit. Its merge-commit CI run (`39446038639`) was **cancelled** 24 s in when #1088 landed — legitimate under the concurrency group; 3/3 green on its head `4589e224` |
| **#1088** | `37a6758c` | 15:11:14Z | **the signer-of-record code, 20 files +1,658/−293**: eligibility decided from rows instead of a name regex, retired blocks refused on write, the printed name read from `signatureId`/`signedByName` instead of this browser's Print Settings, `NOT SIGNED` on both render doors, and a client PDF door that **refuses to re-render a signed report** | **closes R-17 / decision D-8 / register OPEN-2** — the unsigned report that printed `"Signed: Dr. …"`. Names two gaps in its place: **OPEN-3**, any non-denied staff session may apply any active block (`KNOWN_ISSUES.md` R-19), and the deliberate carve-out for documents with no report row behind them. Merged, **not deployed**, **not reviewed on a rendered artifact** |
| **#1089** | `dc8c3aba` | 15:11:37Z | **the vision-trial picture set, 4 files +367/−17**: a set that breaks a ceiling is refused as a whole instead of silently trimmed, so an operator is no longer shown an answer to fewer images than they sent | **closes G-16** at the route door (the provider's own `slice(0, 6)` survives at `deepseekVisionTrial.ts:112` as a second ceiling its only caller cannot now exceed). Its route-level DB suite was **removed before merge** because it destabilised two unrelated suites, so "a refused set never opens a socket" is enforced by a static guard + unit tests, **not** by an executed route test |

`GET /pulls?state=open` at `dc8c3aba` returns **two**. **The first is #1090 "Composer/99 9"** —
head `4598e8a9`, 23 files +2,041/−32 when read at 20:55 IST; re-read at **22:02 IST** it is
**`draft: true`**, head **`06befc27`**, **25 files +2,655/−41** (the owner's brief called it "OPEN",
and at 20:55 IST it was `draft: false` — ready; the Composer agent pushed again and flipped it to
Draft in between). Both readings: base `main`, `mergeable: false` / `dirty`, and **zero check-runs at
its head**, so no green exists to quote for it either way. Its
merge-base is `47b739c8` — it branched before #1087/#1088/#1089 — and
`git merge-tree --write-tree origin/main refs/pull/1090/head` conflicts in exactly two files,
`hooks/radiology-workspace/useWorkspaceExportShare.ts` and `lib/radiologyReportPdfExport.ts`: the two
that #1088 rewrote. **That is the cross-agent collision this directory exists to surface**
(`AGENT_HANDOFF.md` §7, `KNOWN_ISSUES.md` R-18). Resolving it is not documentation work and not this
agent's; the next priority is deciding **who** resolves it.

**The second is Draft #1091 "A restored unsaved draft claimed the radiologist wrote the AI's
sentences"** (`feat/ai-attribution-restore-pr-a`, head `b9d8ef51`, base `dc8c3aba`, 1 commit, **6 files
+816/−12**, opened 2026-10-20 16:07:04Z; `mergeable: true` / `unstable` at 20:55 IST, and
`mergeable: true` / **`clean` with 3/3 check-runs success** at 22:02 IST). It is the
candidate fix for the **Restore-banner attribution defect** (§1.4b, `CLINICAL_SAFETY_REGISTER.md` §0.1
row 8, `KNOWN_ISSUES.md` §5): new `lib/aiAttributionRestore.ts` + `aiAttributionRestore.test.ts` + a
441-line `aiAttributionRestoreJourney.hardening.test.ts`, editing `WorkspaceOverlays.tsx` (+9/−2),
`observationLedger.ts` (+32) and `zai-workspace/store.ts` (+43/−10). **Status discipline:** CI is now
**3/3 green** at its head and the tree reports `clean`, which changes only one thing — the merge is
now a decision the **owner** can make on evidence, not an agent's. It is still **unmerged**, this pass
ran none of its tests, and no browser has seen it, so the finding stays open and this row is a
pointer, not a fix. Measured against #1090 (`git merge-base` = `47b739c8`, `git merge-tree` between the
two heads): they **auto-merge cleanly in `store.ts` and `observationLedger.ts`**, so the three agents
working that one store are not blocked by each other — the only conflicts in that comparison are
#1090's against `main`.

Re-fetch before quoting any of these numbers — `merge_commit_sha` on an open PR is a test-merge
preview, not a merge, and a squash merge usually deletes the branch that produced it; re-pushing a
deleted branch creates a **new** ref, and a merged PR cannot be reopened. Two readings learned this
pass: a **closed** PR returns `mergeable: null` (the field is only computed while open, so null is not
a problem report), and the **list** endpoint omits `additions`/`deletions`/`changed_files`/`mergeable`
entirely, which is why #1090 first appeared as `+undefined/undefined` instead of as a conflict.

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

### 1.4b New open items produced by this pass (2026-10-20; first written against `1c80f2d3`, re-read at
`47b739c8`, and re-read a third time at `dc8c3aba` — three of the bullets below changed status)

* **Structured Findings are outside the dirty-check.** `lib/workspaceReportState.ts:63-71` omits
  `findingsMap` from `serializeReportSnapshot`, on which `isReportDirty` (`:74`) and `BackupEnvelope`
  (`:85`) depend. One field, one function, three protections blind. July's finding C2, still true —
  and **re-verified true at `47b739c8`**, because #1085's diff does not include that file.
  `CLINICAL_SAFETY_REGISTER.md` §7. **This is the #1 code priority.**
* **~~An unsigned report can print "Signed: Dr. …"~~ — CLOSED in merged code by #1088 (2026-10-20,
  15:11:14Z), not deployed.** The finding, as raised at `47b739c8`: `reportPresentation.ts:715-717`
  substituted the static letterhead’s radiologist + credentials when `model.signatures` was empty,
  `patient-reports.ts:3334` produced that empty array for a report with neither `signatureId` nor
  `signedByName`, and `GET /:id/print` was not gated on signed status. #1088 added `signerUnsigned`
  (`reportPresentation.ts:184`), routed **both** doors through one `signatureSlotHtml()` that prints
  `NOT SIGNED` and no name (`:506`), and set the flag from the row on the patient print/PDF door
  (`patient-reports.ts:3482`) and unconditionally on the draft preview (`radiology-report-generator.ts:2451`).
  Decision **D-8 is thereby superseded by the merge** — the owner answered it by shipping #1088, so it
  must not be asked again. What remains: the letterhead default still serves callers that declare
  nothing (`:750`, still asserted as a control at `reportPresentation.test.ts:203/:215`), and **no
  rendered page or PDF has been reviewed by a human** since. `CLINICAL_SAFETY_REGISTER.md` §9.1/9.4.
* **NEW: staff-to-signature authority is a deny-list, not a binding** (OPEN-3, named at `dc8c3aba`).
  `SIGN_DENY_ROLES = {typist, ai, system, bot}` (`radiologyD1FinalWriter.ts:76`) is the only subject
  check on the sign route (`patient-reports.ts:2442-2448`); any active `signatureId` is accepted
  (`:2586-2597`) and its block’s name outranks the session subject (`signedArtifactGuard.ts:165-178`).
  Traceable, not refused. **Owner decision D-10** — and an agent must not tighten it unasked, because a
  1:1 staff↔signature assumption would stop the single-radiologist clinic signing at all.
* **NEW: the local "Unsaved draft found → Restore" banner relabels AI text as human.**
  `workspace/WorkspaceOverlays.tsx:814` calls `setEditorContent` with five text fields and no
  provenance, and `store.ts:1590-1595` stamps every sentence `"manual"` — which four consumers act on
  (protection, one-click-normal seeding, the Mode-A manual hold, and the provenance summary sent into
  the next AI request at `useReportComposer.ts:261-264`). This is the **real** form of gap-register
  finding **G-1**, whose literal wording ("attribution is lost on reload") is refuted: attribution
  persists in the `careObservationLedger` envelope and is asserted at
  `radiologyWorkspaceDraftRoundTrip.request.test.ts:268` (`KNOWN_ISSUES.md` §5). Ownership: the AI
  Architecture Agent (provenance), not this directory. **A candidate fix is now in flight as Draft
  #1091** (§1.1) — unmerged, its Tests job unresolved, and its tests not run by this pass, so the item
  stays open until it merges **and** is reviewed on the real app.
* **NEW: #1090 cannot merge, and the collision is about how an unsigned report looks.** Two files,
  `useWorkspaceExportShare.ts` and `radiologyReportPdfExport.ts`, carry both #1088’s
  `signerOfRecord`/`unsigned`/`SignedReportArtifactRequired` and #1090’s `unsignedDraft`/
  `draftAwarePrintSettings.ts` DRAFT watermark. Whoever resolves it must keep both properties under
  **one** field name. **Owner decision D-12** (who resolves it), measured in `CURRENT_STATE.md` §4.
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
* **One honesty gap in the vision path remains; the other is closed.** **G-16 CLOSED by #1089
  (`dc8c3aba`, 15:11:37Z, not deployed):** `POST …/vision-trial` refuses a picture set that breaks a
  ceiling instead of trimming it (`lib/reportComposer/trialImageSet.ts`, ceilings read from the route’s
  own old numbers), and the 400 carries `suppliedCount`/`droppedIndexes` so the answer can be read
  against the request. The provider’s own `slice(0, 6)` at `deepseekVisionTrial.ts:112` is still there as
  a second ceiling its only caller cannot now exceed — say it that way, not "removed".
  **G-19 STILL OPEN:** `lib/db/src/schema/aiReporting.ts` has **no** truncation columns (`git grep -e
  truncat` → zero), so a truncated answer is diagnosed in the UI and never persisted.
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
suite at **50 tests / 2,281 ms**, 15,427 tests overall), **and 3/3 green again at `dc8c3aba`** (run
`39446153649`, the same suite still **50 tests** — 1,926 ms, step-12 log line 607 — 15,489 tests
overall). Nothing red on `main` at the time of writing.

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

**4b. ~~Stop an unsigned report from printing "Signed: Dr. …".~~ — DONE IN MERGED CODE by #1088
(`37a6758c`, 2026-10-20 15:11:14Z). Kept in place; the reasoning is the asset.**
Rank driver was *patient safety — signature attribution*. The finding, as written at `47b739c8`:
`lib/reportPresentation.ts:715-717` substituted the static letterhead radiologist
(`lib/careLetterheadChrome.ts:24-25`) whenever the renderer was handed no signature, and
`routes/patient-reports.ts:3334` produced exactly that for a report with neither a `signatureId` row nor
a `signedByName`; the surface was `GET /api/patient-reports/:id/print` with no signed-status gate, and
the behaviour was pinned by a test — which is why it was framed as **an owner decision before code**
(D-8) rather than a one-line fix. **What the owner chose instead was to merge #1088**, which answers it
structurally: a `signerUnsigned` declaration on the model, honoured identically by the letter-pad footer
and the plain page through one `signatureSlotHtml()` (`reportPresentation.ts:506`), set from the row on
the print/PDF door (`patient-reports.ts:3482`, `!isSignedArtifact(r)`) and unconditionally on the draft
preview (`radiology-report-generator.ts:2451`). It prints **`NOT SIGNED`** and no name, no credentials,
no image. D-8 is therefore **superseded by the merged implementation** and must not be asked again
(`CLINICAL_SAFETY_REGISTER.md` §9.1, §9.4). **What is NOT done:** nothing in #1085, #1088 or #1089 has
been looked at as a rendered page or a PDF by a human (priority 4c), and the letterhead default still
serves callers that declare nothing (`:750`), so the probe *"is every surface that can reach that
default unreachable by a patient?"* is still open.

**4c. Review #1085 + #1088 + #1089 against rendered output before any further signature work.**
Rank driver: *patient safety — the evidence base, not a new feature*. Three merged print/PDF changes now
sit with CI + unit/request tests and **zero human-reviewed artifacts**; #1088 is the largest clinical
print change in this register's history (20 files, and it changes who a report names).
`pnpm preview:reports` writes print + screen + PDF per case with no server and no deploy; a real print
and a real PDF close the rest. **Never review a print change from the diff** — this repository has
already shipped a print fix that was wrong in the layout and right in the tests
(`KNOWN_ISSUES.md` §4, `print-pdf-audit` lessons).

**4d. Decide who resolves the #1090 collision over "unsigned".**
Rank driver: *clinical workflow reliability*, and it is a coordination decision rather than an
implementation task. `main` (#1088) says a signed report must not be re-rendered from the screen
(`SignedReportArtifactRequired`, `radiologyReportPdfExport.ts:374`, thrown `:391` — **was** `:361`/`:378`
when this row was written; #1090's import and doc block moved them, and the numbers here were re-grepped
at `c199aea2`) and takes the unsigned state
as `signerOfRecord`/`unsigned`/`authorizedReportId`; #1090 (ready, `mergeable: false`, branched at
`47b739c8`) says an unsigned export must carry a `DRAFT` watermark and takes it as `unsignedDraft` +
`lib/draftAwarePrintSettings.ts`. `git merge-tree` conflicts in exactly the two files both changes
touch. **CLOSED — this item is done and must not be re-opened as work:** the owning agent resolved it on
its own branch (merge commit `104d3f48`, unreachable from `main`) and #1090 squash-merged as `ed04acbc` at
17:14:26Z; the composition was measured on `c199aea2`, not assumed, and both properties survive under two
field names with one mirrored source. See `KNOWN_ISSUES.md` R-18 for the evidence and the three residuals
it did **not** close, and `CLINICAL_SAFETY_REGISTER.md` §0.2.1 for PI-1/PI-2/PI-3, which are what this
door still owes. Either resolution risks losing one property: a signed report drawn from browser state, or an
unsigned draft leaving the building un-watermarked. **Owner call: which agent rebases, and under which
single field name both properties survive** (decision **D-12**).

**4e. Decide staff-to-signature authority (OPEN-3, D-10).**
Rank driver: *patient safety — attribution*. `SIGN_DENY_ROLES = {typist, ai, system, bot}`
(`lib/radiologyD1FinalWriter.ts:76`) is the only subject check on `POST /:id/sign`
(`patient-reports.ts:2442-2448`); any **active** `signatureId` is then accepted (`:2586-2597`, and
#1088's new `:2599-2605` refuses only retired ones), and `resolveSignerIdentity()`
(`signedArtifactGuard.ts:165-178`) prefers that block's name over the session subject. So a cashier's
session can record a report as signed by the radiologist whose block it applied — traceable in the audit
(`identitySource`, `rejectedCallerName`), never refused. Not a #1088 regression; the boundary it has
always had. **Must not be tightened by an agent**: a 1:1 staff↔signature binding would stop the
single-radiologist clinic's auto-sign path, which is how it signs today.

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
Rank driver: *maintainability*, but it is also the reason agents keep shipping stale claims.
**Part of this is now done and part of it got worse.** Done: #1087 merged all nine
`docs/project-memory/*` files onto `main` (`8bbac44e`), so the memory set is no longer invisible to an
agent starting from `main`, and `KNOWN_ISSUES.md` §2/§5 now records the disproved claims including the
one this pass made about its own advice. **Worse:** that memory set on `main` cites
`lib/reportSignerSelection.ts` as a recommended fix in five sentences across four files, and **#1088
deleted the module four minutes after the docs merged** — so `main` now carries authoritative-looking
advice that cannot compile. The lesson generalises: a citation of a *file* is more fragile than a
citation of a *line*, and nothing in CI guards this directory. Volumes re-measured at `dc8c3aba`:
`docs/` holds **291 `.md`** among **5,631** files, `Antigravity/` **100** more, **39** markdown files at
the repository root, no root `README.md`, and the local checkout has **102 git worktrees** (was 99;
the count grows roughly one per agent session and nothing prunes it).

**10. Adopt the repository's own verification discipline as a PR gate — starting with this directory.**
Rank driver: *maintainability + trust*. `grounding-check.cjs` already fails the build on 105
architecture claims (`✓ All 105 architecture claims hold against the code.` at `dc8c3aba`, run
`39446153649`); extend the same machine-checked treatment to (a) the retention/egress claims that are
wrong today, and (b) **every `file:line` in `docs/project-memory/`** — the cheapest form being a check
that each cited path still exists, which would have caught the deleted-module row above on the day it
happened. **This pass ran that check as a throwaway and it paid for itself immediately:** it plus a
markdown column/separator check found five defects no read-through had caught — three rows across
`ARCHITECTURE.md`, `COMPLETED_WORK.md` and `AGENT_HANDOFF.md` calling
`artifacts/diagnostic-erp/src/lib/radiologyReportLifecycle.ts` "server-side", one
`KNOWN_ISSUES.md` cell whose two raw `|` characters turned a 4-column row into 6, and one
`AUDIT_RECONCILIATION.md` row wrapped over two lines — all fixed on this branch. So the gate needs
three assertions, not one: the path exists, the **package** matches (both trees have `lib/` and
`routes/`, and `store.ts` / `index.ts` exist in each), and the markdown table is well-formed.
**A fourth assertion was measured into this requirement at `c199aea2`: false-positive control, not the
check itself, is the work.** The pass that added `OWNER_DASHBOARD.md` re-ran both checks over all ten
files and the result was **0 table defects**, 44 "dead path" hits that are every one of them either the
corpus's own bare-path shorthand, a path in *another* repository (`PACS/…`), a module cited *because* it
was deleted, or this directory's own filename — and 20 "unbalanced backtick" hits that are all inline
code wrapped across a line or a fenced block. Two implementation traps surfaced: a column counter that
drops empty cells reports a valid 3-column row as 2 (`OWNER_VISION.md:61`), and `git ls-tree -r` on this
tree emits 2.4 MiB of path names, which silently exceeds `execFileSync`'s 1 MiB default `maxBuffer` — so
the gate must raise it or it dies looking like a clean run. Keep preferring `*.request.test.ts` over source-text greps (`AGENTS.md:34` records a green
grep-test that shipped an HTTP 500 route; #1088 and #1089 each shipped a *deliberate* static guard
(`reportSignerNoNameRule.test.ts`, `reportComposer.visionTrialGate.test.ts`), so the rule needs a
nuance rather than a repetition: a source-text guard is acceptable when it pins a **ratchet** that
behaviour tests cannot see, and it must say so in its own header. And record for every merged clinical PR which of CI / local /
browser / rendered-artifact actually ran; today three print/PDF PRs are merged with CI-only evidence.

### Deliberately not on this list

* **Do not automate NAS failover** — the standby plan says so explicitly
  (`docs/CARE_ERP_SECOND_NAS_DISASTER_RECOVERY.md:355`).
* **Do not re-raise the two owner-accepted risks** (Orthanc auth posture, DICOM replication) — they
  are recorded as accepted decisions, not defects.
* **No `db:push` against any real database**; schema changes go through `migrations/*.sql` and the
  `care-db-patch-v2` → `care-schema-verify` chain.
* **No port 80 assumption on Windows.** The emergency overlay defaults to host 8080 precisely to
  avoid elevation (`deploy/windows-emergency/docker-compose.windows.yml:5,12`).
