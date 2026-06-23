import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

// Phase 17: Peer Review Auto-Assignment
export const peerReviewAssignmentsTable = pgTable(
  "peer_review_assignments",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id").notNull(),
    worklistId: integer("worklist_id"),
    assignedToId: integer("assigned_to_id").notNull(),
    assignedToName: text("assigned_to_name"),
    assignedById: integer("assigned_by_id"),
    assignedByName: text("assigned_by_name"),
    priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
    status: text("status").notNull().default("pending"), // pending | in_review | approved | rejected
    aiConfidenceScore: integer("ai_confidence_score"),
    autoAssignedReason: text("auto_assigned_reason"), // e.g. "LOW_AI_CONFIDENCE"
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedNotes: text("completed_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    reportIdx: index("pra_report_idx").on(t.reportId),
    assigneeIdx: index("pra_assignee_idx").on(t.assignedToId, t.status),
    statusIdx: index("pra_status_idx").on(t.status),
  }),
);
export type PeerReviewAssignment = typeof peerReviewAssignmentsTable.$inferSelect;
