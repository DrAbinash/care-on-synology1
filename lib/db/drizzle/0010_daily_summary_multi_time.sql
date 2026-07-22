ALTER TABLE "email_settings" ADD COLUMN IF NOT EXISTS "daily_summary_times" text NOT NULL DEFAULT '["17:00"]';
--> statement-breakpoint
ALTER TABLE "email_settings" ADD COLUMN IF NOT EXISTS "daily_summary_last_sent_slots" text NOT NULL DEFAULT '{}';
--> statement-breakpoint
UPDATE "email_settings" SET "daily_summary_times" = json_build_array("daily_summary_time")::text WHERE "daily_summary_time" IS NOT NULL;
--> statement-breakpoint
UPDATE "email_settings" SET "daily_summary_last_sent_slots" = json_build_object("daily_summary_time", "daily_summary_last_sent_date")::text WHERE "daily_summary_last_sent_date" IS NOT NULL AND "daily_summary_time" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_settings" DROP COLUMN IF EXISTS "daily_summary_time";
--> statement-breakpoint
ALTER TABLE "email_settings" DROP COLUMN IF EXISTS "daily_summary_last_sent_date";
