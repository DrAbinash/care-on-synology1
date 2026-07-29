-- Advisory structured-quality warnings in Finalize dialog (analysis item 3).
-- Default OFF. Enable after ff_radiology_structured_d1_draft; before or with
-- ff_radiology_structured_final for progressive rollout.

INSERT INTO feature_flags (key, description) VALUES
  ('ff_radiology_quality_advisory', 'Show structured validation failures as advisory warnings in the Radiology Finalize dialog (non-blocking). Safe enable after ff_radiology_structured_d1_draft; escalate to ff_radiology_structured_final for blocking structured sign.')
ON CONFLICT (key) DO NOTHING;
