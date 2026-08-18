-- Referring-doctor degree / qualification for radiology reporting (REF. BY).
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "degree" text;
