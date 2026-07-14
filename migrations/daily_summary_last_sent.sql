-- Persists the last date the SCHEDULED daily summary email actually sent,
-- so the cron scheduler can catch up after a container restart instead of
-- relying purely on an in-memory "fired today" set that resets to empty on
-- every process boot (root cause of the scheduled email silently not going
-- out — see cron.ts's scheduleDaily()/fireDailySummary()).
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, no default needed (NULL means
-- "never sent by the scheduler yet", which is the correct initial state).

ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS daily_summary_last_sent_date TEXT;
