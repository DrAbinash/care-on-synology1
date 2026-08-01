-- Clinic-wide commission slabs: doctor_id NULL means the rule applies to every
-- referring doctor. Doctor-specific rows still take precedence when both match.
ALTER TABLE commission_rules ALTER COLUMN doctor_id DROP NOT NULL;
