-- Critical-result COMMUNICATION workflow in the Radiology Reporting Workspace.
-- Default OFF. No DDL: one row in feature_flags, which aaaa_bootstrap_feature_flags.sql
-- creates before every add_* migration runs, so this INSERT always finds the table.
--
-- WHAT THE FLAG COVERS (the whole incomplete communication workflow, not a
-- subset — a half-gated flag would leave a signing block reachable with no way
-- to satisfy it):
--   * the pre-sign critical acknowledgement block in the Finalize dialog
--   * the interrupt card and the 15-minute SLA timer in the workspace
--   * the copilot "critical results safety" reminders
--   * the "Mark Critical Finding" panel + Communication Checklist
--   * the standalone Critical Findings page, its nav item, its route and its
--     command-palette entry
--   * GET/POST/PATCH /api/ai-reporting/critical-findings (404 when OFF, so a
--     direct API call is gated too — not just the UI)
--
-- WHAT THE FLAG DELIBERATELY DOES NOT COVER (untouched, always live):
--   * the finding DETECTOR (lib/criticalResults.ts detectCriticalFindings)
--   * the radiology_critical_findings table and every existing row
--   * the PACS dashboard critical alerts widget
--   * /api/radiology/critical-findings
--
-- This centre does not currently follow a formal critical-result
-- communication protocol, so the workflow ships switched off rather than being
-- deleted: turning the flag back on restores every surface above with no
-- migration and no data loss.

INSERT INTO feature_flags (key, description) VALUES
  ('ff_radiology_critical_result_comms', 'Critical-result communication workflow in the Radiology Reporting Workspace: the pre-sign acknowledgement block, the interrupt card, the 15-minute SLA timer, the copilot reminders, the Mark Critical Finding panel and the Critical Findings page. OFF means none of these appear and /api/ai-reporting/critical-findings returns 404. The finding detector, the radiology_critical_findings table and its existing rows, the PACS critical alerts widget and /api/radiology/critical-findings are unaffected either way. Safe to toggle at any time; no data is created or deleted by the toggle itself.')
ON CONFLICT (key) DO NOTHING;
