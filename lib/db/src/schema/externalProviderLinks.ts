import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { doctorsTable } from "./doctors";

// ============================================================================
// HOPE ↔ CARE referring-doctor crosswalk.
//
// The HOPE prescriber (HOPE doctors.id + name + specialization + reg no) is
// mapped to a canonical CARE `doctors` row so the referring doctor propagates
// onto the CARE order (orders.doctor_id) and, from there, onto pathology &
// radiology worklists and Form F — exactly like a normal walk-in referral.
//
// On first sight of an unknown HOPE doctor the resolver creates a CARE doctors
// row (idempotent-by-name, mirroring scripts/import-referral-doctors.ts) and
// records the link here. Never modifies the core `doctors` schema.
// ============================================================================
export const externalProviderLinksTable = pgTable("external_provider_links", {
  id: serial("id").primaryKey(),
  sourceSystem: text("source_system").notNull(), // "HOPE"
  sourceProviderId: text("source_provider_id").notNull(), // HOPE doctor id
  sourceProviderName: text("source_provider_name").notNull().default(""),
  sourceSpecialization: text("source_specialization"),
  sourceRegistrationNo: text("source_registration_no"),
  careDoctorId: integer("care_doctor_id").references(() => doctorsTable.id),
  // confirmed | probable | created_new
  linkStatus: text("link_status").notNull().default("confirmed"),
  // existing_link | name | registration_no | manual | created_new
  matchMethod: text("match_method").notNull().default(""),
  confidence: numeric("confidence", { precision: 5, scale: 2 }).notNull().default("0"),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ExternalProviderLink = typeof externalProviderLinksTable.$inferSelect;
export type InsertExternalProviderLink = typeof externalProviderLinksTable.$inferInsert;
