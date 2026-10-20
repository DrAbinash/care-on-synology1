# CARE Composer 99.9 — Progress

Branch: `composer/99-9` (this branch)
Reconstruction baseline: `origin/main` @ `47b739c8` (2026-10-20 — includes PRs
#1083, #1084, #1085, #1086; PRs #1087/#1088/#1089 are OPEN, not merged)
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

- `origin/main` = `47b739c8`. Changes since `c208cbf`: #1083 (project-memory
  reconstruction docs), #1084 (AI composer state reconstruction docs), #1085
  (print/PDF quality: Doppler emphasis, missing-image notice, harness
  coverage, **signatures from records** — print settings honored as
  configured, server-side `reportSignerSelection`), #1086 (two-model
  comparison socket ordering).
- Open PRs #1087/#1088/#1089 are NOT merged; #1088 (`fix/signer-identity-
  consistency`) owns signer identity / PDF authorization (signer-of-record,
  `unsigned` → NOT SIGNED). **This branch deliberately does not duplicate that
  system** (see D-06 below).

## COMPLETED (this branch)

| # | Commit | Package | What |
|---|--------|---------|------|
| R1 | `34c1a2d7` | C3/C4 | Same-slot update carries the slot's lineage (the original normal stays restorable through severity/wording chains; intermediate abnormal wording never returns after deselect) and strips the vacated row's advice (no orphan recommendations). 8-case `replacementChainRestoration` suite (5 failing-first) + corrected the #167 lifecycle pin that asserted the old restore-the-abnormal behaviour. |
| R2 | `b7ee10ec` | D-05/F3 | Stale autosave acknowledgement byte-gate: `clinicalTextsPersistedAck`/`evaluateDraftSaveAck` in draftSaveOutcome, wired into the useDraftPersistence ack; `formatHumanSaveStatus` refuses green "Saved" over dirty text; corrected the refusedSave pin that encoded the defect. 14-case `staleAutosaveAck` suite. |
| R3 | `2c915dcd` | F1/D-13/F4 | AI Apply gated on live-store byte equality (`composerApplyGate`) — in-window edits and cross-study content can no longer be overwritten; thrown persist/confirm exceptions roll back via `undoLastPatch` with a notice. 10-case `composerApplyGate` suite. |
| R4 | `eb5ad709` | D-06/D-22 | Unsigned exports carry a DRAFT watermark (`draftAwarePrintSettings`, watermark-only — signature authority left to #1085/#1088, composable with both); print saves first and a failed save aborts the print. 14-case `draftPrintSafety` suite with instrumented jsPDF. |
| R5 | `83aea989` | D-26/D-27 | Hemorrhage denial pair lint added to `BRAIN_CONTRADICTION_RULES` (the one falsifiable brain family without one); laterality deselect boundary contract pinned on the real side-parameterised tile (6 cases, all passing at baseline). |
| R6 | `994a9f27` | Part 12 | Permanent clinical acceptance corpus (REQUIRED + FORBIDDEN): normal brain, infarct, hemorrhage, multiple abnormalities, cervical disc-osteophyte family, two-level lumbar bulge, stenosis + ligamentum flavum, bilateral findings, normal→abnormal→normal restoration, Part 7's five mandatory cases, and the KNOWN FACET DEFECT pinned as `it.fails` with full inline diagnosis. |

## IN PROGRESS

- **Phase 1 — the facet contradiction fix.** The `it.fails` pin in
  `clinicalAcceptanceCorpus.test.ts` holds the full diagnosis: the shipped
  "Facet arthropathy L4-L5" tile does not retire its own study-wide baseline
  normal ("Lumbar facet joints are unremarkable.") because (a)
  `observationsMutuallyExclusive` requires exact level equality and (b)
  `isStudyWideClaim` counts the observation's own region word ("Lumbar") as a
  site pin. Fix planned in `observationSlot.ts` (smallest correct change: the
  study-wide escape must not count a mention of the observation's own region),
  then the pin converts to a passing test with the ten mandatory regression
  cases + analogous baselines (ligamentum flavum, spondylolisthesis,
  compression fracture).

## BLOCKED / NOT PERFORMED

- **Mounted React-hook tests**: this repo has no DOM/React harness
  (`environment: "node"` repo-wide, no jsdom, no @testing-library — the
  limitation `refusedSaveIsNotAFailedSave.test.ts` documents). Phase 2's
  workflow is therefore driven at the store boundary with the real predicates
  executed (the same idiom), and the remaining gap is stated plainly: the
  browser-only wiring (window.open popup flow, toast rendering, React effect
  scheduling) is source-contract-pinned, not browser-verified.
- **Browser/database verification**: no PostgreSQL and no browser in this
  container. All DB-gated request suites (104 files) and Playwright specs are
  untouched; nothing in this branch requires a migration.

## KNOWN DEFECTS (open on this branch)

1. **Facet contradiction** — pinned, diagnosed, fix in progress (above).
2. **Client PDF export signer identity on a signed study** — door 2
   (Download PDF) still prints this browser's configured signature block; the
   signer-of-record fix is owned by open PR #1088 and is deliberately NOT
   duplicated here. This branch composes with it (DRAFT watermark for
   unsigned, unchanged signature block).

## NEXT

1. Phase 1: facet fix + 10 mandatory regression cases + analogous baselines.
2. Phase 2: mounted-workflow verification suites (A–J) at the store boundary.
3. Phase 3: signed-report safety tests (workstation A/B, five signing states).
4. Phase 4: corpus extension to the full owner list.
5. Phase 5: full-suite + typecheck validation with exact counts.
6. Phase 6: delivery report + draft PR (no merge, no deploy, no flags, no
   schema changes).

## Deployment status

PRODUCTION DEPLOYMENT: NOT PERFORMED. DATABASE MIGRATIONS: NOT PERFORMED.
MERGE: NOT PERFORMED. Clinical feature flags untouched. No production,
emergency-ERP or Synology access of any kind.
