-- Registers ff_radiology_impression_engine (Ticket C1 — Unified Impression
-- Rule Engine). The feature_flags table itself already exists (see
-- add_radiology_feature_flags.sql, Ticket T0.1); this migration only adds
-- one more row to it.
--
-- Seeds enabled=false: no radiology behavior changes as a result of this
-- migration. Nothing in application code calls isFeatureEnabledServer() with
-- this key yet — see artifacts/api-server/src/lib/impressionRuleRepository.ts,
-- whose loadActiveImpressionRules() checks this flag and returns an empty
-- array while it is off, but is not itself called from any production route.

INSERT INTO feature_flags (key, description) VALUES
  ('ff_radiology_impression_engine', 'Unified impression rule engine — canonical model, evaluator, repository (Ticket C1). Not yet consumed by report rendering or Quick Select.')
ON CONFLICT (key) DO NOTHING;
