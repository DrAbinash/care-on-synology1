import { pgTable, serial, integer, text, real, timestamp, index } from "drizzle-orm/pg-core";

// Phase 18: Turnaround Time Analytics
// Pre-computed daily snapshots for fast dashboard queries.
// Can also be computed on-the-fly from radiology_worklist + patient_reports.
export const turnaroundTimesTable = pgTable(
  "turnaround_times",
  {
    id: serial("id").primaryKey(),
    worklistId: integer("worklist_id").notNull(),
    studyId: integer("study_id"),
    modality: text("modality"),
    radiologistId: integer("radiologist_id"),
    radiologistName: text("radiologist_name"),
    // Minutes from study received to report finalized
    minutesToReport: real("minutes_to_report"),
    minutesToFirstReview: real("minutes_to_first_review"),
    minutesToPeerReview: real("minutes_to_peer_review"),
    // Date bucket for aggregation
    dateBucket: text("date_bucket").notNull(), // YYYY-MM-DD
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    wlIdx: index("tat_wl_idx").on(t.worklistId),
    dateIdx: index("tat_date_idx").on(t.dateBucket),
    modalityIdx: index("tat_modality_idx").on(t.modality, t.dateBucket),
    radIdx: index("tat_rad_idx").on(t.radiologistId, t.dateBucket),
  }),
);
export type TurnaroundTime = typeof turnaroundTimesTable.$inferSelect;
