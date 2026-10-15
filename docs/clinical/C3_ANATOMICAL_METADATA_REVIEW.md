# C3 — Clinical anatomy metadata review and readiness register

**Status: READ-ONLY REVIEW. Nothing in this document has been applied to a catalogue, a
template, a report, or a database.**

Measured at `origin/main` **`a1cc79e1`** by `pnpm audit:anatomy`, which runs
`artifacts/diagnostic-erp/src/lib/clinicalMetadata/anatomyMetadataAudit.ts` over the
repository's own metadata definitions and writes:

| artefact | what it is |
| --- | --- |
| `tmp/clinical-metadata-audit/audit.md` | the full inventory, coverage matrix, manifest census and every finding (gitignored) |
| `tmp/clinical-metadata-audit/coverage.json` | the same run as machine-readable counts (gitignored) |
| `artifacts/diagnostic-erp/src/lib/clinicalMetadata/coverage-baseline.json` | the **accepted** snapshot; CI fails if coverage deteriorates against it |
| `artifacts/diagnostic-erp/src/lib/clinicalMetadata/anatomyMetadataAudit.test.ts` | 50 deterministic tests: every guard fires on a synthetic defect and stays silent on clean data |

Every number in this document is produced by that command. None is typed in by hand. The
audit reads source files only: it never opens a database, never renders a report, and is
imported by nothing in the app (`anatomyMetadataAudit.test.ts` proves that with a
source-contract guard).

Purpose: C2 established that the same set of Quick Select observations can produce
differently-ordered Findings depending on click order, and declined to build an anatomical
ordering engine because *"the available metadata does not yet support reliable ordering of
all clinical observations"*. C3 measures that claim, names exactly what is missing, and
lists the clinical decisions only the radiologist-owner can make. **C3 does not reorder
anything.**

---

## A. Verdict

| question | answer | evidence |
| --- | --- | --- |
| Can Findings be ordered by anatomy across the catalogue today? | **No.** 2 of 101 findings tiles (2.0%) carry a section their own examination's baseline declares. | `orderingFeasibility` in the baseline snapshot |
| Is the vocabulary of "anatomical section" consistent? | **No.** Four independent spellings exist and only 5 of 50 baseline section names appear in the Findings Library's list of 37. | C3-R14 |
| Is there one authoritative metadata source? | **No** — but there is one *authoritative for ordering*: the owned baseline manifest. Everything else is a catalogue of sentences. | §B |
| Are the concepts safe? | Broadly yes: 98/101 resolve to a content pack; 1 concept is declared twice; 22 aliases are claimed by two concepts each. | C3-R02/R05/R06 |
| Is a clinical decision required? | **Yes — 60 items are marked `REQUIRES_RADIOLOGIST_REVIEW`.** None has been guessed. | §F |

---

## B. Source-of-truth map (verified)

| source | path | authority | reaches the printed report? | anatomy metadata it carries |
| --- | --- | --- | --- | --- |
| Owned baseline manifests | `artifacts/diagnostic-erp/src/lib/zai-workspace/baselines/*.ts`, assembled by `baselines/index.ts → ownedBaselineCatalog()` | **AUTHORITATIVE for anatomical order** | yes, as the Normal Format | `concept`, `conflictGroup`, `anatomicalSection`, `level?`, `laterality?`, `region?`; **array order is the only order** |
| LS Spine standard normal | `.../zai-workspace/fullReportBaseline.ts` (`MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST`) | authoritative, but **not in `ownedBaselineCatalog()`** — a second registry entry point | yes | same |
| Quick Select tile catalogue (client default) | `.../zai-workspace/quick-select-tiles.data.ts` | source of truth for the tiles an operator clicks | yes, via the patch engine | `concept`, `anatomicalSection`, `conflictGroup`, `baselineReplaces`, `properties` |
| Content packs / concept canon | `.../conceptCanon/contentPacks.ts` (555 packs), `.../conceptCanon/conceptCanon.ts` | authoritative for concept identity and aliases | indirectly (concept resolution) | `regions` (coarse: `brain`, `chest`, …), `modalities`; **no intra-region order** |
| Findings Library section list | `.../lib/findingsCompose.ts` → `SECTION_ORDER` (37 names) | a **second, competing** section vocabulary | yes, wholesale via the panel | section names in Title Case |
| Seeded DB quick findings | `migrations/*.sql` → `radiology_quick_findings` (380 rows in 10 files) | database rows the clinic seeded | **not by the live strip** — the Quick Select bar reads the TS catalogue | `anatomical_section` (67 rows), `conflict_group`, `sort_order`; **no `concept` column exists** |
| Chocolate findings | `lib/db/src/schema/radiology.ts:374` `radiology_chocolate_findings` | separate feature table | no | `supports_laterality` (:391), `sections_owned` (:393) — the only table with laterality |
| Structured templates | `structured_report_templates` rows, surfaced by the Templates screen | authoritative for wording the clinic edits | yes | free-text prose only |
| Unused module | `.../lib/clinicalAnatomy/clinicalAnatomyContext.ts` | **dead for ordering** — no consumer ranks by it | no | n/a |

**No new registry was added.** `clinicalMetadata/` holds an audit *over* these sources; it
stores no clinical claim of its own, and the review list `RADIOLOGY_READINESS_SCOPES` is a
schedule of questions, not anatomy.

Derived / runtime state deliberately excluded from the inventory: user-customized tiles
(`custom: true`, `usageCount`), the observation ledger, and any live database value. A
missing observation is not a normal observation, and a private tile is not catalogue data.

---

## C. Coverage by modality

The catalogue's declared scope (`scopeModality` / `scopeBodyPart`) is what is measured here.
That is a *catalogue* fact, not a *study applicability* fact: nothing in this table was
inferred from the English wording of a sentence.

| requested examination | findings tiles | concept declared | resolves | section declared | section matches own baseline | concept in baseline | conflict group | baselineReplaces |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MRI Brain | 29 | 29 | 28 | 2 | 2 | 9 | 29 | 4 |
| MRI Cervical Spine | 36 | 36 | 36 | 0 | 0 | 24 | 36 | 5 |
| MRI Dorsal Spine | **0** | — | — | — | — | — | — | — |
| MRI LS Spine (lumbar) | 20 | 20 | 18 | 0 | 0 | 16 | 20 | 1 |
| CT Brain | 4 | 4 | 4 | 0 | 0 | 0 | 4 | 1 |
| USG Whole Abdomen | 3 | 3 | 3 | 0 | 0 | 0 | 3 | 1 |
| MRCP | **0** | — | — | — | — | — | — | — |
| Lower limb arterial Doppler | **0** | — | — | — | — | — | — | — |
| Lower limb venous Doppler | **0** | — | — | — | — | — | — | — |
| Mammography | 2 | 2 | 2 | 0 | 0 | 0 | 1 | 0 |
| General X-ray (Chest) | **0** | — | — | — | — | — | — | — |
| *also present, not requested* | CT Chest 3, CT PNS 1, MR Knee 1, MR Pelvis 1, MR Shoulder 1 | | | | | | | |

Totals: **127 tiles, of which 101 are findings tiles**; 159 findings observations across 10
baseline manifests; 380 seeded DB rows.

Three things this table says plainly:

1. **Five of the eleven examinations have no findings catalogue at all.** For X-ray the
   catalogue has exactly one tile and it is a *technique* tile (`XR/(any)` —
   `"Radiograph on digital radiography unit. Standard AP and lateral views."`,
   `quick-select-tiles.data.ts:73`), so there is nothing anatomical to order. MR Dorsal Spine
   is the mirror case: it has **two owned baseline manifests** (standard + screening) and
   **zero tiles**.
2. **`anatomicalSection` is essentially unused on tiles: declared on 3 of 101**, and only 2
   of those are a section their own examination's baseline declares. This is the single
   decisive gap for ordering.
3. **Concept coverage is good; placement coverage is not.** 101/101 findings tiles declare a
   concept, 98 resolve to a pack, and 49 name a concept that actually appears in that
   examination's baseline — so half the catalogue can be *identified* even though almost none
   of it can be *placed*.

### Uncertain scope mappings (reported, not resolved)

| mapping used above | evidence | status |
| --- | --- | --- |
| `US/Abdomen` = "USG Whole Abdomen" | one bodyPart string in the catalogue; no partial-abdomen scope exists to distinguish it from | PROBABLY_SAME — confirm |
| `MR/LS Spine` = "MRI Lumbar" | repo spells the lumbar format `LS Spine` (lumbosacral), which may intentionally include S1 | NEEDS_RULING — a sacral section is not lumbar |
| "MRI Dorsal" vs the repo's `Whole Spine` manifests | `MRI Whole Spine — Screening Normal` owns Cervical/Dorsal/Lumbar regions in one manifest | NEEDS_RULING — is Dorsal ever reported alone? |
| Doppler = `US` modality | the `Modality` union has `DOPPLER` (`types.ts:5`) but no tile uses it | NEEDS_RULING — which code does billing use? |

---

## D. Baseline manifests — what an ordering engine could rank against

| manifest | exam | revision | findings rows | distinct concepts | concepts repeating |
| --- | --- | --- | --- | --- | --- |
| MRI Brain — Standard Normal | MR/Brain | `mri-brain-standard-normal-r1` | 12 | 12 | — |
| MRI Brain — Screening Normal | MR/Brain | `mri-brain-screening-normal-r1` | 6 | 6 | — |
| MRI Cervical Spine — Standard Normal | MR/Cervical | `mri-cervical-standard-normal-r1` | 44 | 14 | 6 concepts repeat, each distinguished by level |
| MRI Cervical Spine — Screening Normal | MR/Cervical | `mri-cervical-screening-normal-r1` | 7 | 7 | — |
| MRI Dorsal Spine — Standard Normal | MR/Dorsal | `mri-dorsal-standard-normal-r1` | 10 | 10 | — |
| MRI Dorsal Spine — Screening Normal | MR/Dorsal | `mri-dorsal-screening-normal-r1` | 7 | 7 | — |
| MRI LS Spine — Standard Normal | MR/LS | `mri-ls-standard-normal-r1` | 39 | 15 | 6 concepts repeat, each by level |
| MRI LS Spine — Screening Normal | MR/LS | `mri-ls-screening-normal-r1` | 7 | 7 | — |
| MRI Knee — Standard Normal | MR/Knee | `mri-knee-standard-normal-r1` | 11 | 11 | — |
| MRI Whole Spine — Screening Normal | MR/Whole Spine | `…-r2` | 16 | 7 | 5 concepts repeat, distinguished by `region` |

Verified properties (each asserted by a test):

- **All 159 findings observations declare an `anatomicalSection`** (`observationsWithoutSection = 0`)
  and every manifest carries a `revision`. This is the most complete anatomy metadata in the
  repository.
- **Every manifest is MR.** CT, US, MG and XR have none, so for those examinations there is
  no approved anatomical sequence for anything to rank against (C3-R20, 7 examinations).
- Repeating concepts are **legitimate**: `foraminal stenosis` appears 6 times in the cervical
  manifest because each level is its own slot. The consequence for the next milestone is
  that an ordering key must be **(concept, level)**, never concept alone (C3-R07, 17 items).
- Whole Spine uses the `region` override (`Cervical spine → Dorsal spine → Lumbar spine`),
  which is the multi-region pattern any ranker must honour rather than flatten.
- No baseline finding was rewritten, no normal invented, no manifest reordered. The section
  sequences above are reported as they are declared.

---

## E. Concept consistency

- **1 duplicate concept (ERROR).** `craniocervical_junction` is declared twice in
  `contentPacks.ts` (lines 443 and 1943 — once in a tuple-form list, once as an object).
  `conceptCanon.ts`'s alias index is first-declaration-wins, so which description wins
  depends on file order. Recorded, not merged: it *may* be two different intentions.
- **3 concepts resolve to no pack:** `glioma` (MR Brain / Glioma recurrence), `schmorl` and
  `hemangioma` (MR LS Spine). Note `schmorl_node` and `ls_schmorl_node` *do* exist — the tile
  simply uses a bare spelling nothing declares. `subdural_hematoma` is **not** in this list:
  it is a declared pack (`contentPacks.ts:296`).
- **22 alias collisions (C3-R06), all left unresolved.** They are not all the same kind of
  problem:
  - *same anatomy, one modality* — `annular fissure`/`annular tear` → `annular_fissure` vs
    `disc_contour`; `spondylolysis` → `pars_defect` vs `spondylolisthesis` (these are
    different diagnoses, not synonyms); `midline shift` → `midline` vs `midline_shift`.
  - *deliberate cross-region normal* — `disc spaces preserved`, `endplate sclerosis`,
    `facet arthropathy`, `no instrumentation`, `vacuum phenomenon`, `posterior element
    fracture`, `focal lytic/sclerotic lesion`, `marginal osteophytes`, `laminectomy`, each
    claimed by a `cervical_*` and an `ls_*` concept. These are the same clinical term in two
    examinations; a concept id alone cannot tell them apart, so an ordering key must carry
    the examination too.
  - *cross-modality collisions that change meaning* — `meniscus` is an alias of
    **`pleural_effusion`** (`contentPacks.ts:924`, the meniscus sign of a pleural effusion)
    *and* of the knee concept `meniscus` (`:694-697`); `effusion` → `effusion` vs
    `pleural_effusion`; `collapse` → `compression_fracture` vs `lobar_collapse`; `contusion`
    → `contusion` vs `pulmonary_contusion`. First declaration wins, so today a chest report
    saying "meniscus" resolves to a knee concept.
- **7 concepts filed under more than one conflict group (C3-R23)**, which means tiles that
  should recognise each other as being about the same anatomy do not. The worst is
  `disc contour`, spread over 4 groups (`disc bulge`, `disc extrusion`, `disc herniation`,
  `disc protrusion`). Also `ventricles` → `hydrocephalus` vs `ventricular`, `infarct` →
  `infarct` vs `chronic infarct`, `alignment` → `alignment` vs `kyphosis`, `birads` →
  `bi rads` vs `spiculated mass`, `disc signal`, `facet joint`.
- **Deliberately NOT merged, per the brief:** subdural vs epidural haematoma stay distinct;
  mass effect vs midline shift stay distinct; hydrocephalus vs ventricular prominence stay
  distinct. Where the repository itself conflates them (the `ventricles` and `midline shift`
  rows above) it is recorded as a question, not fixed.
- **1 stale ownership declaration (C3-R10):** `MR LS Spine / Normal LS spine` declares
  `baselineReplaces: "No spondylolisthesis."` while the LS baseline renders
  `"No spondylolisthesis is seen."`. Retirement may still resolve by concept, so this is
  WARNING-level: a proven metadata drift, **not** a proven clinical failure.

---

## F. Review register — items needing the radiologist-owner

Grouped by pattern rather than by tile; the full per-item list is in
`tmp/clinical-metadata-audit/audit.md` §6. Confidence is the audit's confidence that the
*fact* is right, not that the proposed resolution is clinically correct.

| ID | modality | source tile / concept | current metadata | missing or ambiguous field | existing evidence | proposed resolution | confidence | clinician approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C3-01 | all | 98 of 101 findings tiles | `anatomicalSection` absent | anatomical section | C3-R03; only 3 tiles declare one | Owner supplies a section per tile **from the examination's own baseline vocabulary**; no new names until that list is agreed | High (gap), n/a (answer) | **REQUIRED — blocks ordering** |
| C3-02 | CT, US, MG, XR | every tile of CT Brain/Chest/PNS, US Abdomen, MG Breast | no owned baseline exists | the whole approved sequence | C3-R20 ×7 examinations; all 10 manifests are MR | Decide whether these examinations get manifests at all, or are declared "not anatomically ordered" by policy | High | **REQUIRED** |
| C3-03 | all | `SECTION_ORDER` (37 Title Case) vs baseline sections (50 lowercase) | two vocabularies | one canonical list + a mapping | C3-R14: only 5 names agree | Pick the baseline manifest's vocabulary as canonical; re-point `findingsCompose.SECTION_ORDER` at it, or accept that the Findings Library panel and the printed report can order the same study differently and say so | High | **REQUIRED** |
| C3-04 | spine | 36 tiles whose prose names a level (`Disc bulge C5-C6`, `Cord compression C5-C6`) | level is in the sentence only | structured level | C3-R15 ×36; tiles have no `level` field (`types.ts:117`) | Either add a `level` field to the tile type (needs an owner ruling on the shape) or rank by the manifest's own level slots | High | **REQUIRED** |
| C3-05 | knee + chest | alias `meniscus` | claimed by `meniscus` and `pleural_effusion` | modality-scoped alias resolution | C3-R06; `contentPacks.ts:694` and `:924` | Scope the alias index by modality, or rename the chest alias to `meniscus sign`. Do **not** delete either concept | High | **REQUIRED** |
| C3-06 | chest vs spine/brain | aliases `collapse`, `contusion`, `effusion` | each claimed by 2 concepts across modalities | same | C3-R06 | Same mechanism as C3-05; needs the owner to confirm which reading each report means | High | **REQUIRED** |
| C3-07 | cervical + LS | 9 aliases duplicated per region (`endplate sclerosis`, `facet arthropathy`, `vacuum phenomenon`, …) | two concept ids for one term | a decision: one concept + level/region, or two concepts | C3-R06 | These are the "same finding, different exam" pattern. Merging them is what made `posterior_elements` one concept in PR #778 — the same ruling is needed here | Medium | **REQUIRED** |
| C3-08 | skull base | `craniocervical_junction` | declared twice | one declaration | C3-R05 (the run's only ERROR) | Owner states whether the two entries mean the same thing; then delete one | High | **REQUIRED** |
| C3-09 | spine | `spondylolysis` alias claimed by `pars_defect` and `spondylolisthesis` | two different diagnoses share a term | — | C3-R06 | These are **not** synonyms; the alias belongs to `pars_defect` only | Medium | **REQUIRED** |
| C3-10 | brain | `midline shift` alias claimed by `midline` and `midline_shift` | normal and abnormal share a term | — | C3-R06 | Midline shift must never resolve to the normal `midline` concept | Medium | **REQUIRED** |
| C3-11 | brain | `ventricles` under groups `hydrocephalus` and `ventricular` | one concept, two conflict groups | single group per anatomy | C3-R23 | Confirm hydrocephalus and ventricular prominence are *not* interchangeable (they are listed as such in the brief); then split the group, not the concept | Medium | **REQUIRED** |
| C3-12 | spine | `disc contour` under 4 conflict groups (bulge/extrusion/herniation/protrusion) | one concept, four groups | per-alias resolution | C3-R23 | These are different morphologies. A disc protrusion is not a disc extrusion; the concept is probably too coarse | Medium | **REQUIRED** |
| C3-13 | LS | tile `Normal LS spine` | `baselineReplaces "No spondylolisthesis."` vs baseline `"No spondylolisthesis is seen."` | exact text | C3-R10 | Decide whether `baselineReplaces` matches by text (today) or by concept; then fix the string. Do not change either clinical sentence to satisfy the other | High | **REQUIRED** |
| C3-14 | CT brain, US breast, MG | 13 tiles ship an unfilled `___` measurement blank | no measured value | measurement slot contract | C3-R11b | Confirm a blank is intended to survive into a printed report; if not it belongs in the measurement path | High | **REQUIRED** |
| C3-15 | all | 22 tiles whose sentence is 2–3 sentences | one tile = several statements | multi-sentence grouping | C3-R13 | Any future ordering must move these as one unit (they already do — C2 verified the patch engine treats a tile as one observation) | High | Informational |
| C3-16 | DB | 380 seeded rows, no `concept` column, `baseline_replaces` on 0, sections on 67 | table cannot participate in concept resolution | concept column (schema) | C3-R17/R18/R19 | Decide whether `radiology_quick_findings` is ever meant to reach a report. If not, retire it; if yes, it needs a migration — **out of scope for C3, and no migration was added** | High | **REQUIRED** |
| C3-17 | LS seed | 1 row stores `'{level}'` in `anatomical_section` | token used as a section | intent | C3-R16 | Either the section is deliberately dynamic or the column is being used as a level | Medium | **REQUIRED** |
| C3-18 | MR Dorsal | 2 owned manifests, 0 tiles | nothing to click | a dorsal tile catalogue | C3-R24 | Ordering cannot help an examination with no tiles. This is a content task, not a metadata task | High | Owner's roadmap |
| C3-19 | MRCP, Doppler, XR | 0 findings tiles each | no catalogue | concept + section vocabulary per examination | C3-R24 | Same as C3-18 | High | Owner's roadmap |
| C3-20 | whole spine | `MRI Whole Spine` manifest repeats 5 concepts distinguished by `region` | ranker must honour `region` | — | C3-R07 | Any ordering key must be (concept, level, **region**), or a whole-spine report mis-ranks | High | Design ruling |

The register above groups the 60 `REQUIRES_RADIOLOGIST_REVIEW` items the run produces —
22 alias collisions (C3-05…C3-07), 36 tiles that name a level only in prose (C3-04), 1
section outside its examination's baseline (C3-01) and 1 seeded template token (C3-17). The
ungrouped remainder are the same patterns on other tiles, and every one is listed
individually in `tmp/clinical-metadata-audit/audit.md` §6.

---

## G. Is ordering feasible today? (Phase F, measured)

| bucket | tiles | share |
| --- | --- | --- |
| **safe rank key today** — concept resolves *and* section is declared by that exam's baseline *and* that exam has a baseline | 2 | **2.0%** |
| concept known, placement needs a clinical mapping | 96 | 95.0% |
| no ordering key at all (concept unresolved) | 3 | 3.0% |

Other measured quantities: 22 multi-sentence tiles; 6 tiles competing to retire the same
baseline sentence; 4 conflict groups holding both a normal and an abnormal tile
(`cholelithiasis`, `hemorrhage`, `pneumothorax`, `spondylolisthesis`); 4 examinations with an
owned baseline vs 7 measured without; 23 tiles need a `{side}` value, 0 have a structured
laterality field; 36 tiles name a level in prose, 0 have a structured level field.

Click-order behaviour is **not re-measured here** — C2 measured it (four clicks → 24 orders →
8 distinct Findings; SDH+EDH+SAH → 6 permutations → 6 distinct outputs) at its own baseline,
and §16 of the brief forbids rediscovering it. Two cautions when reusing those numbers: C2
counted 33 MRI Brain findings tiles and the catalogue now has 29, so C2's per-scope counts are
stale; and the mechanism C2 recorded is still present at `a1cc79e1` — a retiring patch is
placed in `replacementSlot` (`pathologyPatch.ts:420-497`) while a non-retiring sentence is
appended at the end (`reportFieldMerge.ts:478`) with no re-sequencing pass.

**Conclusion: the metadata does not support a general anatomical reordering.** Two tiles in
101 can be placed without a clinical decision. The 2.0% is not an argument for giving up; it
is the size of the job: C3-01 alone (a section per tile, from the examination's own baseline
vocabulary) converts most of the 96% into rankable metadata without inventing an ontology.

---

## H. How to implement ordering later (Phase J — design only, nothing built)

### Option A — preserve insertion order (status quo)

Findings keep the click/dictation sequence; only a patch that retires a baseline normal is
placed in that normal's slot.

- *Clinical safety:* nothing is ever re-read differently than it was written; contradictions
  stay where the author put them. *Determinism:* per-click deterministic, but the same set of
  observations in a different click order yields a different page (C2). *Manual edits:*
  untouched by construction. *Provenance:* unchanged. *Undo/persistence:* no change.
  *Performance:* free. *Test complexity:* none added. *Migration:* none. *Back-compat:* total.

### Option B — opt-in anatomical ordering, visible preview, explicit approval

A single control ("Tidy Findings by anatomy") that re-ranks only machine-owned, resolvable
lines, shows the before/after, and does nothing until the radiologist accepts. This mirrors
what the codebase already does for Impression: `orderImpressionByPriority`
(`store.ts:2858`) is invoked automatically only for the spine family
(`useWorkspaceClinicalUi.tsx:3090`) and offered as an explicit button in three sub-master
panels (`MriDorsalSubMasterPanel.tsx:201`, `MriLumbarSubMasterPanel.tsx:186`,
`MriDorsoLumbarSubMasterPanel.tsx:225`). The freeze-when-edited pattern already exists
(`impressionOrderFrozen` is set at `store.ts:1218` and obeyed at `store.ts:2864`).

- *Clinical safety:* highest of the three — the radiologist sees and approves every change;
  nothing moves that they did not ask for; unrankable lines are pinned where they are rather
  than guessed. *Manual edits:* preserved by pinning prose/`radiologist-voice`-owned lines at
  their absolute positions. *Provenance:* preserved — the reorder is one recorded action, and
  `applyPathologyOverlay` remains the single write path. *Undo:* one step. *Persistence:* no
  schema change; the field content is what already saves. *Performance:* O(n log n) over a
  report's lines. *Test complexity:* moderate — needs a permutation guard (every output line
  present, none invented, count equal), which the Impression path already has. *Migration:*
  none. *Back-compat:* total, because the default is off.

### Option C — automatic ordering where metadata is verified

Silently rank anything whose metadata resolves; leave the rest.

- *Clinical safety:* **fails on today's measurements** — 2.0% of tiles qualify, so the engine
  would move two lines and leave 99 where they are, producing an order that looks authored
  but is neither. It also re-reads a report the radiologist composed in a chosen sequence
  without asking, against a standing instruction that AI and automation must not silently
  overwrite manual work. *Manual edits:* needs the same pinning as B, but with no user in the
  loop to notice a mis-pin. *Determinism:* yes. *Everything else:* same as B, minus the
  approval. *Back-compat:* changes the appearance of existing reports on reopen.

### Recommendation

**Option B**, and **not Option C yet**, on the measured evidence:

1. 2 of 101 findings tiles can be placed safely today, so an automatic pass would be a
   mostly-no-op reorder with a clinical appearance of authority (§G).
2. Four competing section vocabularies (§B/§C) mean "anatomical order" is not yet a single
   defined thing in this repository; a silent engine would pick one by accident.
3. B is the only option whose safety does not depend on metadata quality: unrankable lines
   simply do not move. It can ship the day C3-01 is answered, and C (auto) can later be
   switched on for a scope **by examination**, once that examination's coverage is 100%.
4. B reuses machinery the repo already has and already tests (`orderImpressionByPriority`,
   the freeze-on-edit hook, `refuseSignedMutation`, `applyPathologyOverlay` as the single
   write path). No second composition path, no new ontology, no new store shape.

### Decisions that must come from the radiologist-owner before any of it is built

| # | decision | why it is not a code decision |
| --- | --- | --- |
| D1 | Auto (C) or opt-in (B)? | Clinical authority over report layout; the repo already splits this way for Impression |
| D2 | Which vocabulary is canonical: baseline-manifest sections or `SECTION_ORDER`? | The printed report and the Library panel currently disagree; picking one changes what clinicians see |
| D3 | One `anatomicalSection` per tile, or rely on concept→baseline lookup? | Affects every future tile and the ownership system |
| D4 | Is (concept, level, region) the ranking key, or concept alone? | Whole Spine and both spine manifests repeat concepts by level/region (§D) |
| D5 | Do the 22 alias collisions get modality-scoped resolution, or renamed aliases? | `meniscus` genuinely means two different clinical signs |
| D6 | Should CT/US/MG/XR get owned baselines, or be declared exempt from anatomical ordering? | Determines whether 7 examinations ever order |
| D7 | Do manual-edited and `radiologist-voice` lines pin absolutely? | The instruction "AI must not silently overwrite manual work" needs a concrete pinning rule |
| D8 | Is a multi-sentence tile ever split? | 22 tiles are multi-sentence; splitting changes clinical statements |
| D9 | What happens on reopen of an existing unsigned draft? | Re-ordering a restored draft is a clinical change to text someone wrote |
| D10 | Is `radiology_quick_findings` (380 rows) kept at all? | It has no concept column and cannot take part; retiring it is a product decision, and re-keeping it needs a migration |

---

## I. Deliberately not done

- No report composition changed; nothing in `src/lib` outside `clinicalMetadata/` imports
  this audit, and a test asserts that.
- No baseline finding rewritten, none invented, no manifest reordered, no normal added.
- No Quick Select wording changed; no concept merged; no alias removed.
- No database touched: the seed inventory reads checked-in SQL only.
- No migration, no schema change, no flag, no deployment.
- No ordering function, no reorder call, no change to Impression or Recommendation logic.
- The deterioration gate blocks **regressions against the accepted baseline only**; an
  incomplete catalogue cannot fail CI by itself (C3-R20, R24, R03 are informational/warning
  by design, and `diffAgainstBaseline` reports only losses).
