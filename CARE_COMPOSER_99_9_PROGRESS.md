# CARE Composer 99.9 — Progress

Branch: `composer/99-9` (this branch)
Reconstruction baseline: `origin/main` @ `47b739c8` (2026-10-20 — includes PRs
#1083, #1084, #1085, #1086)
Reconciled with `origin/main` @ `dc8c3abaf8` (merge `104d3f48` — after #1087,
#1088, #1089 merged; the branch is current, 0 behind)
Original baseline (previous session, lost): `c208cbf`

## ⚠️ Provenance of this branch

The previous session's nine commits (ending `943af596`) were **never pushed**
(push was credential-blocked) and were lost with a container reset. This branch
faithfully REBUILDS that work from the session's worklog evidence (per-commit
file paths, function names, behaviour specs and test designs), re-verified
defect-first against the CURRENT main. Each commit message names the original
SHA it reconstructs. The owner-supplied access token now permits pushing; the
branch is pushed immediately after each stage so the work cannot be lost again.

## BASELINE

- `origin/main` = `47b739c8` at branch start. Changes since `c208cbf`: #1083 (project-memory
  reconstruction docs), #1084 (AI composer state reconstruction docs), #1085
  (print/PDF quality: Doppler emphasis, missing-image notice, harness
  coverage, **signatures from records** — print settings honored as
  configured, server-side `reportSignerSelection`), #1086 (two-model
  comparison socket ordering).
- **MERGED AFTER BRANCH START** (reconciled in `104d3f48`): #1087 (docs),
  **#1088 (signer identity: signer-of-record, unsigned → NOT SIGNED, signed
  reports download their frozen server artifact)**, #1089 (vision trial
  request echo). The one real collision was the PDF export door, where the
  branch's draft safety (eb5ad709) and #1088's signer authority both write.
  The reconciliation keeps BOTH: #1088's authorization-first redirect and
  signer fields untouched (the authority), plus the branch's `unsignedDraft`
  watermark trigger. #1088's suites (lifecycle 26 / signerOfRecord 9 /
  signedArtifact 7) and the branch's (draftPrintSafety 14 / staleAutosaveAck
  14 / composerApplyGate 10) are all green at the merge point; full suite
  7,320 passed / 0 failed.

## COMPLETED (this branch)

| # | Commit | Package | What |
|---|--------|---------|------|
| R1 | `34c1a2d7` | C3/C4 | Same-slot update carries the slot's lineage (the original normal stays restorable through severity/wording chains; intermediate abnormal wording never returns after deselect) and strips the vacated row's advice (no orphan recommendations). 8-case `replacementChainRestoration` suite (5 failing-first) + corrected the #167 lifecycle pin that asserted the old restore-the-abnormal behaviour. |
| R2 | `b7ee10ec` | D-05/F3 | Stale autosave acknowledgement byte-gate: `clinicalTextsPersistedAck`/`evaluateDraftSaveAck` in draftSaveOutcome, wired into the useDraftPersistence ack; `formatHumanSaveStatus` refuses green "Saved" over dirty text; corrected the refusedSave pin that encoded the defect. 14-case `staleAutosaveAck` suite. |
| R3 | `2c915dcd` | F1/D-13/F4 | AI Apply gated on live-store byte equality (`composerApplyGate`) — in-window edits and cross-study content can no longer be overwritten; thrown persist/confirm exceptions roll back via `undoLastPatch` with a notice. 10-case `composerApplyGate` suite. |
| R4 | `eb5ad709` | D-06/D-22 | Unsigned exports carry a DRAFT watermark (`draftAwarePrintSettings`, watermark-only — signature authority left to #1085/#1088, composable with both); print saves first and a failed save aborts the print. 14-case `draftPrintSafety` suite with instrumented jsPDF. |
| R5 | `83aea989` | D-26/D-27 | Hemorrhage denial pair lint added to `BRAIN_CONTRADICTION_RULES` (the one falsifiable brain family without one); laterality deselect boundary contract pinned on the real side-parameterised tile (6 cases, all passing at baseline). |
| R6 | `994a9f27` | Part 12 | Permanent clinical acceptance corpus (REQUIRED + FORBIDDEN): normal brain, infarct, hemorrhage, multiple abnormalities, cervical disc-osteophyte family, two-level lumbar bulge, stenosis + ligamentum flavum, bilateral findings, normal→abnormal→normal restoration, Part 7's five mandatory cases. |
| R7 | `1360e90a` | **The facet contradiction (fixed)** | The study-wide escape in `sentenceOwnedBySlot`'s level gate is now region-aware (`isStudyWideClaimForLevel`): the observation's OWN region word ("Lumbar" in "Lumbar facet joints are unremarkable.") is anatomy wording, not a site pin, so "Facet arthropathy at L4-L5." retires it instead of printing beside it. Foreign region words still pin (a lumbar tile never takes a cervical/sacral sentence); the concept gate is untouched; lumbosacral/sacral/junction words stay conservative pins. Shared-claim lineage added to `applyPathologyOverlay` so a second facet level carries the same claim and the shared normal returns whichever order the tiles are deselected in (the normalSuppression "two abnormalities, one normal" contract, walk-derived half). The `it.fails` pin converts to a passing regression; corpus grows the shipped-tile facet battery (deselect/recompose restore, LF + disc + canal combinations, selection-order equivalence, manual text before/after, hand-edited normal ask-then-restore, re-click idempotence, analogous baselines: spondylolisthesis, compression fracture, LF). New `facetStudyWideRetirement.test.ts` (15 cases): predicate matrix (levels, laterality, foreign-region refusals, bucket levels, conservative pins, falsifies oracle) + the journeys the shipped catalogue has one tile for (L5-S1, two-level last-out in BOTH deselect orders, bilateral pair, severity chain restoring the original normal, recompose stability). |
| R8 | `09ca6993` | **R5 ventricles regression (fixed)** | Reconstruction regression found and fixed: C3's own-wording filter (`34c1a2d7`) counted a NORMAL tile's own sentence as already-said (its role exemption covered only `role === "baseline"` rows), so Normal-ventricles → Hydrocephalus lost the ventricles claim and deselection restored nothing (`observationOwnership.matrix.test.ts` R5 — passing on main, failing on every commit of the reconstructed branch; the reconstruction's "full suite green" claim was wrong on this one case). The filter now exempts sentences that assert normality — its job (never resurrect intermediate ABNORMAL wording) is unchanged, `replacementChainRestoration` 8/8. |

## VALIDATION (at branch tip `104d3f48`, post-merge with `dc8c3abaf8`)

- **Full diagnostic-ERP suite**: **7,320 passed / 0 failed / 1 skipped**
  (the pre-existing `anatomyMetadataReport` skip). Includes the acceptance
  corpus (27/27), the acceptance journeys (13/13), the facet engine suite
  (15/15), replacementChainRestoration (8/8), the ownership matrix (8/8),
  #1088's signer suites and every other suite in scope. Pre-merge counts at
  `06befc27`: 7,273 / 0 / 1.
- **Non-DB `lib/` packages**: 959 passed; 1 failure is `phiImageCloudGuard`
  (needs a live PostgreSQL — environmental).
- **scripts/**: 790 passed / 2 skipped; **bridge-service**: 6 passed.
- **TypeScript**: every package + libs + scripts typechecks clean (api-server
  needs a sequential run with a raised heap on a 2-vCPU container; parallel
  `pnpm typecheck` is OOM-killed at 137 — environmental, not a code error).
- **Grounding**: 105/105 architecture claims hold.
- **UNVERIFIED in this container (environmental)**: browser/Playwright specs,
  all `.request/.db/.integration` suites that need PostgreSQL (ECONNREFUSED
  :5432), the DB save/reopen round-trip and cross-workstation printing. Nothing
  in this branch is verified in a browser or against a database; those claims
  are NOT made.

## KNOWN DEFECTS

1. **Client PDF export on a signed study — CLOSED by merged #1088** — the door
   now redirects a signed report to its frozen server artifact
   (`SignedReportArtifactRequired`), exactly the authority the branch left to
   it. The branch's DRAFT watermark remains for what it owns: unauthorized
   documents (drafts, unsigned rows) rendered from the screen.
2. **falsifies over-suppresses a level-less claim across regions** — a live
   cervical facet observation keeps the lumbar study-wide facet normal
   suppressed until it too is deselected (the shipped oracle's documented
   safe-direction choice; pinned explicitly in
   `facetStudyWideRetirement.test.ts` so a change to either half is a
   conscious one).

## NEXT

1. ~~Phase 1: facet fix + regression battery~~ — DONE (`1360e90a`).
2. ~~Revalidate the reconstructed fixes~~ — DONE (full suite green; the R5
   ventricles regression the reconstruction introduced is found and fixed,
   `09ca6993`).
3. Review: draft PR from `composer/99-9` → `main` (9 commits, no conflicts with
   open PRs — zero file overlap with #1087/#1088/#1089).
4. Later phases (not this PR): the remaining workflow-hardening backlog below.

## Deployment status

PRODUCTION DEPLOYMENT: NOT PERFORMED. DATABASE MIGRATIONS: NOT PERFORMED.
MERGE: NOT PERFORMED. Clinical feature flags untouched. No production,
emergency-ERP or Synology access of any kind.
