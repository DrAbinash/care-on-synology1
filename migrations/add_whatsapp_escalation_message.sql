-- Adds the admin-configurable escalation/hand-off message to
-- whatsapp_settings. See lib/db/src/schema/whatsappSettings.ts's
-- aiEscalationMessage column comment for why this is a single setting
-- rather than a full Escalation Rules table — there is exactly one real
-- escalation trigger implemented anywhere in this codebase today
-- (Knowledge Base no-match), so a rules engine would have nothing real
-- to route beyond this one message.

ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS ai_escalation_message TEXT NOT NULL DEFAULT '';
