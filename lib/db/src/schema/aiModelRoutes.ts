import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── AI model routing (Phase 4: Model Routing) ───────────────────────────────
// Maps a logical AI "task" (e.g. clinical_notes, billing_insights,
// radiology_draft) to a specific provider + optional model. When a task has no
// active route, callers fall back to the global default provider, so this table
// is purely additive and non-breaking.
export const aiModelRoutesTable = pgTable(
  "ai_model_routes",
  {
    id: serial("id").primaryKey(),
    taskKey: text("task_key").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    isActive: boolean("is_active").notNull().default(true),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // One route per task so resolution is deterministic.
    uniqueTask: uniqueIndex("ai_model_routes_task_uq").on(t.taskKey),
  }),
);

export type AiModelRoute = typeof aiModelRoutesTable.$inferSelect;
export type NewAiModelRoute = typeof aiModelRoutesTable.$inferInsert;
