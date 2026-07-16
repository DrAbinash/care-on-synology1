-- add_measurement_registry_ids.sql — Universal Measurement Platform foundation.
--
-- Adds the nullable canonical-id column that lets stored measurements carry
-- their Universal Measurement Registry identity (e.g. 'CBD', 'MIDLINE_SHIFT')
-- alongside the legacy free-text label. Additive only: existing rows keep
-- working with measurement_id NULL, and every write path treats the column as
-- optional. The registry itself lives in code (lib/measurements — the same
-- registry-as-code pattern as the quality-rule catalog), so no registry table
-- is created here.

ALTER TABLE radiology_measurements ADD COLUMN IF NOT EXISTS measurement_id TEXT;
ALTER TABLE viewer_measurements ADD COLUMN IF NOT EXISTS measurement_id TEXT;

-- Impact-analysis + comparison lookups filter by canonical id.
CREATE INDEX IF NOT EXISTS radiology_measurements_measurement_id_idx
  ON radiology_measurements (measurement_id) WHERE measurement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS viewer_measurements_measurement_id_idx
  ON viewer_measurements (measurement_id) WHERE measurement_id IS NOT NULL;
