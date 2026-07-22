import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { patientsTable } from "./patients";

// ============================================================================
// HOPE ↔ CARE patient crosswalk.
//
// CARE must never blindly create a new patient per referral, and must never
// auto-merge two patients on name alone. This table is the persistent,
// audited link between a source-system patient (HOPE uhid) and a canonical
// CARE patient. It is ADDITIVE — it never adds a column to the core `patients`
// table (which is a protected/core entity).
//
// Exactly one CONFIRMED link may exist per (source_system, source_patient_id):
// enforced by a partial unique index in the migration. Probable/conflict rows
// can coexist until staff resolve them.
// ============================================================================
export const externalPatientLinksTable = pgTable("external_patient_links", {
  id: serial("id").primaryKey(),
  sourceSystem: text("source_system").notNull(), // "HOPE"
  sourcePatientId: text("source_patient_id").notNull(), // HOPE uhid
  carePatientId: integer("care_patient_id").references(() => patientsTable.id),
  // confirmed | probable | conflict | unlinked
  linkStatus: text("link_status").notNull().default("probable"),
  // existing_link | mobile | mobile_name | mobile_name_age | manual | created_new
  matchMethod: text("match_method").notNull().default(""),
  confidence: numeric("confidence", { precision: 5, scale: 2 }).notNull().default("0"),
  // Snapshot of the identity signals used, for audit/debugging.
  matchDetails: text("match_details"),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Full audit history of link / unlink / merge / confirm / conflict decisions.
export const externalPatientLinkEventsTable = pgTable("external_patient_link_events", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").references(() => externalPatientLinksTable.id),
  sourceSystem: text("source_system").notNull().default(""),
  sourcePatientId: text("source_patient_id").notNull().default(""),
  carePatientId: integer("care_patient_id"),
  // linked | confirmed | unlinked | merged | conflict_flagged | created_new | reused
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  actor: text("actor"),
  reason: text("reason"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExternalPatientLink = typeof externalPatientLinksTable.$inferSelect;
export type InsertExternalPatientLink = typeof externalPatientLinksTable.$inferInsert;
export type ExternalPatientLinkEvent = typeof externalPatientLinkEventsTable.$inferSelect;
