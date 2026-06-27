-- =============================================================================
-- A8: AI Contribution Percentage tracking on report drafts
-- Adds ai_contribution_pct column to radiology_report_drafts.
-- Records what % of the final report text was inserted by AI vs typed by radiologist.
-- Feeds into /api/radiology/my-analytics AI Prompt Activity section.
-- =============================================================================
ALTER TABLE IF EXISTS radiology_report_drafts
  ADD COLUMN IF NOT EXISTS ai_contribution_pct real;
