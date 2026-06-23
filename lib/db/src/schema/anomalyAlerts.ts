import {
  pgTable, serial, integer, text, timestamp, index,
} from "drizzle-orm/pg-core";

// Phase 7: Anomaly Detection / Alerting
// Stores alerts for unusual patterns in radiology workflow and AI quality.
// Alert types: LOW_CONFIDENCE_DRAFT | HIGH_FEEDBACK_REJECT | BACKLOG_SPIKE |
//              LONG_TURNAROUND | UNASSIGNED_STUDY | AI_ERROR_RATE_SPIKE
// Severity: low | medium | high | critical
// Status: open | acknowledged | resolved | ignored
export const anomalyAlertsTable = pgTable(
  "anomaly_alerts",
  {
    id: serial("id").primaryKey(),
    alertType: text("alert_type").notNull(),
    severity: text("severity").notNull().default("medium"),
    message: text("message").notNull(),
    scope: text("scope"),                    // e.g. "radiology_worklist" or "ai_reporting"
    relatedId: integer("related_id"),        // FK to the scoped entity
    relatedTable: text("related_table"),     // table name for reference
    status: text("status").notNull().default("open"), // open | acknowledged | resolved | ignored
    acknowledgedById: integer("acknowledged_by_id"),
    acknowledgedByName: text("acknowledged_by_name"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    typeIdx: index("anomaly_alert_type_idx").on(t.alertType),
    severityIdx: index("anomaly_alert_severity_idx").on(t.severity),
    statusIdx: index("anomaly_alert_status_idx").on(t.status),
    scopeIdx: index("anomaly_alert_scope_idx").on(t.scope, t.relatedId),
  }),
);
export type AnomalyAlert = typeof anomalyAlertsTable.$inferSelect;
