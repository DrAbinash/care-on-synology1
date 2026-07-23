import {
  pgTable, serial, integer, text, date, timestamp, index,
} from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { usersTable } from "./users";

/**
 * Disciplinary case management — formal actions beyond performance events, with
 * a defensible workflow (draft → issued → responded → inquiry → closed) and the
 * existing hash-chained audit for legal defensibility. Confidential. Additive,
 * non-financial (a suspension here does NOT change payroll). Gated by
 * ff_hr_disciplinary.
 */
export const disciplinaryActionsTable = pgTable(
  "disciplinary_actions",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "restrict" }),
    // verbal_warning | written_warning | show_cause | suspension | inquiry | termination_notice
    type: text("type").notNull(),
    severity: text("severity").notNull().default("minor"), // minor | major | critical
    reason: text("reason").notNull(),
    description: text("description"),
    incidentDate: date("incident_date"),
    // draft | issued | responded | under_inquiry | closed | withdrawn
    status: text("status").notNull().default("draft"),
    issuedByUserId: integer("issued_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    issuedByName: text("issued_by_name"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    employeeResponse: text("employee_response"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    evidenceStorageKey: text("evidence_storage_key"),
    outcome: text("outcome"),
    closedByUserId: integer("closed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    relatedEventId: integer("related_event_id"), // optional link to a performance_events row
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    staffIdx: index("disciplinary_actions_staff_idx").on(t.staffId),
    statusIdx: index("disciplinary_actions_status_idx").on(t.status),
  }),
);

export type DisciplinaryAction = typeof disciplinaryActionsTable.$inferSelect;
