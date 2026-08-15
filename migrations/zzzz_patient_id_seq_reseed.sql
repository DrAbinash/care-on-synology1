-- Reseed patient_id_seq forward to the true MAX existing UHID.
--
-- After zzzz_patient_id_seq.sql first applied, the old MAX+1 / advisory-lock
-- allocator could still mint higher P-##### values before care-api was rebuilt.
-- Production then failed Register with:
--   duplicate key value violates unique constraint "patients_patient_id_unique"
--   Key (patient_id)=(P-01736) already exists.
--
-- Always bump the sequence forward (never rewind). Safe to re-run.

CREATE SEQUENCE IF NOT EXISTS patient_id_seq;

DO $$
DECLARE
  max_existing bigint := 0;
  seq_at bigint := 0;
  target bigint := 0;
BEGIN
  SELECT COALESCE(
    MAX(
      CASE
        WHEN patient_id ~ '^P-?[0-9]+$'
          THEN regexp_replace(patient_id, '^P-?', '')::bigint
        ELSE NULL
      END
    ),
    0
  )
  INTO max_existing
  FROM patients;

  BEGIN
    SELECT GREATEST(max_existing, COALESCE((SELECT MAX(counter) FROM patient_counter), 0))
      INTO max_existing;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- Current "high water" already consumed by the sequence (if is_called).
  SELECT CASE
           WHEN is_called THEN last_value
           ELSE GREATEST(last_value - 1, 0)
         END
    INTO seq_at
    FROM patient_id_seq;

  target := GREATEST(max_existing, seq_at);

  IF target > 0 THEN
    -- next nextval = target + 1
    PERFORM setval('patient_id_seq', target, true);
  ELSE
    PERFORM setval('patient_id_seq', 1, false);
  END IF;
END $$;
