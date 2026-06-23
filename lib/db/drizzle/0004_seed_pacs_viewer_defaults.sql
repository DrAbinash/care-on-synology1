-- Seed default PACS viewer settings so OHIF / Weasis work out of the box
-- Safe to re-run — uses DO block + ON CONFLICT

-- Add unique constraint on (key, category) if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pacs_settings_key_category_unique'
    AND conrelid = 'pacs_settings'::regclass
  ) THEN
    ALTER TABLE pacs_settings
      ADD CONSTRAINT pacs_settings_key_category_unique
      UNIQUE (key, category);
  END IF;
END $$;

-- Default OHIF viewer settings (used by Conquest + OHIF on local network)
INSERT INTO pacs_settings (key, value, category) VALUES
  ('ohif_base_url',          'http://172.16.1.139:3000', 'viewer'),
  ('dicom_web_base_url',     'http://172.16.1.139:8042/dicom-web', 'viewer'),
  ('ohif_study_url_template', '{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}', 'viewer'),
  ('viewer_mode',            'BOTH', 'viewer'),
  ('default_viewer',         'OHIF', 'viewer'),
  ('ohif_enabled',           'true', 'viewer'),
  ('weasis_enabled',         'true', 'viewer'),
  ('viewer_open_mode',       'NEW_TAB', 'viewer'),
  ('allow_public_viewer_links', 'false', 'viewer'),
  ('pacs_ip',                '172.16.1.139', 'viewer'),
  ('pacs_port',              '5680', 'viewer'),
  ('pacs_ae_title',          'ORTHANC2', 'viewer'),
  ('wado_base_url',          'http://172.16.1.139:8042/wado', 'viewer'),
  ('wado_uri_base_url',      'http://172.16.1.139:8042/wado', 'viewer')
ON CONFLICT (key, category) DO NOTHING;
