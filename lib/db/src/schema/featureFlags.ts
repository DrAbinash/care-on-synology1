import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Server-side feature flag backbone (Radiology Implementation Roadmap,
// Ticket T0.1). Backs isFeatureEnabledServer() on the API side and the
// GET/PATCH /api/feature-flags endpoints. This table is authoritative ONLY
// for keys prefixed "ff_radiology_" — it does not replace or read the
// pre-existing client-only localStorage flags in
// artifacts/diagnostic-erp/src/lib/staffSession.ts (FEATURE_FLAG_DEFAULTS),
// which continue to work exactly as before for every other flag.
export const featureFlagsTable = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  description: text("description").notNull().default(""),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type FeatureFlag = typeof featureFlagsTable.$inferSelect;
