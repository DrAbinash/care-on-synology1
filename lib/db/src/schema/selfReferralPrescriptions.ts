import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

// Auto-generated, digitally signed advice prescriptions for self-referral/
// walk-in Form F test patients (PCPNDT: the clinic's own obstetrical checkup
// is the lawful referral for a self-referred pregnant woman — see the
// Self-Referral OPD register). One prescription per Form F record; the
// signature image and content hash are SNAPSHOTS captured at signing time,
// so later edits to the signature master never alter a signed prescription.
export const selfReferralPrescriptionsTable = pgTable(
  "self_referral_prescriptions",
  {
    id: serial("id").primaryKey(),
    formFRecordId: integer("form_f_record_id").notNull(),
    patientId: integer("patient_id"),
    patientName: text("patient_name").notNull().default(""),
    spouseFather: text("spouse_father").notNull().default(""),
    age: text("age").notNull().default(""),
    prescriptionDate: text("prescription_date").notNull().default(""),
    adviceText: text("advice_text").notNull().default(""),
    doctorName: text("doctor_name").notNull().default(""),
    doctorQualifications: text("doctor_qualifications").notNull().default(""),
    doctorRegistrationNo: text("doctor_registration_no").notNull().default(""),
    signatureId: integer("signature_id"),
    signatureImageDataUrl: text("signature_image_data_url"),
    contentHash: text("content_hash").notNull().default(""),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byFormFRecordUq: uniqueIndex("self_referral_prescriptions_form_f_record_id_key").on(t.formFRecordId),
    byPatient: index("self_referral_prescriptions_patient_idx").on(t.patientId),
  }),
);

export type SelfReferralPrescription = typeof selfReferralPrescriptionsTable.$inferSelect;
export type InsertSelfReferralPrescription = typeof selfReferralPrescriptionsTable.$inferInsert;
