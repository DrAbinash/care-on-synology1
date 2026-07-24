import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Server-side feature flag backbone (Radiology Implementation Roadmap,
// Ticket T0.1). Backs isFeatureEnabledServer() on the API side and the
// GET/PATCH /api/feature-flags endpoints. This table is authoritative for
// every "ff_"-prefixed rollout flag (ff_radiology_*, ff_hr_*, ff_ops_*,
// ff_recall_*, ff_feedback_*, ff_report_delivery_*, ff_abdm_*,
// ff_online_payment_*, ff_hope_care_*): the client hydrates all of them via
// useServerFeatureFlags so an admin PATCH here is what surfaces the matching
// nav item. It does NOT replace the pre-existing client-only localStorage
// preference flags in artifacts/diagnostic-erp/src/lib/staffSession.ts
// (FEATURE_FLAG_DEFAULTS) — those are non-"ff_"-prefixed and stay per-browser.
export const featureFlagsTable = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  description: text("description").notNull().default(""),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type FeatureFlag = typeof featureFlagsTable.$inferSelect;
