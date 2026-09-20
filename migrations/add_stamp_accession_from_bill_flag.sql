-- Opt-in feature flag: stamp empty Orthanc AccessionNumber from bill number
-- on single-hit USG matches (STAMP_ACCESSION_FROM_BILL). Default OFF.
INSERT INTO feature_flags (key, enabled, description)
VALUES (
  'STAMP_ACCESSION_FROM_BILL',
  false,
  'When ON: after USG bill create, stamp Orthanc AccessionNumber (00080050) from bill number on single-hit empty-accession studies. Never overwrites non-empty. Audit ACCESSION_STAMPED.'
)
ON CONFLICT (key) DO NOTHING;
