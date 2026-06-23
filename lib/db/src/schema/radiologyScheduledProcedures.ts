import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// radiology_scheduled_procedures — MWL (Modality Worklist) source of truth.
// Auto-populated when a radiology order is created in the ERP. The Windows MWL
// SCP agent queries this table via GET /api/internal/radiology/mwl to serve
// DICOM C-FIND responses to imaging equipment.
export const radiologyScheduledProceduresTable = pgTable("radiology_scheduled_procedures", {
  id: serial("id").primaryKey(),
  accessionNumber:   text("accession_number").notNull().unique(),
  patientId:         text("patient_id"),
  patientName:       text("patient_name"),
  patientSex:        text("patient_sex"),
  patientAge:        text("patient_age"),
  patientDob:        text("patient_dob"),
  modality:          text("modality"),
  procedureName:     text("procedure_name"),
  procedureCode:     text("procedure_code"),
  studyDescription:  text("study_description"),
  referringDoctor:   text("referring_doctor"),
  referringDoctorId: text("referring_doctor_id"),
  scheduledDate:     text("scheduled_date"),  // YYYYMMDD
  scheduledTime:     text("scheduled_time"),  // HHMMSS
  stationAeTitle:    text("station_ae_title"),
  bodyPartExamined:  text("body_part_examined"),
  // status: SCHEDULED → SENT_TO_MWL → COMPLETED | CANCELLED
  status:            text("status").notNull().default("SCHEDULED"),
  sourceBillId:      text("source_bill_id"),
  sourceOrderId:     text("source_order_id"),
  sourceAppointmentId: text("source_appointment_id"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type RadiologyScheduledProcedure = typeof radiologyScheduledProceduresTable.$inferSelect;
