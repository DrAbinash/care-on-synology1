import { pgTable, serial, text, boolean, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Editable radiology findings library — the abnormal (and normal) findings
 * catalogue that powers the Report Builder / Library tab.
 *
 * Seeded from the mined house catalogue ("starter" rows) and then fully
 * editable: staff can add missed / new / new-style findings and modify or
 * (soft-)delete existing ones, organised by modality + organ (section). Every
 * modality (MRI / USG / CT / X-RAY) has its own Liver, Gall Bladder, Pancreas,
 * etc. rows.
 */
export const radiologyFindingLibraryTable = pgTable(
  "radiology_finding_library",
  {
    id: serial("id").primaryKey(),
    modality: text("modality").notNull(),        // CT | USG | MRI | XRAY
    section: text("section").notNull(),          // organ / region label: Liver | Gall Bladder | ...
    region: text("region"),                      // study region (optional): WHOLE_ABDOMEN | BRAIN | ...
    findingText: text("finding_text").notNull(), // the finding sentence
    isAbnormal: boolean("is_abnormal").notNull().default(true),
    isImpression: boolean("is_impression").notNull().default(false),
    frequency: integer("frequency").notNull().default(0), // usage weight from mining (0 for custom)
    source: text("source").notNull().default("custom"),   // starter | custom
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byModalitySection: index("rfl_modality_section_idx").on(t.modality, t.section),
    byActive: index("rfl_active_idx").on(t.isActive),
  }),
);

export type RadiologyFinding = typeof radiologyFindingLibraryTable.$inferSelect;
export type InsertRadiologyFinding = typeof radiologyFindingLibraryTable.$inferInsert;
