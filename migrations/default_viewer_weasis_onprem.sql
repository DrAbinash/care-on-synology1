-- On-prem clinic installs prefer Weasis (native LAN viewer) over OHIF web viewer.
UPDATE pacs_settings
SET value = 'WEASIS', updated_at = NOW()
WHERE key = 'default_viewer'
  AND category = 'viewer'
  AND value = 'OHIF';
