import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Patient-facing auth for the public booking mobile app / site.
 *
 * Closes the PHI hole documented in SECURITY_FINDING_PUBLIC_BOOKING_PHI_EXPOSURE.md:
 * knowing a phone number must never be enough to read bookings or reports.
 * A patient proves control of the phone via an OTP delivered out-of-band
 * (WhatsApp), which mints a server-side session token — the same model as
 * staff portal_sessions, scoped to a phone instead of a user id.
 */

// One row per outstanding OTP challenge. The code itself is never stored —
// only its SHA-256 hash — and never echoed in any API response.
export const patientOtpTable = pgTable("patient_otp_codes", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // Failed verify attempts against this challenge; the row is invalidated
  // after PATIENT_OTP_MAX_ATTEMPTS regardless of expiry.
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const patientSessionsTable = pgTable("patient_sessions", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  phone: text("phone").notNull(),
  // Display name captured at login time (patient-typed, not authoritative).
  name: text("name"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PatientSession = typeof patientSessionsTable.$inferSelect;
