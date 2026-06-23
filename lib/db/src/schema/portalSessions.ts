import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";

export const portalSessionsTable = pgTable(
  "portal_sessions",
  {
    id: serial("id").primaryKey(),
    token: text("token").notNull().unique(),
    scope: text("scope").notNull(), // 'patient' | 'staff'
    subjectId: integer("subject_id").notNull(),
    subjectName: text("subject_name").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTokenIdx: index("portal_sessions_token_idx").on(t.token),
    bySubjectIdx: index("portal_sessions_subject_idx").on(t.scope, t.subjectId),
    byCreatedIdx: index("portal_sessions_created_idx").on(t.createdAt),
  }),
);

export type PortalSession = typeof portalSessionsTable.$inferSelect;
