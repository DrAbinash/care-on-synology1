# Spinal canal AP diameter — where it is, why it could not be found, and what is actually broken

**Measured 2026-10-17** on `audit/canal-ap-discoverability` at `877701f9` (tree-identical to
`origin/main`), in the real React app on Chromium (Playwright, `127.0.0.1:5173`), against the scratch
PostgreSQL on `127.0.0.1:5445`, plus the repo's own request-level tests at this commit.
Audit only: **no clinical code was changed**, nothing was merged, deployed, signed or finalized.

**Status after this audit (same day).** §10 is now implemented on
`clinical/canal-ap-one-authority` — one builder folds both stores with the canonical record as the
authority, all three signed paths carry the table, and the four grids mount once on the Measure tab.
Read the sections below as the measured *as-was* state; the current status and the four decisions still
outstanding (including one this audit did not anticipate: a Dorso-Lumbar study prints only its
most-filled segment, so a measured dorsal level can be absent) are in
`docs/engineering/RIS-PACS-INTEGRATION-TODO.md` §RIS-013.

---

## 1. Answer in plain language

The measurement interface **exists and works**. It was not missing — it was in the wrong place, and the
place it is in does not print.

A radiologist can type the canal AP diameter at every disc level, it survives saving, closing,
switching studies and coming back. But the table that appears on the printed report is built from a
**different store**, and nothing copies one to the other. In one study, in one workspace, at the same
moment, the two CARE surfaces showed **L4-L5 = 8.5 mm** (the grid under *Reporting Tools → Structure*)
and **L4-L5 = 7.2 mm** (the box under *Reporting Tools → AI → Measure*). Both are real. Only the
second one reaches the paper.

So the owner's complaint — "I cannot find the measurement interface" — has two true answers:
1. **Findability:** the entry grid lives under the tab named *Structure*, not under *Measure*, and the
   one box that prints lives two levels deep inside the *AI* tab.
2. **A real defect behind it:** even after finding the grid, the numbers typed there do not appear in
   the printed canal table unless the radiologist separately presses **Generate Professional Report**,
   which inserts them as prose.

---

## 2. Where it is, exactly (measured, not inferred)

Paths below were clicked in Chromium; the counts are elements with a real on-screen box.

| Examination (synthetic MR study) | Report body | Tools → **Structure** | Tools → **Measure** | Tools → **AI** → *Measure* stage |
|---|---|---|---|---|
| MRI LS Spine | none | **Lumbar grid, 5 rows** L1-L2 … L5-S1 | **same Lumbar grid again** | **Canal AP box, 5 rows** + Pull / Refresh-from-viewer / Save / Insert-into-findings |
| MRI Cervical Spine | none | **Cervical grid, 6 rows** C2-C3 … C7-T1 (no C1-C2: no disc there) | none | not measured (the box resolves its segment from the region; only the LS study's box was opened) |
| MRI Dorsal Spine | none | **Dorsal grid, 11 rows** D1-D2 … D11-D12 (D12-L1 appears only when the conus is in coverage) | none | — |
| MRI Dorso-Lumbar | none | inconclusive — see §7 | inconclusive | inconclusive |
| MRI Whole Spine | none | none — **by design** (`seg === "whole"` returns false in all three gates) | none | — |
| MRI Lumbar Spine + Screening | none | inconclusive — see §7 | inconclusive | inconclusive |

Tables are **not** identical across examinations, and should not be: each row list comes from the one
shared vocabulary (`lib/measurements/src/spineCanal.ts:20-49`) — lumbar 5, cervical 6 starting at C2-C3,
dorsal 11 plus a junction row that only appears with thoracolumbar coverage.

### Click paths, stated as the radiologist performs them

1. **Type a measurement (the one that persists in the draft):** open the study → the right-hand
   **Reporting Tools** panel is open by default (it collapses to a vertical "Tools" strip — click it) →
   tab **"Structure"** (`reporting-tools-tab-structured`, the second icon row, labelled *Structure*) →
   scroll past the level canvas → box headed **"Lumbar Canal AP Diameter"**, caption `mm · Tab/Enter →
   next`. Tab order walks L1-L2 → L5-S1. Nothing else to press; the value is marked dirty and autosaves.
2. **Put the numbers into the report text:** same panel → the **"Generate Professional Report"** button
   in the report body → the measurement block is merged into Findings
   (`store.ts:1985-1989`, prose built at `professionalReport.ts:259-277`).
3. **The box whose numbers actually print today:** Reporting Tools → tab **"AI"** → in the Copilot rail's
   stage strip click **"Measure"** (the third chip: Orient · Observe · **Measure** · Conclude · Verify) →
   the **"Canal AP"** table with a **Save** button (`copilot-rail.tsx:66`, `SpineCanalApBox`). This is the
   only SPA surface that writes the server table, and the only one with viewer *Pull* / *Refresh*.

Nothing in the report body links to any of this, and the grid in (1) has no *Save*, no *Pull* and no
*Insert into findings* — only a small dashed preview block under it
(`SpineApCanalMeasurements.tsx:129-135`).

---

## 3. The trace, stage by stage (Phase 1)

| # | Stage | Verdict | Evidence |
|---|---|---|---|
| 1 | OHIF caliper created in the viewer | IMPLEMENTED, **NOT VERIFIED LIVE** | no PACS/OHIF reachable from this box; browser leg NOT RUN |
| 2 | viewer → CARE `viewer_measurements` rows | IMPLEMENTED + CONNECTED | `useOhifViewerBridge.ts:171-252` (hydration vs `new_event` split) |
| 3 | measurement → **explicit anatomical level** | IMPLEMENTED but **on one surface only** | arming + `pickEligibleCanalCaptureRow` live in `SpineCanalApBox.tsx:101-188`; `recordCanalApViewerValue` has **no other call site in the app** (exhaustive grep) |
| 4 | annotation provenance (study/series/image/frame/annotation) | IMPLEMENTED + TESTED | `CanalApMeasurement` (`lib/measurements/src/spineCanal.ts:131-140`), `spineCanalAp.test.ts` 11/11 |
| 5 | CARE canonical record (draft) | IMPLEMENTED + CONNECTED + VISIBLE + TESTED | `store.ts:3210-3233`, `canalApDerivation.test.ts` 20/20 |
| 6 | Reporting Workspace display | VISIBLE (per §2) but **split across three surfaces** | browser census `tmp/canal/census.json` |
| 7 | Observation ledger | **NOT APPLICABLE by design** — measurements are deliberately kept out of slot/concept/laterality identity | `SpineApCanalMeasurements.tsx:14-17` |
| 8 | AI Composer | CONNECTED **by prose only** — see §8 | `buildRadiologistDraftContext.ts:61` |
| 9 | Draft persistence | IMPLEMENTED + CONNECTED + **BROWSER-PROVEN** | `useDraftPersistence.ts:502` / `:301-306`; §4 below |
| 10 | Preview (draft print) | IMPLEMENTED + TESTED — reads **`spinal_measurements` only** | `radiology-report-generator.ts:2351-2354`; 7 request tests green |
| 11 | Signed report + PDF | IMPLEMENTED + TESTED — reads **`spinal_measurements` only**, frozen into `patient_reports.body` at signing | `patient-reports.ts:2238-2244, :2260`; 6 request tests green |
| — | Deployed at the clinic | **NO** — nothing is deployed until `deploy-synology.sh` runs | — |

**Code presence vs functional integration:** rows 5 and 9 are genuinely wired; rows 3 and 10/11 are wired
to *each other* through a table the reachable grid never writes. That gap is the finding.

---

## 4. What is verifiably working (measured, so it does not get "fixed")

* **Manual entry survives everything asked for.** Typed 11.5 at L2-L3 (plus 8.5/9.1 already in the
  draft), saved, opened a *different* patient's cervical study, came back: all three values still shown;
  L1-L2 and L3-L4 still **empty** — no zeros, no "normal", nothing invented. Cervical C3-C4 typed 14.2
  survived the same round trip. (`tmp/pw-canal-persist.mjs`, `tmp/shots/phase3-switch-return.png`)
* **No cross-study leakage:** the lumbar grid is absent on the cervical study, and the cervical grid
  started empty; no value carried over.
* **Store-level rules are pinned:** one manual writer, one viewer writer, a signed report refuses both,
  `T8-T9` and `D8-D9` cannot both exist, blank means unmeasured
  (`canalApDerivation.test.ts`, `spineCanalAp.test.ts` — 31 tests green).
* **The signed surface does carry the table** — between Findings and Impression, into the artifact the
  PDF/email/PACS-archive render from, frozen so a later measurement cannot rewrite a signed document,
  never printed twice, and resolving rows stored under the **worklist row id** as well as the billed id
  (`signedReportCanalMeasurements.request.test.ts` 6/6 and
  `radiologyReportPrint.canalMeasurements.request.test.ts` 7/7 against real PostgreSQL at `877701f9`).
  This holds on the **legacy finalize path only** — see §6.1 for the structured and amendment paths.
  The signed **PDF itself in a browser was NOT re-run** here.
* **Screening and whole-spine deliberately suppress the detailed level canvases**
  (`mriLumbarRegions.ts:305-307`, `mriSpineCanvasRegions.ts:228-229, :271-272`).

---

## 5. Root cause of "not discoverable"

Three independent reasons, in order of how much they cost the user:

1. **The report-body mounts are structurally dead.** `ReportCanvas.tsx:1047` opens `{false && (` and the
   guard closes at **line 1436** (brace/paren depth, verified by script: `tmp/jsx-span.mjs`). Everything
   inside — the lumbar/cervical/dorsal canvases, `SpineApCanalMeasurements` at `:1171` and `:1235`, the
   brain palette at `:1083` and the brain measures strip at `:1089`, and the Findings anatomy strip —
   is retired. The comment at `:1044-1046` says this is deliberate ("visually retired … live only under
   the single Reporting Tools surface"). So the body shows no measurements at all, which the browser
   census confirms for every examination.
2. **Two documents still tell the reader the opposite.** `ReportingToolsRail.tsx:697-700` states that
   brain palette and measures "render in the report body (ReportCanvas.tsx)" — they do not, they are
   inside the dead block. And `mriBrainCanvasPlacement.test.ts` exists specifically to stop brain
   reporting becoming "undiscoverable", asserting by **source text** that `MriBrainCanvas` and
   `BrainMeasuresStrip` mount in the report body. It passes. A grep cannot see `{false && (`: the test
   is green over UI that renders **zero** elements. In the live app for a synthetic MRI Brain,
   `mri-brain-canvas`, `brain-measures-strip`, `brain-palette-bar` were **0 in the body and 0 in all
   seven rail tabs** (`tmp/pw-brain-reach.mjs`) — flagged for the owner, not fixed here, because
   re-lighting a retired surface is a workflow decision.
3. **Naming.** The section is labelled *Structure*, and the tab labelled *Measure* holds images plus
   (only for lumbar) a duplicate of the same grid. A radiologist hunting for "canal AP" clicks *Measure*
   and, for a cervical or dorsal study, finds nothing.

---

## 6. The real defect: two measurement authorities

```
Reporting Tools → Structure → "Lumbar Canal AP Diameter"   (SpineApCanalMeasurements)
      └─ store.canalApProvenance  ─→ draft structured_json.careCanalApProvenance
                                      └─→ "Generate Professional Report" prose  ─→ Findings text

Reporting Tools → AI → Measure → "Canal AP"  (SpineCanalApBox, has the Save button)
      └─ POST /api/radiology/report-generator/spinal-measurements  ─→ spinal_measurements table
                                      └─→ draft print-preview ─→ signed body ─→ PDF / email / PACS archive
                                      └─→ the workspace's own "Download PDF" (useWorkspaceExportShare.ts:289-308)
```

Nothing transfers between the two branches. Exhaustive greps at this commit:
`spinalMeasurementsTable` inserts/updates exist only in `radiology-report-generator.ts:4015, :4038`;
their only clients are `SpineCanalApBox.saveAll()` (`:252-275`) and the retired
`components/SpinalMeasurementPanel.tsx` on `pages/RadiologyReportGenerator.tsx:1903`.
`recordCanalApViewerValue` is called only from `SpineCanalApBox`. The reachable grid calls only
`recordCanalApManualValue`.

Measured consequence in one study (`tmp/pw-canal-ab.mjs`, `tmp/canal/ab.json`):

| Step | Grid (Structure tab) | Canal AP box (AI tab) | `spinal_measurements` | draft envelope |
|---|---|---|---|---|
| type 8.5 / 9.1, Save Draft | 8.5 / 9.1 | — | **no rows** | `L4-L5 8.5`, `L5-S1 9.1` |
| reload the study | 8.5 / 9.1 restored | — | no rows | restored |
| press Generate Professional Report | 8.5 / 9.1 | — | no rows | prose table appears in Findings |
| POST 7.2 the way the AI box does | **still 8.5** | **7.2** | 1 row | unchanged |

Why this stayed invisible: both print tests seed `spinal_measurements` **directly**
(`radiologyReportPrint…:144`, `signedReport…:150`) instead of going through the workspace. So the print
half is tested, the entry half is tested, and the join between them is not tested because it does not
exist. `TESTED ≠ CONNECTED`.

**Answer to the owner's Phase-4 question:** the viewer and the Reporting Workspace do **not** share one
measurement authority today; they hold two unrelated copies. The existing system to reuse is the
canonical record `@workspace/measurements` already declares — whose own header states the rule that was
broken: *"A derived projection (print, ledger, Composer) reads the canonical record. Nothing writes back
into it."* (`lib/measurements/src/spineCanal.ts:12-15`). No third store should be created.

---

## 6.1 A second gap, inside the printed store itself

Even a measurement that *is* in `spinal_measurements` prints on only **one** of the three signed paths:

| Signed path | Body written by | Canal table |
|---|---|---|
| legacy finalize (`patient-reports.ts:2260`) | `insertCanalTableIntoBody(b.body, canalTableHtml)` at `:2238-2244` | **present** — 6 request tests |
| structured finalize `ff_radiology_structured_final` (`:1165`) | `body: prepared.renderedBody`, composed in `lib/radiologyD1FinalWriter.ts:345` | **absent** — no splice, no test names it |
| amendment `POST /:id/amend` (`:1822`) | `body: prepared.renderedBody` from `lib/radiologyD1AmendmentWriter.ts:267` | **absent** — so an amendment can *drop* a table the original carried |

The flag defaults `false` (`lib/radiologyFeatureFlagRegistry.ts:55-56`), so the clinic is on the splicing
path today; the exposure is when it is enabled and on every correction of a spine report that has canal
measurements. Verified by grep: `insertCanalTableIntoBody` has exactly one call site in the whole server.

## 7. Not established

* **Dorso-Lumbar, Whole-Spine-Screening and Lumbar-Screening fixtures were inconclusive.** My synthetic
  rows (`study_description` "MRI Dorso Lumbar Spine" / "MRI Lumbar Spine Screening") resolved **no report
  format at all** — the rail printed *"No report format matched this study"* and no spine canvas of any
  kind rendered (`tmp/canal/census.json`, `tmp/shots/census-dl-structured.png`). That is a fixture/booking
  artifact I could not separate from a product gap, so **no availability claim is made for these three.**
  Re-measure against a study booked under the clinic's real test names (e.g. `MRI020 / MRI DL SPINE`)
  before believing anything about DL or screening.
* **OHIF end-to-end was NOT RUN** — no Orthanc/OHIF reachable from this machine, so no real caliper, no
  real annotation id, no viewer→level capture proof. The code path is IMPLEMENTED (§3 rows 2-4).
* **Signed PDF in a browser was NOT RUN.** It is covered by 6 request-level tests at this commit, which
  is server-level evidence about the body the PDF renders, not a rendered page. Stated as such.
* **Live dev-server caveat, important for honesty:** the API answering `:8080` is a bundled
  `dist/index.mjs` built **2026-10-16 05:31**, while the canal-print commits (`e6f508da`, PR #1038) landed
  **19:34** the same day. My §6 "preview shows no table" observation therefore reflects a **stale bundle**
  and is not attributable to current `main`; the 13 request tests above are the authoritative print
  evidence. Three API processes and another Vite (`vite.canal-acceptance.config.ts` on `:5177`, a file
  absent from this worktree) are running from somewhere else — another agent is working on this feature
  area right now. **Nothing was restarted.**
* Related open item from another agent, not mine to resolve: Draft **#1049** rewrites Quick Select
  authoring; my held DEF-3 commit `3b111ae2` stays unpushed until the owner rules.

---

## 8. AI Composer — read-only notes for Qwen-Max (no Composer code touched)

* The Composer's context builder collects measurements by **regex over prose and ledger rows**
  (`buildRadiologistDraftContext.ts:61`, `:142`, `:223-227`). It does not read `canalApProvenance` and
  does not read `spinal_measurements`.
* Practical effect: the Composer "sees" a canal diameter **only if it is already written in Findings** —
  in practice, only after the radiologist pressed *Generate Professional Report*. A number measured but
  not yet prose-ified is invisible to the model, and a model cannot be blamed for omitting it.
* `measurementAlreadyInText` (`:125`) suppresses the explicit `Measurement:` line when the digits already
  appear in the sentence — reasonable, but it means the numeric authority is the prose, not the record.
* Suggested handoff (their call, not implemented here): read the canonical record as a structured,
  level-tagged input instead of scraping prose. **Do not let the Composer write back into it.**
* One contradiction the Composer inherits: because `canalApReportTable` writes
  `Spinal canal AP diameter (mm):` into Findings and the server splices `… CANAL AP DIAMETER AT … LEVELS`
  from the other store, a body can end up naming one level twice with **different numbers**. The
  server-side dedupe (`spinalCanalApTable.ts:128-141`, `/CANAL AP DIAMETER/i`) suppresses the second
  table whenever the prose is present — so the duplication is prevented, but only by dropping the
  bordered professional table, not by resolving which number is true.

---

## 9. Vertebral numbering (Phase 6) — one real gap

The grid's rows come from the numbering resolver, not a fixed list
(`SpineApCanalMeasurements.tsx:65-74` → `lumbarApCanalLevels` / `dorsalApCanalLevels`), so a transitional
study correctly offers different rows: sacralisation adds **`L5-T`**, lumbarisation gives **`L5-L6`** and
**`L6-S1`** (`mriSpineNumbering.ts:91-101`). Canonicalisation keeps those keys (`spineCanal.ts:84-87`),
so they are storable and restorable.

**But no print path can render them.** All three iterate the *fixed* vocabulary:
`professionalReport.ts:265` (`levelsForCanalSegment`), `spinalCanalApTable.ts:80-86`
(`canalLevelsForSegment`), `spineCanalAp.ts:230/:247`. A value recorded at `L5-T` or `L6-S1` is accepted
by the grid, saved, restored — and silently absent from every printed table. Levels are not
mis-associated (the wrong row never receives the wrong number); the failure mode is **silent omission**,
which is the same class of defect the owner asked about. Status: **code-traced, not browser-measured**
(no transitional-vertebra study was created here).

---

## 10. Smallest recommended correction (for the owner's approval — nothing implemented)

**A. One authority, no new store, no new UI, reuse the existing builder.**
Make the two print callers read the **canonical record** first and fall back to `spinal_measurements`:
* `radiology-report-generator.ts:2351` (draft preview) and `patient-reports.ts:2240` (signing) both
  already hold the draft's `structured_json`; pass `careCanalApProvenance` into the **existing**
  `renderCanalApTable` in `lib/spinalCanalApTable.ts`, which already takes a `Map<level, value>`.
* Keep reading `spinal_measurements` for rows that exist only there (legacy page, the AI-tab box, older
  drafts) so nothing that prints today stops printing.
* Carry the same table into the D1 preparer **once** — `radiologyD1FinalWriter.ts:345` and
  `radiologyD1AmendmentWriter.ts:267` — so the structured finalize path and every amendment stop dropping
  it (§6.1), instead of adding a third splice at some route.
* Do not duplicate the table generator: `spinalCanalApTable.ts` stays the one builder for both surfaces.
* Then the grid's values print, the AI-tab box becomes redundant (retiring it is a separate owner
  decision — it is a live write path with existing rows), and no data contract changes.
* Also fix §9 in the same pass by letting `renderCanalApTable`/`canalApReportTable` print the levels the
  numbering resolver actually offered, instead of the fixed five.

**B. Findability, only after A.**
* Move/keep **one** instance of the same `SpineApCanalMeasurements` component under the tab a
  radiologist already expects — *Measure* — for cervical, dorsal and dorso-lumbar as well as lumbar
  (today only lumbar appears there, `ReportingToolsRail.tsx:964-969`). Same component, same record: no
  duplicate panel, no second grid.
* Add a short one-line affordance in the Findings header pointing to it, and delete the misleading text
  at `ReportingToolsRail.tsx:697-700`.
* Do **not** auto-open the AI tab, do not auto-insert prose into Findings, do not gate signing on it —
  the owner's standing rule is *auto means easy, not closed eyes*.
* **Audit hygiene that should follow:** `mriBrainCanvasPlacement.test.ts` must be taught to fail on
  `{false && (` (or be replaced by a render check). Today it is a green guard over invisible UI, and it
  is the reason this feature was reported as "in the report body" when it is not.

---

## 11. Evidence inventory

| Artefact | Path |
|---|---|
| per-examination visibility census | `tmp/canal/census.json`, screenshots `tmp/shots/census-*-structured.png`, `census-*-ai.png` |
| two-authority A/B | `tmp/canal/ab.json`, `tmp/shots/ab-01-typed.png` … `ab-05-grid-vs-print.png`, `ai-measure-stage-box.png` |
| save / switch-study / return proof | `tmp/pw-canal-persist.mjs`, `tmp/shots/phase3-switch-return.png` |
| dead-block span check | `tmp/jsx-span.mjs` → `guard at line 1047 closes at line 1436` |
| brain reachability probe | `tmp/pw-brain-reach.mjs` (all zeros) |
| print-path tests at `877701f9` | `radiologyReportPrint.canalMeasurements.request.test.ts` 7/7, `signedReportCanalMeasurements.request.test.ts` 6/6, `spineCanalAp.test.ts` 11/11, `canalApDerivation.test.ts` 20/20, `mriSpineSegmentConsumers.test.ts` 9/9, `mriDorsoLumbar*.test.ts` 33/33, `mriCervicalDorsalCanvas.test.ts` 28/28 |
| synthetic fixtures | `tmp/make-spine-studies.mjs`, `tmp/canal-cases.json` (patients `CANAL-*`, accessions `ACC-CANAL-*`) |
