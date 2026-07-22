import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { patientsTable } from "./patients";
import { doctorsTable } from "./doctors";
import { ordersTable, orderTestsTable } from "./orders";
import { testsTable } from "./tests";
import { packagesTable } from "./packages";
import { externalPatientLinksTable } from "./externalPatientLinks";
import { integrationPartnersTable } from "./integrationPartners";
import { serviceCatalogueMappingsTable } from "./serviceCatalogueMappings";

// ============================================================================
// Diagnostic referral aggregate: HOPE → CARE.
//
// A referral is a clinical RECOMMENDATION, not a CARE invoice. It carries an
// immutable snapshot of the patient demographics + prescribed tests exactly as
// HOPE sent them, plus CARE-side resolution (matched patient, mapped tests,
// created order). Idempotency is enforced two ways: a unique immutable
// `referral_uuid` (the external identity) and a unique `idempotency_key` (per
// delivery) — re-sending the same prescription can never create a duplicate
// patient, order or bill.
//
// `care_order_id` / `care_order_test_id` reference the CANONICAL order tables;
// this integration never forks order/billing creation — it hands off to the
// existing, unmodified POST /api/orders + POST /api/bills.
// ============================================================================

// Referral header status — a validated state machine (see
// services/integration/referralStateMachine.ts).
export const REFERRAL_STATUSES = [
  "PRESCRIBED",
  "OFFERED_TO_CARE",
  "SENT_TO_CARE",
  "RECEIVED_BY_CARE",
  "PATIENT_CONTACTED",
  "PATIENT_ACCEPTED",
  "PATIENT_DECLINED",
  "CARE_ORDER_CREATED",
  "PARTIALLY_BOOKED",
  "BILLED",
  "PAID",
  "SAMPLE_COLLECTED",
  "STUDY_SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "REPORTED",
  "DELIVERED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const diagnosticReferralsTable = pgTable("diagnostic_referrals", {
  id: serial("id").primaryKey(),
  // Immutable external identity (idempotency anchor). Provided by HOPE or
  // generated on first receipt; UNIQUE.
  referralUuid: text("referral_uuid").notNull().unique(),
  // Per-delivery idempotency key (UNIQUE) — a retried POST replays, never dupes.
  idempotencyKey: text("idempotency_key").unique(),

  sourceOrg: text("source_org").notNull().default("HOPE"),
  destinationOrg: text("destination_org").notNull().default("CARE"),

  // ── Source references ──────────────────────────────────────────────────
  sourcePatientId: text("source_patient_id").notNull(), // HOPE uhid
  sourceEncounterId: text("source_encounter_id"), // HOPE opd_visits.visit_no / id
  sourcePrescriptionId: text("source_prescription_id"), // HOPE prescription / order id

  // ── Immutable patient demographics snapshot (exactly as HOPE sent) ──────
  patientName: text("patient_name").notNull().default(""),
  patientFirstName: text("patient_first_name"),
  patientLastName: text("patient_last_name"),
  patientAge: integer("patient_age"),
  patientAgeUnit: text("patient_age_unit").default("years"),
  patientDob: text("patient_dob"),
  patientGender: text("patient_gender"),
  patientPhone: text("patient_phone"),
  patientAddress: text("patient_address"),
  patientEmail: text("patient_email"),

  // ── Referring doctor + clinical context ────────────────────────────────
  sourceDoctorId: text("source_doctor_id"),
  referringDoctorName: text("referring_doctor_name"),
  referringDoctorSpecialization: text("referring_doctor_specialization"),
  referringDoctorRegNo: text("referring_doctor_reg_no"),
  department: text("department"),
  clinicalHistory: text("clinical_history"),
  provisionalDiagnosis: text("provisional_diagnosis"),
  requestedDate: timestamp("requested_date", { withTimezone: true }),
  // routine | urgent | emergency
  priority: text("priority").notNull().default("routine"),
  pregnancyStatus: text("pregnancy_status"),
  attachments: jsonb("attachments").notNull().default([]),
  consentStatus: text("consent_status").notNull().default("not_recorded"),
  consentMetadata: jsonb("consent_metadata"),
  notes: text("notes"),

  // ── CARE-side resolution ───────────────────────────────────────────────
  status: text("status").notNull().default("RECEIVED_BY_CARE"),
  carePatientId: integer("care_patient_id").references(() => patientsTable.id),
  patientLinkId: integer("patient_link_id").references(() => externalPatientLinksTable.id),
  careDoctorId: integer("care_doctor_id").references(() => doctorsTable.id),
  careOrderId: integer("care_order_id").references(() => ordersTable.id),
  // confirmed | probable | conflict | new | unmatched
  matchStatus: text("match_status").notNull().default("unmatched"),
  // all_mapped | partial | unmapped
  mappingStatus: text("mapping_status").notNull().default("unmapped"),

  // ── Provenance ─────────────────────────────────────────────────────────
  createdByPartnerId: integer("created_by_partner_id").references(() => integrationPartnersTable.id),
  createdBy: text("created_by"), // HOPE user who saved the prescription
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Per-item state — the brief requires status per individual ordered item, not
// only at the header. Preserves the exact prescribed snapshot AND records
// CARE-side substitutions/additions/removals separately.
export const diagnosticReferralItemsTable = pgTable("diagnostic_referral_items", {
  id: serial("id").primaryKey(),
  referralId: integer("referral_id").notNull().references(() => diagnosticReferralsTable.id),
  lineNo: integer("line_no").notNull().default(0),

  // Prescribed snapshot (immutable).
  sourceTestCode: text("source_test_code"),
  sourceTestName: text("source_test_name").notNull().default(""),
  sourceModality: text("source_modality"), // lab | radiology
  sourceCategory: text("source_category"),

  // Mapping resolution.
  mappingId: integer("mapping_id").references(() => serviceCatalogueMappingsTable.id),
  careTestId: integer("care_test_id").references(() => testsTable.id),
  carePackageId: integer("care_package_id").references(() => packagesTable.id),
  careDisplayName: text("care_display_name"),
  department: text("department"),
  modality: text("modality"),

  // Decision + lifecycle. itemStatus values track the per-item journey:
  // prescribed | mapped | unmapped | accepted | declined | unavailable |
  // added | changed | billed | sample_collected | study_scheduled |
  // in_progress | completed | reported | delivered | cancelled
  itemStatus: text("item_status").notNull().default("prescribed"),
  // accept | reject | unavailable | substitute (null until staff decide)
  decision: text("decision"),
  changeReason: text("change_reason"),
  changedBy: text("changed_by"),
  isAddedByCare: boolean("is_added_by_care").notNull().default(false),
  // Links to the canonical order line once the CARE order is created.
  careOrderTestId: integer("care_order_test_id").references(() => orderTestsTable.id),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Append-only audit trail: every significant action on a referral or item.
export const diagnosticReferralEventsTable = pgTable("diagnostic_referral_events", {
  id: serial("id").primaryKey(),
  referralId: integer("referral_id").notNull().references(() => diagnosticReferralsTable.id),
  itemId: integer("item_id").references(() => diagnosticReferralItemsTable.id),
  // referral.received | patient.matched | patient.confirmed | tests.mapped |
  // test.mapped_manually | item.accepted | item.declined | order.created |
  // bill.created | sample.collected | study.scheduled | report.finalised |
  // result.critical | result.acknowledged | referral.updated |
  // referral.cancelled | sync.failed | sync.retried | ...
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  // partner | staff | system
  actorType: text("actor_type").notNull().default("system"),
  actorId: text("actor_id"),
  actorName: text("actor_name"),
  organisation: text("organisation"), // HOPE | CARE
  reason: text("reason"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DiagnosticReferral = typeof diagnosticReferralsTable.$inferSelect;
export type InsertDiagnosticReferral = typeof diagnosticReferralsTable.$inferInsert;
export type DiagnosticReferralItem = typeof diagnosticReferralItemsTable.$inferSelect;
export type InsertDiagnosticReferralItem = typeof diagnosticReferralItemsTable.$inferInsert;
export type DiagnosticReferralEvent = typeof diagnosticReferralEventsTable.$inferSelect;
