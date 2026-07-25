-- ============================================================================
-- Expense creator/approver separation-of-duties toggle.
--
-- expenses.created_by — session-derived actor at creation time (never
-- client-editable, same convention as the audit actors added to bills.ts).
-- Nullable and backfilled to NULL for existing rows: their real creator was
-- never recorded, and inventing one would misattribute history.
--
-- clinic_settings.expense_self_approval_allowed — admin-configurable toggle.
-- Defaults to TRUE (self-approval allowed), which matches current behaviour
-- exactly: approvedBy has always been free text set by whoever creates the
-- expense, so this migration changes nothing about today's app behaviour. An
-- admin can flip it off from Settings once there is enough staff for the
-- creator/approver split to be practical — see routes/clinicSettings.ts
-- boolFields and routes/expenses.ts for where it is read.
-- ============================================================================

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS created_by TEXT;

ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS expense_self_approval_allowed BOOLEAN NOT NULL DEFAULT TRUE;
