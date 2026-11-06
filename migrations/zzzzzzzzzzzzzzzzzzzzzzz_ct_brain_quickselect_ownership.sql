-- =============================================================================
-- zzzzzzzzzzzzzzzzzzzzzzz_ct_brain_quickselect_ownership.sql
-- =============================================================================
-- WHY THIS FILE EXISTS
-- The final clinical acceptance of `6e2031ad` failed CT Brain (Test 4 / defect D2).
-- The four CT Brain Plain boxes the radiologist clicks on an acute head CT —
-- Intracranial Hemorrhage, Acute Infarct, Midline Shift, Hydrocephalus — are in
-- the clinic's database with NO `anatomical_section`, NO `concept` and NO
-- `baseline_replaces`. They were created by
-- `migrations/zzzz_ct_gold_standard_content.sql`, which seeds prose only.
--
-- The engine is not missing a capability. `anatomical_section` already decides
-- placement (`pathologyPatch.ts` `sectionEndSlot`: the heading whose label equals
-- the declared section), `concept` already drives supersession
-- (`observationSlot.ts` `sentenceOwnedBySlot`), and `baseline_replaces` is the
-- curated "this is the normal I contradict" contract. Measured on the acceptance
-- rig against the CT Brain Plain normal template, the three consequences of the
-- empty columns were:
--
--   1. "There is midline shift of 6 mm to the left." printed with
--      "Midline:" / "No shift." still standing SIX LINES ABOVE it in the same
--      Findings section. A signed report that both denies and documents a shift.
--   2. The hemorrhage sentence and the shift sentence were appended at the END of
--      Findings, i.e. under "Bone Windows:", because with no declared section the
--      walk has nothing to route on. That is the failure mode
--      `sectionEndSlot`'s own comment warns about.
--   3. The Conclusion read "Midline shift of 6 mm." — magnitude yes, DIRECTION
--      absent. Which way the brain is displaced is the neurosurgical question the
--      line exists to answer, and the sentence the box writes never says.
--
-- WHAT THIS MIGRATION TOUCHES
--   * Only `study_type = 'CT Brain Plain'` rows, by label: the four gold-standard
--     boxes (Intracranial Hemorrhage, Acute Infarct, Midline Shift, Hydrocephalus)
--     get concept + section + claim, and the two stroke-pack boxes on the same strip
--     (ICH, Acute MCA infarct) get the claim only — see section 5. Eleven guarded
--     UPDATEs, no other label, no other study type.
--   * Only rows whose ownership columns are still empty, and only
--     `factory_key = ''` with `customized_at IS NULL` — the same three guards
--     `zzzzzzzzzzzzzzzzzzzzzz_usg_abdominal_ownership.sql` uses. A box curated at
--     the reporting desk is never rewritten by a deploy.
--   * No DROP, no rename, no column addition. All five columns used exist since
--     `zzzzzzzzzzzzzzzzzzzz_quick_select_authoring.sql`.
--   * The one prose change is the Midline Shift CONCLUSION sentence, and it is
--     guarded by the exact shipped string: a row the clinic has reworded is left
--     alone. `{shift}` and `{side}` are the box's own existing question keys
--     (`questions_json`), so nothing here asks the radiologist a new question and
--     no value is ever defaulted — an unfilled token refuses the click at
--     `quickSelectParameterContract`, which is how the other three columns of this
--     row already behave.
--
-- CONCEPT IDS ARE NOT INVENTED
-- Every value is already registered in
-- `artifacts/diagnostic-erp/src/lib/conceptCanon/contentPacks.ts`:
--   hemorrhage (aliases: hemorrhage, haemorrhage, hematoma, ich, intraparenchymal hemorrhage)
--   infarct    (aliases: infarct, acute infarct, chronic infarct, stroke)
--   midline    (aliases: midline, midline shift, no midline shift)
--   ventricles — the same id the shipped factory box "Hydrocephalus" carries
--                (`quick-select-tiles.data.ts`, and `CONCEPT_HINTS` in
--                `observationSlot.ts` resolves hydrocephalus to it).
--
-- BASELINE SENTENCES ARE QUOTED, NOT GUESSED
-- Each `baseline_replaces` value is a sentence the CT Brain Plain normal template
-- actually writes, copied from the migration that seeds it. Where a template words
-- its normal differently the claim simply matches nothing — the retirement is
-- refused, the normal stays on the page, and the finding prints beside it. That is
-- the safe direction of this contract and it is why the claims are stated as
-- sentences rather than inferred from a keyword.
--
-- IDEMPOTENT
-- Re-running rewrites nothing: every UPDATE is guarded on the column it fills
-- being empty, and the prose UPDATE on the exact pre-change string.

BEGIN;

-- ── 1. INTRACRANIAL HEMORRHAGE ───────────────────────────────────────────────
UPDATE radiology_quick_findings
   SET concept            = 'hemorrhage',
       anatomical_section = 'Parenchyma',
       updated_at         = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'CT Brain Plain'
   AND label = 'Intracranial Hemorrhage'
   AND (concept IS NULL OR concept = '')
   AND (anatomical_section IS NULL OR anatomical_section = '');

-- "No focal hypo- or hyperdensity. No haemorrhage or infarct." is one LINE of the
-- template carrying two sentences; a hemorrhage falsifies the second. The first is
-- left to the infarct box, which states a focal hypodensity.
UPDATE radiology_quick_findings
   SET baseline_replaces = 'No haemorrhage or infarct.',
       updated_at        = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'CT Brain Plain'
   AND label = 'Intracranial Hemorrhage'
   AND (baseline_replaces IS NULL OR baseline_replaces = '');

-- ── 2. ACUTE INFARCT ─────────────────────────────────────────────────────────
UPDATE radiology_quick_findings
   SET concept            = 'infarct',
       anatomical_section = 'Parenchyma',
       updated_at         = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'CT Brain Plain'
   AND label = 'Acute Infarct'
   AND (concept IS NULL OR concept = '')
   AND (anatomical_section IS NULL OR anatomical_section = '');

-- An acute territorial infarct is a focal hypodensity, it falsifies the hemorrhage
-- denial in the same breath, and it states a LOSS of the grey-white differentiation
-- the template reports as "Maintained." — three sentences, all of which the signed
-- report would otherwise assert alongside it. `baselineClaimCovers` reads a
-- multi-sentence claim part by part. The third claim is written heading-qualified
-- ("Grey-White Differentiation: Maintained.") because the sentence the template
-- prints under that heading is the single word "Maintained."; the ownership walk
-- folds a section heading into the sentence it is testing, so this claim reaches
-- that line and no other "Maintained." anywhere in any other report.
UPDATE radiology_quick_findings
   SET baseline_replaces = E'No focal hypo- or hyperdensity.\nNo haemorrhage or infarct.\nGrey-White Differentiation: Maintained.',
       updated_at        = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'CT Brain Plain'
   AND label = 'Acute Infarct'
   AND (baseline_replaces IS NULL OR baseline_replaces = '');

-- ── 3. MIDLINE SHIFT ─────────────────────────────────────────────────────────
UPDATE radiology_quick_findings
   SET concept            = 'midline',
       anatomical_section = 'Midline',
       updated_at         = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'CT Brain Plain'
   AND label = 'Midline Shift'
   AND (concept IS NULL OR concept = '')
   AND (anatomical_section IS NULL OR anatomical_section = '');

UPDATE radiology_quick_findings
   SET baseline_replaces = 'No shift.',
       updated_at        = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'CT Brain Plain'
   AND label = 'Midline Shift'
   AND (baseline_replaces IS NULL OR baseline_replaces = '');

-- The direction, not just the distance. Guarded on the shipped wording so a
-- clinic that reworded this line keeps its own sentence.
UPDATE radiology_quick_findings
   SET impression_text = 'Midline shift of {shift} mm to the {side}.',
       updated_at      = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'CT Brain Plain'
   AND label = 'Midline Shift'
   AND impression_text = 'Midline shift of {shift} mm.';

-- ── 4. HYDROCEPHALUS ─────────────────────────────────────────────────────────
UPDATE radiology_quick_findings
   SET concept            = 'ventricles',
       anatomical_section = 'Ventricles',
       updated_at         = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'CT Brain Plain'
   AND label = 'Hydrocephalus'
   AND (concept IS NULL OR concept = '')
   AND (anatomical_section IS NULL OR anatomical_section = '');

UPDATE radiology_quick_findings
   SET baseline_replaces = 'Normal in size and configuration.',
       updated_at        = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'CT Brain Plain'
   AND label = 'Hydrocephalus'
   AND (baseline_replaces IS NULL OR baseline_replaces = '');

-- ── 5. THE TWO STROKE-PACK BOXES ON THE SAME STRIP ───────────────────────────
-- `zzzz_ct_xr_quickselect_content_fill.sql` seeds three more CT Brain Plain boxes
-- — "ICH", "Acute MCA infarct" and "No acute infarct" — and the strip offers all
-- eight boxes together, so the radiologist clicking "ICH" beside "Intracranial
-- Hemorrhage" hits the same defect all over again: an acute haemorrhage printed
-- under a page that still denies one.
--
-- These two get ONLY the curated claim, not a section and not a concept. The claim
-- is the whole defect: with it, the walk retires the denial the box contradicts and
-- the finding lands on that denial's own line. A concept would additionally bind the
-- box into the same ownership slot as its gold-standard twin — which is a catalogue
-- decision (two wordings of one finding, or two findings the radiologist wants
-- side by side) and not this migration's to make. "No acute infarct" is a box that
-- ASSERTS normality, so it has no contradicted normal to retire and is left alone.
UPDATE radiology_quick_findings
   SET baseline_replaces = 'No haemorrhage or infarct.',
       updated_at        = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'CT Brain Plain'
   AND label = 'ICH'
   AND (baseline_replaces IS NULL OR baseline_replaces = '');

UPDATE radiology_quick_findings
   SET baseline_replaces = E'No focal hypo- or hyperdensity.\nNo haemorrhage or infarct.\nGrey-White Differentiation: Maintained.',
       updated_at        = NOW()
 WHERE factory_key = ''
   AND customized_at IS NULL
   AND study_type = 'CT Brain Plain'
   AND label = 'Acute MCA infarct'
   AND (baseline_replaces IS NULL OR baseline_replaces = '');

COMMIT;
