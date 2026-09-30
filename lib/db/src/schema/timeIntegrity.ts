import { pgTable, text, integer, bigint, timestamp, index, jsonb } from "drizzle-orm/pg-core";

/**
 * CARE business-time integrity — the forward-only cutover row.
 *
 * DDL lives in `migrations/add_time_integrity_cutover_and_events_20261001.sql`,
 * which also installs the guards this declaration cannot express: the
 * cutover instant may never move backwards, and the row may never be deleted
 * (deleting it would silently switch enforcement off). The boundary is stamped
 * by Postgres at migration time, so "before or after enforcement" is answered by
 * the database, not by an app server clock or a form field.
 */
export const careTimeIntegrityPolicyTable = pgTable("care_time_integrity_policy", {
  /** Always 1 — a singleton, enforced by CHECK in SQL. */
  id: integer("id").primaryKey(),
  enforcementCutoverAt: timestamp("enforcement_cutover_at", { withTimezone: true }).notNull().defaultNow(),
  cutoverSource: text("cutover_source").notNull().default("postgres-migration-now"),
  setBySubjectId: integer("set_by_subject_id"),
  setAt: timestamp("set_at", { withTimezone: true }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export type CareTimeIntegrityPolicy = typeof careTimeIntegrityPolicyTable.$inferSelect;

/**
 * Append-only evidence of business-date decisions. Written after cutover only,
 * and never updated: the row-level guard rejects UPDATE/DELETE and a
 * statement-level guard rejects TRUNCATE.
 *
 * Columns are nullable on purpose apart from what the guard always knows. An
 * evidence write must not be able to fail because of a constraint, and nothing
 * here holds a request body, a token, or patient data.
 */
export const careTimeIntegrityEventsTable = pgTable(
  "care_time_integrity_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    /** Class D — the database clock. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    trustedClinicDate: text("trusted_clinic_date").notNull(),
    event: text("event").notNull(),
    outcome: text("outcome").notNull(),
    code: text("code"),
    attemptedBusinessDate: text("attempted_business_date"),
    endpoint: text("endpoint"),
    method: text("method"),
    module: text("module"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    /** The authority for "who", from the authenticated session. */
    actorSubjectId: integer("actor_subject_id"),
    actorRole: text("actor_role"),
    actorDisplayName: text("actor_display_name"),
    identitySource: text("identity_source").notNull().default("authenticated-session"),
    reason: text("reason"),
    approverSubjectId: integer("approver_subject_id"),
    requestId: text("request_id"),
    metaJson: jsonb("meta_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOccurredIdx: index("care_time_integrity_events_occurred_idx").on(t.occurredAt),
    byActorIdx: index("care_time_integrity_events_actor_idx").on(t.actorSubjectId, t.occurredAt),
    byKindIdx: index("care_time_integrity_events_kind_idx").on(t.event, t.outcome, t.occurredAt),
  }),
);

export type CareTimeIntegrityEvent = typeof careTimeIntegrityEventsTable.$inferSelect;
