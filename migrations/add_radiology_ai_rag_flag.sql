-- CARE Local Radiology RAG — the owner's decision to ship it ENABLED.
--
-- WHAT THIS DOES
--   Creates the `ff_radiology_ai_rag` row with enabled = true. That key was introduced by
--   the radiology RAG work (Composer reference knowledge): before this file it existed only
--   as a manual INSERT in docs/CARE_RAG_KNOWLEDGE_PACKAGING.md, so on every fresh database the
--   flag read as OFF (isFeatureEnabledServer returns `flags[key] ?? false`) and the feature
--   silently did nothing. A default that lives in a document is not a default.
--
-- WHY THIS ONE FLAG DEFAULTS ON, when every other radiology flag seeds OFF
--   Owner decision, 2026-11-03: the AI radiology reporting workspace is experimental and is not
--   used for routine clinical reporting, so reference knowledge is enabled by default while it is
--   evaluated. It changes wording and interpretation only. It cannot add a finding, side, level,
--   measurement or diagnosis the radiologist's own text does not already support (the shipped
--   reference-knowledge rules in reportComposer/knowledgeRetrieval.ts), retrieved text never
--   enters any grounding corpus, the existing clinical validation still refuses unsupported
--   statements, and a draft still requires the radiologist to review and apply it — nothing here
--   authorizes, signs or finalizes a report.
--
-- WHY `DO NOTHING` AND NOT `DO UPDATE ... SET enabled = true`
--   So the flag stays switchable. `zzz_enable_ff_radiology_ai_ollama_onprem.sql` deliberately
--   forces its key back on at every deploy; doing that here would mean an operator who switched
--   RAG OFF to troubleshoot a report would find it switched back on by the next deploy. With
--   DO NOTHING, the ON is the starting value, never a repeated one: after this runs once,
--   PATCH /api/feature-flags/ff_radiology_ai_rag is the only thing that decides.
--
--   CREATE TABLE IF NOT EXISTS is not needed: aaaa_bootstrap_feature_flags.sql (which sorts
--   before this file) creates the table, and scripts/check-migration-order.cjs enforces that
--   ordering before any SQL runs.
--
-- ROLLBACK (manual, and the state the feature was shipped in until 2026-11-03)
--   UPDATE feature_flags SET enabled = false, updated_at = now() WHERE key = 'ff_radiology_ai_rag';
--   With the flag off the Composer's request is byte-identical to the pre-RAG request.

INSERT INTO feature_flags (key, enabled, description, updated_by)
VALUES (
  'ff_radiology_ai_rag',
  true,
  'Composer reference knowledge — retrieve CARE''s own radiology documents into the TEXT_ONLY prompt (local/Ollama path). Ships enabled by the owner''s 2026-11-03 decision while the AI reporting workspace stays experimental; PATCH to false returns the prompt byte-for-byte to pre-RAG.',
  'owner-decision-2026-11-03'
)
ON CONFLICT (key) DO NOTHING;
