# Quick Select Catalogue — Status on 2026-10-19 (PR #1077 review cycle)

> **Update 2026-10-20 — PR #1077 final corrections round:** the cervical
> lordosis ruling is extended to the cervical tile (§5), the CT PNS / MR Pelvis /
> MR Shoulder normals now ship (§2), and the seed grew a fourth rule — RESYNC —
> so a clinic-customized box's "Restore defaults" always restores the CURRENT
> shipped wording, with the per-box badge and restore button now visible in both
> the Settings page and the workspace editor (§1).

This document records, accurately and without proposal inflation, what the
clinical catalogue IS today, what is wired, what is dormant, and which decisions
are the owner's. It is Task G of the usability-first mission: documentation
only. No Stage D–J implementation is started here, no Tile Studio is built, and
the working Quick Select catalogue is not migrated.

## 1. What the radiologist actually uses today (wired, tested)

**The Quick Select strip** (`radiology_quick_findings`, seeded by the factory
generator `scripts/src/generate-quick-select-factory-boxes.ts`):

- 128 shipped boxes in `quick-select-tiles.data.ts`, one concept per box,
  scoped by modality + body part. Clicking a box writes its finding through the
  observation ledger — the same engine a deselect, a save and a reload read
  back.
- The SQL seed is DERIVED from the TypeScript catalogue (r001–r004 in
  `migrations/`), so the two cannot fork. Each revision is a full idempotent
  snapshot; the db-patch container applies each exactly once, in revision
  order.
- Four rules protect the clinic's own words, in order:
  1. **ADOPT** — a clinic row with the same (region, label) as a shipped box is
     stamped with the factory identity, not duplicated.
  2. **RESYNC** — a customized row's factory snapshot is re-converged to the
     newest revision on every deploy. The clinic's wording is untouched; only
     the restore target moves. Without this rule, "Restore defaults" on a box
     customized before a catalogue update would resurrect the STALE shipped
     wording — the one-press adoption path would deliver yesterday's
     correction instead of today's.
  3. **A CLINIC EDIT NEVER DIES** — if the clinic's wording differs from the
     shipped wording the row is marked `customized_at` and NO later deploy ever
     overwrites it. The box badges "Your version".
  4. **REFRESH ONLY UNTOUCHED ROWS** — a stamped, never-edited row is refreshed
     to the newest shipped wording on deploy.
- **Restore defaults** (one press, per box, doctor-facing) adopts the shipped
  wording AND the shipped clinical metadata (concept, conflict group, baseline
  declaration) from the stamped factory definition — and, since the RESYNC
  rule, that definition is always the CURRENT revision. Since this round the
  action is VISIBLE where it was only an API: every box in the Quick Select
  Settings page and the workspace's own editor badges **Built-in** /
  **Your version** / **Your box**, and a "Your version" box shows its restore
  button next to the badge.

**Consequence measured during this review cycle (2026-10-19):** the clinic's
own "Loss of lumbar lordosis" box predates the ownership catalogue — it carries
the old Multilevel-Degenerative wording (with the muscular-spasm attribution
the owner has now removed from the shipped copy) and NO alignment concept, so
clicking it cannot retire the baseline normal and the workspace raises a
confirmation instead. Rule 2 correctly protects that row. The corrected
shipped tile reaches the clinic only through **Restore defaults** on that box —
the owner's press, the owner's decision. The browser journey
(`tests/e2e/composer-journey.spec.ts`) walks exactly this path.

**The TypeScript normal baselines** (`baselineManifest` on each report format):
per-sentence ownership declarations that let a click retire exactly the normal
it contradicts, and nothing else. These are active machinery, exercised by
every click-order and acceptance test.

**The observation ledger** (Stage C): active and load-bearing. Every click,
deselect, recompose, save and reload goes through it.

## 2. Automatic normal-first coverage (measured, not claimed)

`normalBootstrapCoverage.test.ts` pins the honest table — the examinations
that OPEN with a complete normal report, proven against the real resolver and
the real shipped library:

| Examination | Auto-opens with |
|---|---|
| MRI Brain (plain / contrast / epilepsy) | the corresponding owned normal |
| MRI Cervical / Dorsal / LS Spine | standard normal (+ screening variants) |
| MRI Whole Spine | screening normal |
| MRI Knee | standard normal |
| MRI Pelvis, MRI Shoulder | standard normal (owned baselines, final corrections round) |
| CT Brain, CT Chest | normal |
| CT PNS | normal (format-only, final corrections round) |
| XR LS Spine | normal |

The three gaps this review cycle measured — CT PNS, MR Pelvis, MR Shoulder —
were closed in the final corrections round on the owner's instruction: complete
normals now ship in the library (MR Pelvis and MR Shoulder as owned baselines
whose hip / rotator-cuff rows carry the concepts their tiles contradict; CT PNS
format-only, the CT Brain — Normal shape). Their wording is proposed clinical
content for radiologist review, the posture the cervical Quick Select catalogue
carries. No tile-supported examination is left without a shipped normal.

Never auto-bootstraps, by design (`normalBootstrap.ts` rule 1): **MG**
(mammography is not used at this clinic), **US** (its own companion flow).

## 3. Dormant catalogue infrastructure (deliberately not wired)

- **Stage B's 12 catalogue tables** — present, unused by the deterministic
  path. Future infrastructure.
- **`impressionRuleEngine.ts`** (api-server) — a pure rule evaluator with
  tests, no runtime callers, no UI exposure, self-documented as "Not wired
  into any production report path". Nothing misleading reaches the
  radiologist; it stays as future infrastructure.
- **Stage D–J (v4 catalogue, Tile Studio, publication versioning)** — not
  started. The acceptance spec's T3/T8/T10/T19 cases honestly name the v4
  features they would need.

## 4. The one misleading control — and why it is not hidden here

`report_composer_auto_compose` is stored by the AI Reporting settings page and
read by nothing on main: the Ollama background composer gates on
`reportComposerBackgroundEnabled` instead. The toggle is therefore misleading
today — but its home (`AiReportingSettings.tsx`) is being actively modified by
the parallel AI-security workstream (PR #1076 branch), and the deterministic
Composer mission must not touch that surface. The fix (hide the checkbox, or
wire the flag into the background job) is the AI workstream owner's call.
Recorded here so it cannot be forgotten; deliberately not changed.

## 5. Known limitations recorded for the owner

- **Sequence-only click-order differences**: 52 of 406 tile pairs print the
  same sentences in a different line order depending on click sequence
  (ceiling documented in `quickSelectClickOrderCensus.test.ts`; the seven
  content-different pairs are retired and pinned by name). The owner's review
  asked for these to be REVIEWED rather than ratcheted away, with anatomical
  organization prioritised and harmless formatting left alone. Measured
  verdict: after this cycle's two fixes, **every one of the 52 is the harmless
  kind** — a 2–3 line swap of adjacent contributions at the position they
  share, in click order (31 pairs move 2 lines, 21 move 3, none moves more).
  The two that were NOT harmless are fixed and pinned by name:
  - a deselected tile's restored normal printed at the report tail after one
    automatic pass (the canvas-baseline stamp) — now it rejoins its level
    block;
  - two shared-baseline pairs ("Fazekas 1" <> "Lacunar infarcts", "Fazekas 1"
    <> "Cerebral edema") printed the second click's finding at the END of the
    report — now it prints beside the sibling that owns the shared slot.
- **X-ray contradiction lints** (`xrayCervicalContradictions.ts`,
  `xrayLsContradictions.ts`) carry the same bare-word abnormal regexes the MRI
  spine lint carried before this cycle's fix (a negated finding could read as
  an abnormality). No false positive was measured on this cycle's journeys, so
  they were left untouched; the same two-guard fix applies when one is.
- **The cervical lordosis tile** carried the pre-shipped "? due to spasm"
  wording (from #824, before this branch). **Resolved in the final
  corrections round:** the owner extended the lumbar ruling to the cervical
  tile — the sentence is now "Straightening/loss of normal cervical lordosis.",
  the routine NSAIDs/physiotherapy recommendation is gone (the Recommendation
  field stays the doctor's to write), and an impression sentence is pinned
  ("Loss of cervical lordosis.", which the tile previously lacked). The
  shipped Report FORMAT "MRI Cervical Spine — Loss of Lordosis" still carries
  its own "likely due to muscle spasm" findings sentence — formats are
  radiologist-owned content applied from the Templates screen, and the ruling
  named the tile; retiring that format's spasm wording is a separate owner
  decision, recorded here.
- **Mammography journeys** apply their format manually by design (MG is
  outside the bootstrap whitelist); the acceptance journeys declare this
  rather than claiming automatic coverage.
