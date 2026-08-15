-- Atomic patient UHID (P-#####) allocation via PostgreSQL SEQUENCE (nextval).
-- Replaces MAX(patient_id)+1 under a session-scoped pg_advisory_lock.
--
-- Why: api-server uses a node-postgres Pool. Session advisory locks acquired
-- via drizzle `db.execute` can land on connection A while unlock runs on
-- connection B, so the lock is never released. CSV import also called
-- generatePatientId() without unlocking. Concurrent Billing Desk
-- "Register & Select" then hangs on pg_advisory_lock until the gateway
-- times out ("internal server error" / ERP unreachable banner).

CREATE SEQUENCE IF NOT EXISTS patient_id_seq;

DO $$
DECLARE
  seed bigint;
BEGIN
  -- Numeric suffix of P-##### / P##### style IDs (ignore non-numeric junk).
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
  INTO seed
  FROM patients;

  -- Also consider legacy patient_counter table if present and higher.
  BEGIN
    SELECT GREATEST(seed, COALESCE((SELECT MAX(counter) FROM patient_counter), 0))
      INTO seed;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  IF seed > 0 THEN
    PERFORM setval('patient_id_seq', seed, true);  -- next nextval = seed+1
  ELSE
    PERFORM setval('patient_id_seq', 1, false);     -- next nextval = 1
  END IF;
END $$;
