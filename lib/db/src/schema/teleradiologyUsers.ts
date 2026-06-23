import { pgTable, serial, text, boolean, timestamp, integer, index } from "drizzle-orm/pg-core";

/**
 * Teleradiology portal users — external/night radiologists who access the
 * portal at /teleradiology independently of the main staff ERP login.
 */
export const teleradiologyUsersTable = pgTable("teleradiology_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  pinHash: text("pin_hash").notNull(),             // bcrypt hash
  role: text("role").notNull().default("TELERADIOLOGIST"), // TELERADIOLOGIST | EXTERNAL_RADIOLOGIST
  specialty: text("specialty"),
  qualifications: text("qualifications"),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
  canDoFinalReport: boolean("can_do_final_report").notNull().default(false),
  canUseAI: boolean("can_use_ai").notNull().default(false),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Short-lived sessions for teleradiology portal logins. */
export const teleradiologySessionsTable = pgTable("teleradiology_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Assignment of a radiology study to a teleradiologist. */
export const teleradiologyAssignmentsTable = pgTable(
  "teleradiology_assignments",
  {
    id: serial("id").primaryKey(),
    studyId: integer("study_id").notNull(),
    teleradiologistId: integer("teleradiologist_id").notNull(),
    priority: text("priority").notNull().default("ROUTINE"), // ROUTINE | URGENT | STAT
    assignedBy: text("assigned_by"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    deadline: timestamp("deadline", { withTimezone: true }),
    status: text("status").notNull().default("assigned"), // assigned | in_progress | submitted | completed
    isCritical: boolean("is_critical").notNull().default(false),
    comments: text("comments"),
    prelimReport: text("prelim_report"),
    finalReport: text("final_report"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    unassignedAt: timestamp("unassigned_at", { withTimezone: true }),
    unassignedBy: text("unassigned_by"),
  },
  (t) => ({
    byStudy: index("tele_assign_study_idx").on(t.studyId),
    byUser: index("tele_assign_user_idx").on(t.teleradiologistId),
  }),
);

export type TeleradiologyUser = typeof teleradiologyUsersTable.$inferSelect;
export type TeleradiologySession = typeof teleradiologySessionsTable.$inferSelect;
export type TeleradiologyAssignment = typeof teleradiologyAssignmentsTable.$inferSelect;
