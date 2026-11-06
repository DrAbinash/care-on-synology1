-- =============================================================================
-- MRI Quick Select: a required answer must never arrive pre-filled
-- =============================================================================
-- WHY THIS FILE EXISTS
-- The owner's rule for this catalogue is that a box asks, and the radiologist answers: "A finding
-- requiring laterality must not silently assume a side", and the same for a level or a measurement.
-- The boxes this branch converts carry no defaults at all. Three rows already on the MRI walls do,
-- and a default on a REQUIRED question is not a convenience — the details form opens with Apply
-- already enabled, so one click reports an anatomy nobody chose:
--   * #48  "Acute Infarct"       (Brain)            side = "right", territory = "MCA"
--   * #71  "Disc Bulge"          (LS Spine)         level = "L4-L5"
--   * #72  "Disc Bulge"          (Cervical Spine)   level = "C5-C6"
-- Measured, not assumed: this is every active MRI-visible findings row (scope_modality '' or 'MR',
-- study_type Brain / Cervical Spine / Dorsal Spine / LS Spine / Whole Spine / Spine) whose
-- questions_json declares a required question with a non-empty default — 3 rows out of the wall.
-- An acute infarct reported as right-sided because a seed said so is the class of defect that
-- reaches a signed report, so it is fixed here rather than left as a note.

BEGIN;

-- Only the answer, only where nothing has been changed at the desk. `questions_json` is the whole
-- parameter contract of the box, so it is rewritten in place with every other field of each
-- question — key, label, type, options, order — carried through untouched, and `default` is set to
-- the empty string (which is what the composer's own refusal reads: "Nothing was applied — choose
-- the side"). A clinic-customised box is the radiologist's, not this file's to edit, so
-- `customized_at IS NULL` is part of the predicate; the guard below does not require those rows.
UPDATE radiology_quick_findings q
   SET questions_json = (
         SELECT COALESCE(jsonb_agg(
                  CASE
                    WHEN coalesce(j ->> 'required', 'false') = 'true'
                     AND coalesce(j ->> 'default', '') <> ''
                      THEN jsonb_set(j, '{default}', '""'::jsonb, true)
                    ELSE j
                  END
                  ORDER BY ord), '[]'::jsonb)::text
           FROM jsonb_array_elements(q.questions_json::jsonb) WITH ORDINALITY t(j, ord)
       )
 WHERE q.is_active
   AND coalesce(q.field, 'findings') = 'findings'
   AND coalesce(q.scope_modality, '') IN ('', 'MR')
   AND lower(trim(coalesce(q.study_type, '')))
       IN ('brain', 'cervical spine', 'dorsal spine', 'ls spine', 'whole spine', 'spine')
   AND q.customized_at IS NULL
   AND btrim(coalesce(q.questions_json, '')) LIKE '[%'
   AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(q.questions_json::jsonb) j
          WHERE coalesce(j ->> 'required', 'false') = 'true'
            AND coalesce(j ->> 'default', '') <> ''
       );

-- The three rows named above are the point of this file, so their absence is a failure, not a
-- warning. The check reads the same predicate the UPDATE applies, which means it can only trip when
-- the UPDATE above was not run — a deploy against a database where these ids belong to something
-- else is refused rather than quietly half-patched.
DO $do$
declare
  remaining int;
begin
  SELECT count(*) INTO remaining
    FROM radiology_quick_findings q
   WHERE q.is_active
     AND coalesce(q.field, 'findings') = 'findings'
     AND coalesce(q.scope_modality, '') IN ('', 'MR')
     AND lower(trim(coalesce(q.study_type, '')))
         IN ('brain', 'cervical spine', 'dorsal spine', 'ls spine', 'whole spine', 'spine')
     AND q.id IN (48, 71, 72)
     AND btrim(coalesce(q.questions_json, '')) LIKE '[%'
     AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(q.questions_json::jsonb) j
            WHERE coalesce(j ->> 'required', 'false') = 'true'
              AND coalesce(j ->> 'default', '') <> ''
         );
  IF remaining > 0 THEN
    RAISE EXCEPTION 'MRI Quick Select still pre-fills a required answer on % of boxes #48/#71/#72 — a one-click side or level is a claim the radiologist never made.', remaining;
  END IF;
END
$do$;

-- Nothing else on the row may move, and no other row may be touched: the same guard the converting
-- files use, in reverse. Only the answers changed, and `customized_at` is still NULL on every row
-- this file wrote, so a later clinic edit remains the clinic's own.
COMMIT;
