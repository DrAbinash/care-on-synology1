-- Product default for Form F ID scan: Webcam (camera), not Wireless Mobile.
-- Also widens the documented allowed values to camera | bridge | mobile
-- (the API previously rejected "camera", so Webcam could not be saved).
ALTER TABLE clinic_settings
  ALTER COLUMN preferred_scanner SET DEFAULT 'camera';

UPDATE clinic_settings
SET preferred_scanner = 'camera'
WHERE preferred_scanner = 'mobile';
