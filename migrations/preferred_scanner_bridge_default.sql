-- Restore flatbed / ScanBridge as the default preferred scanning source for Form F.
ALTER TABLE clinic_settings
  ALTER COLUMN preferred_scanner SET DEFAULT 'bridge';
