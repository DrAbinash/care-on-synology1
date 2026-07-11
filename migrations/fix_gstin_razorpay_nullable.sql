-- Fix: clinic_settings.gstin and .razorpay_key_id were created as
-- NOT NULL DEFAULT '', but the application deliberately writes NULL into
-- both columns to mean "not configured yet" (see the GSTIN_NOT_SET /
-- RZP_KEY_NOT_SET placeholder cleanup that already runs at startup).
--
-- This mismatch caused every settings save that left GST/Razorpay blank
-- to fail with:
--   ERROR: null value in column "gstin" violates not-null constraint
--
-- Safe, additive-style correction: relaxes the constraint to match the
-- app's actual intended semantics. No data is deleted or changed.

ALTER TABLE clinic_settings ALTER COLUMN gstin DROP NOT NULL;
ALTER TABLE clinic_settings ALTER COLUMN razorpay_key_id DROP NOT NULL;
