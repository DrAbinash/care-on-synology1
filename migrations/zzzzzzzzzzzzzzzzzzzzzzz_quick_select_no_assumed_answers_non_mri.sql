-- =============================================================================
-- Quick Select outside MRI: a required answer must not arrive pre-filled
-- =============================================================================
-- WHY THIS FILE EXISTS
-- `zzzzzzzzzzzzzzzzzzzzzzz_mri_quick_select_no_assumed_answers.sql` ruled this class for MRI: "A
-- finding requiring laterality must not silently assume a side", and the same for a level or a
-- measurement. That file's predicate is `study_type IN (brain, cervical spine, dorsal spine, ls
-- spine, whole spine, spine)`, so every other examination kept the behaviour. A default on a
-- REQUIRED question is not a convenience — the details form opens with Apply already enabled, so one
-- click reports an anatomy nobody chose, and these reach signed reports:
--
--   * Venous Doppler   "Acute DVT"                side = "right"
--   * Scrotum          "Testicular Torsion"       side = "right", flow = "absent"
--   * Renal Doppler    "Renal Artery Occlusion"   side = "right"
--   * Carotid Doppler  "Carotid Occlusion"        side = "right"
--   * MSK              "Rotator Cuff Tear"        side = "right"
--   * Hernia           "Irreducible/Incarcerated Hernia"  side = "right"
--   * BPP              "Biophysical Profile Assessment"   breathing / movement / tone = "Present", afi = "Normal"
--   * BPP              "Modified BPP (AFI + NST)"         nst = "Reactive", afi = "Normal"
--
-- Measured twice and identical: 52 active findings rows carrying 58 such answers, 49 of them a
-- laterality, on the clinic catalogue and on a database built by `pnpm db:migrate`. 0 rows are left
-- in the MRI study types, so the rule below is disjoint from the MRI file — it cannot re-do that work
-- and cannot undo it.
--
-- The rows are named here by study type and label, never by id: the same boxes carry different ids on
-- the clinic database than on a fresh migrate-built one (measured: `#299` is "Acute DVT" on the rig and
-- "Hydronephrosis" at the clinic), so nothing in this file may be pinned to a number.
--
-- WHICH DEFAULTS THIS FILE BLANKS, and which it deliberately leaves alone
-- Only answers that assert an observation in a word the radiologist never typed:
--   • the question key is one of the composer's three validated parameter tokens — side / level / size; or
--   • the default is a single-token observation answer from a closed vocabulary (present, absent,
--     reactive, non-reactive, normal, increased, decreased, reduced, maintained).
-- Everything else stays untouched, because it is authored clinical language rather than an assumed
-- answer — 46 further boxes carry defaults like `contents = "omental fat"`, `grade = "50-75%"`,
-- `collaterals = "with reconstitution distally via collaterals (subacute/chronic)"` and
-- `management = "Urgent obstetric consultation and delivery planning advised"`. Those are the
-- owner's wording and his call, listed in the pull request, not this file's to edit.
--
-- A blank default is not a dead box: it is the state the composer already handles for MRI, where an
-- empty required answer answers "Nothing was applied — choose the side" instead of writing a side.

BEGIN;

-- `questions_json` is the whole parameter contract of the box, so it is rewritten in place with every
-- other field of each question — key, label, type, options, order — carried through untouched, and
-- only `default` moves. A clinic-customised box belongs to the clinic, so `customized_at IS NULL` is
-- part of the predicate. `field` is limited to findings, as the MRI file does: the impression and
-- recommendation strips write summary language, not per-organ parameters.
UPDATE radiology_quick_findings q
   SET questions_json = (
         SELECT COALESCE(jsonb_agg(
                  CASE
                    WHEN coalesce(j ->> 'required', 'false') = 'true'
                     AND coalesce(j ->> 'default', '') <> ''
                     AND (
                           lower(j ->> 'default') IN ('present','absent','reactive','non-reactive',
                                                      'non reactive','normal','increased','decreased',
                                                      'reduced','maintained')
                        OR j ->> 'key' IN ('side','level','size')
                     )
                      THEN jsonb_set(j, '{default}', '""'::jsonb, true)
                    ELSE j
                  END
                  ORDER BY ord), '[]'::jsonb)::text
           FROM jsonb_array_elements(q.questions_json::jsonb) WITH ORDINALITY t(j, ord)
       )
 WHERE q.is_active
   AND coalesce(q.field, 'findings') = 'findings'
   AND lower(trim(coalesce(q.study_type, '')))
       NOT IN ('brain', 'cervical spine', 'dorsal spine', 'ls spine', 'whole spine', 'spine')
   AND q.customized_at IS NULL
   AND btrim(coalesce(q.questions_json, '')) LIKE '[%'
   AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(q.questions_json::jsonb) j
          WHERE coalesce(j ->> 'required', 'false') = 'true'
            AND coalesce(j ->> 'default', '') <> ''
            AND (
                  lower(j ->> 'default') IN ('present','absent','reactive','non-reactive',
                                             'non reactive','normal','increased','decreased',
                                             'reduced','maintained')
               OR j ->> 'key' IN ('side','level','size')
            )
       );

-- The post-condition, stated as the UPDATE's own predicate: after this file runs, no in-scope row may
-- still carry an answer the rule blanks. It can only trip where the UPDATE did not run, which is the
-- case a deploy that skipped feature migrations would produce — and the clinic has had exactly that
-- class of silent half-deploy before, so the file reports instead of pretending.
DO $do$
declare
  remaining int;
begin
  SELECT count(*) INTO remaining
    FROM radiology_quick_findings q
   WHERE q.is_active
     AND coalesce(q.field, 'findings') = 'findings'
     AND lower(trim(coalesce(q.study_type, '')))
         NOT IN ('brain', 'cervical spine', 'dorsal spine', 'ls spine', 'whole spine', 'spine')
     AND q.customized_at IS NULL
     AND btrim(coalesce(q.questions_json, '')) LIKE '[%'
     AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(q.questions_json::jsonb) j
            WHERE coalesce(j ->> 'required', 'false') = 'true'
              AND coalesce(j ->> 'default', '') <> ''
              AND (
                    lower(j ->> 'default') IN ('present','absent','reactive','non-reactive',
                                               'non reactive','normal','increased','decreased',
                                               'reduced','maintained')
                 OR j ->> 'key' IN ('side','level','size')
              )
         );
  IF remaining > 0 THEN
    RAISE EXCEPTION 'Quick Select still pre-fills an assumed answer on % in-scope box(es) after the blanking update — a one-click side or a pre-scored biophysical profile is a claim the radiologist never made.', remaining;
  END IF;
END
$do$;

-- Measured rather than trusted that the update had something to do: the two boxes named at the head of
-- this file must exist and must now ask. Looked up by study type and label with the case- and
-- space-insensitive comparison the adoption path itself uses, never by id.
DO $do$
declare
  named_missing int;
begin
  SELECT count(*) INTO named_missing
    FROM (values ('Venous Doppler', 'Acute DVT', 'side'),
                 ('Scrotum', 'Testicular Torsion', 'side'),
                 ('BPP', 'Biophysical Profile Assessment', 'breathing')) want
    LEFT JOIN radiology_quick_findings q
      ON lower(trim(q.study_type)) = lower(trim(want.column1))
     AND lower(trim(q.label)) = lower(trim(want.column2))
     AND q.is_active AND coalesce(q.field, 'findings') = 'findings'
    WHERE q.id IS NULL
       OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(q.questions_json::jsonb) j
             WHERE j ->> 'key' = want.column3
               AND coalesce(j ->> 'required', 'false') = 'true'
               AND coalesce(j ->> 'default', '') <> ''
          );
  IF named_missing > 0 THEN
    RAISE EXCEPTION 'The non-MRI blanking file found none of, or left a default on, % of its named boxes ("Acute DVT", "Testicular Torsion", "Biophysical Profile Assessment") — the catalogue is not the one this file was written against.', named_missing;
  END IF;
END
$do$;

-- Nothing else on the row may move. The MRI rows are asserted untouched here rather than trusted:
-- this file's predicate excludes them, and a rule that reached them would be a second, different edit
-- to boxes the owner already ruled on.
DO $do$
declare
  mri_touched int;
begin
  SELECT count(*) INTO mri_touched
    FROM radiology_quick_findings q
   WHERE q.is_active
     AND coalesce(q.field, 'findings') = 'findings'
     AND coalesce(q.scope_modality, '') IN ('', 'MR')
     AND lower(trim(coalesce(q.study_type, '')))
         IN ('brain', 'cervical spine', 'dorsal spine', 'ls spine', 'whole spine', 'spine')
     AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(q.questions_json::jsonb) j
            WHERE coalesce(j ->> 'required', 'false') = 'true'
              AND coalesce(j ->> 'default', '') <> ''
              AND (
                    lower(j ->> 'default') IN ('present','absent','reactive','non-reactive',
                                               'non reactive','normal','increased','decreased',
                                               'reduced','maintained')
                 OR j ->> 'key' IN ('side','level','size')
              )
         );
  IF mri_touched > 0 THEN
    RAISE EXCEPTION 'This non-MRI file matched % MRI-study-type row(s) — the predicates of the two files are meant to be disjoint.', mri_touched;
  END IF;
END
$do$;

COMMIT;
