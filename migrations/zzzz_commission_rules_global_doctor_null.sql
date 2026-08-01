-- Clinic-wide commission slabs: doctor_id NULL means the rule applies to every
-- referring doctor. Doctor-specific rows still take precedence when both match.
-- Idempotent: only relaxes NOT NULL when the column is still constrained.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'commission_rules'
      AND column_name = 'doctor_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE commission_rules ALTER COLUMN doctor_id DROP NOT NULL;
  END IF;
END $$;
