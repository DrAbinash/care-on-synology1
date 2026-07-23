import { pgTable, serial, text, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * ABDM/ABHA consent-request lifecycle + ABHA enrolment sessions — additive
 * extension of the existing ABDM scaffold (lib/db/src/schema/abdm.ts). The
 * existing abdm_consent_artefacts table is receive-only (populated by the
 * Consent Manager callback); this adds the HIU-initiated REQUEST side plus
 * grant/deny/revoke lifecycle, and an OTP enrolment session for ABHA creation.
 *
 * Feature-flagged (ff_abdm_abha, Shadow Mode) AND still gated by the existing
 * ABDM_ENABLED env for any real gateway call. Non-financial, additive.
 */
export const abdmConsentRequestsTable = pgTable(
  "abdm_consent_requests",
  {
    id: serial("id").primaryKey(),
    requestId: text("request_id").notNull(),          // our UUID (correlation)
    patientId: integer("patient_id"),
    abhaAddress: text("abha_address"),
    purposeCode: text("purpose_code").notNull().default("CAREMGT"),
    purposeText: text("purpose_text"),
    hiTypes: text("hi_types"),                          // comma-separated (e.g. DiagnosticReport)
    dateFrom: timestamp("date_from", { withTimezone: true }),
    dateTo: timestamp("date_to", { withTimezone: true }),
    expiry: timestamp("expiry", { withTimezone: true }),
    // REQUESTED → GRANTED | DENIED | REVOKED | EXPIRED
    status: text("status").notNull().default("REQUESTED"),
    consentId: text("consent_id"),                      // artefact id once granted
    initiatedBy: text("initiated_by"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    requestUq: uniqueIndex("abdm_consent_requests_request_uq").on(t.requestId),
    byStatus: index("abdm_consent_requests_status_idx").on(t.status),
    byPatient: index("abdm_consent_requests_patient_idx").on(t.patientId),
  }),
);

export const abhaEnrolmentSessionsTable = pgTable(
  "abha_enrolment_sessions",
  {
    id: serial("id").primaryKey(),
    txnId: text("txn_id").notNull(),                    // gateway txn (or our UUID)
    patientId: integer("patient_id"),
    method: text("method").notNull(),                   // aadhaar-otp | mobile-otp
    identifierLast4: text("identifier_last4"),           // last 4 of aadhaar/mobile only (no PII)
    // pending → otp_sent → verified → created; failed at any point.
    status: text("status").notNull().default("pending"),
    step: text("step").notNull().default("otp_requested"),
    scope: text("scope"),
    abhaLinkId: integer("abha_link_id"),                 // set once an ABHA link is created
    lastError: text("last_error"),
    raw: jsonb("raw"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    txnUq: uniqueIndex("abha_enrolment_sessions_txn_uq").on(t.txnId),
    byPatient: index("abha_enrolment_sessions_patient_idx").on(t.patientId),
  }),
);

export type AbdmConsentRequest = typeof abdmConsentRequestsTable.$inferSelect;
export type AbhaEnrolmentSession = typeof abhaEnrolmentSessionsTable.$inferSelect;
