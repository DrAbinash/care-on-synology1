import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { patientsTable } from "./patients";

// ABDM / ABHA integration (additive scaffold). See
// docs/CARE_ERP_ABDM_INTEGRATION.md and migrations/add_abdm_abha_integration.sql.
// Inert until ABDM_ENABLED=true and gateway credentials are configured.

// A patient's ABHA (Ayushman Bharat Health Account) identity.
export const abhaLinksTable = pgTable("abha_links", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  abhaNumber: text("abha_number"),        // 14-digit, formatted XX-XXXX-XXXX-XXXX
  abhaAddress: text("abha_address"),      // e.g. asha@sbx / asha@abdm
  name: text("name"),
  gender: text("gender"),
  yearOfBirth: integer("year_of_birth"),
  status: text("status").notNull().default("linked"), // linked | unlinked | pending
  linkedVia: text("linked_via"),          // aadhaar-otp | mobile-otp | demographic
  verified: boolean("verified").notNull().default(false),
  raw: jsonb("raw"),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// CARE records made discoverable in the patient's PHR app under their ABHA.
export const abdmCareContextsTable = pgTable("abdm_care_contexts", {
  id: serial("id").primaryKey(),
  abhaLinkId: integer("abha_link_id").notNull().references(() => abhaLinksTable.id),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  careContextRef: text("care_context_ref").notNull(), // stable CARE ref, e.g. order:ORD-2026-0001
  display: text("display").notNull(),
  hiType: text("hi_type").notNull().default("DiagnosticReport"),
  linked: boolean("linked").notNull().default(false),
  linkedAt: timestamp("linked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Consent artefacts granted by the ABDM Consent Manager that authorise sharing.
export const abdmConsentArtefactsTable = pgTable("abdm_consent_artefacts", {
  id: serial("id").primaryKey(),
  consentId: text("consent_id").notNull(),
  patientId: integer("patient_id").references(() => patientsTable.id),
  abhaAddress: text("abha_address"),
  purposeCode: text("purpose_code"),
  purposeText: text("purpose_text"),
  hiuId: text("hiu_id"),
  status: text("status").notNull().default("REQUESTED"), // REQUESTED|GRANTED|DENIED|EXPIRED|REVOKED
  hiTypes: text("hi_types"),
  dateRangeFrom: timestamp("date_range_from", { withTimezone: true }),
  dateRangeTo: timestamp("date_range_to", { withTimezone: true }),
  expiry: timestamp("expiry", { withTimezone: true }),
  grantedAt: timestamp("granted_at", { withTimezone: true }),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Audit log of every gateway interaction (outbound calls + inbound callbacks).
export const abdmGatewayLogTable = pgTable("abdm_gateway_log", {
  id: serial("id").primaryKey(),
  direction: text("direction").notNull(), // out | in
  endpoint: text("endpoint").notNull(),
  requestId: text("request_id"),
  correlationId: text("correlation_id"),
  statusCode: integer("status_code"),
  ok: boolean("ok").notNull().default(false),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAbhaLinkSchema = createInsertSchema(abhaLinksTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAbdmCareContextSchema = createInsertSchema(abdmCareContextsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAbdmConsentArtefactSchema = createInsertSchema(abdmConsentArtefactsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type AbhaLink = typeof abhaLinksTable.$inferSelect;
export type AbdmCareContext = typeof abdmCareContextsTable.$inferSelect;
export type AbdmConsentArtefact = typeof abdmConsentArtefactsTable.$inferSelect;
export type AbdmGatewayLog = typeof abdmGatewayLogTable.$inferSelect;
export type InsertAbhaLink = z.infer<typeof insertAbhaLinkSchema>;
export type InsertAbdmCareContext = z.infer<typeof insertAbdmCareContextSchema>;
export type InsertAbdmConsentArtefact = z.infer<typeof insertAbdmConsentArtefactSchema>;
