import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

// Phase 19: AI Training Data Export
export const aiTrainingDataExportsTable = pgTable(
  "ai_training_data_exports",
  {
    id: serial("id").primaryKey(),
    exportName: text("export_name").notNull(),
    modality: text("modality"),
    dateFrom: text("date_from"),
    dateTo: text("date_to"),
    minQualityScore: integer("min_quality_score"),
    recordsCount: integer("records_count"),
    status: text("status").notNull().default("pending"), // pending | processing | ready | failed
    filePath: text("file_path"), // path to exported dataset
    exportedById: integer("exported_by_id"),
    exportedByName: text("exported_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    statusIdx: index("tde_status_idx").on(t.status),
    nameIdx: index("tde_name_idx").on(t.exportName),
  }),
);
export type AiTrainingDataExport = typeof aiTrainingDataExportsTable.$inferSelect;
