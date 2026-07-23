import crypto from "node:crypto";
import { db } from "@workspace/db";
import { selfReferralPrescriptionsTable, signaturesTable } from "@workspace/db/schema";
import { and, eq, ilike, inArray } from "drizzle-orm";
import {
  SELF_REFERRAL_OPD_DOCTOR,
  SELF_REFERRAL_OPD_DOCTOR_QUALIFICATIONS,
  SELF_REFERRAL_PRESCRIPTION_ADVICE,
  type RegisterSourceRecord,
} from "./formFRegister";

/**
 * Auto-generated, digitally signed advice prescriptions for self-referral/
 * walk-in Form F test patients.
 *
 * The "digital signature" has three parts, all captured at signing time:
 *  1. the signer identity block (doctor name, qualifications, registration
 *     number from the signatures master when available),
 *  2. a snapshot of the doctor's signature image (from the existing
 *     signatures table — the snapshot means later edits to the master never
 *     alter an already-signed prescription),
 *  3. a SHA-256 content hash over the canonical prescription content, so any
 *     later tampering with the stored row is detectable by recomputing it.
 *
 * Generation is IDEMPOTENT: one prescription per Form F record (unique
 * form_f_record_id + ON CONFLICT DO NOTHING), so re-running ensure() for a
 * month can never duplicate or re-sign an existing prescription.
 */

export interface PrescriptionContentInput {
  formFRecordId: number;
  patientName: string;
  spouseFather: string;
  age: string;
  prescriptionDate: string;
  adviceText: string;
  doctorName: string;
  doctorQualifications: string;
}

/** Canonical, field-order-stable content string that gets hashed. */
export function prescriptionContentString(c: PrescriptionContentInput): string {
  return [
    `formFRecordId=${c.formFRecordId}`,
    `patient=${c.patientName}`,
    `spouseFather=${c.spouseFather}`,
    `age=${c.age}`,
    `date=${c.prescriptionDate}`,
    `advice=${c.adviceText}`,
    `doctor=${c.doctorName}`,
    `qualifications=${c.doctorQualifications}`,
  ].join("\n");
}

export function prescriptionContentHash(c: PrescriptionContentInput): string {
  return crypto.createHash("sha256").update(prescriptionContentString(c), "utf8").digest("hex");
}

/** The signing doctor's row in the existing signatures master, if present. */
async function findDoctorSignature(): Promise<{ id: number; imageDataUrl: string; registrationNo: string } | null> {
  const [sig] = await db
    .select({
      id: signaturesTable.id,
      imageDataUrl: signaturesTable.imageDataUrl,
      registrationNo: signaturesTable.registrationNo,
    })
    .from(signaturesTable)
    .where(and(eq(signaturesTable.isActive, true), ilike(signaturesTable.name, "%sugandha%")))
    .limit(1);
  return sig ?? null;
}

/**
 * Ensure a signed prescription exists for every qualifying Form F record.
 * Called from the Self-Referral OPD register (covers historical records) and
 * from the Form F save hook (signs at creation time). Never overwrites.
 */
export async function ensureSelfReferralPrescriptions(
  records: Array<Pick<RegisterSourceRecord, "id" | "patientId" | "patientName" | "husbandFatherName" | "age" | "procedureDate" | "date" | "createdAt">>,
): Promise<void> {
  if (records.length === 0) return;

  const existing = await db
    .select({ formFRecordId: selfReferralPrescriptionsTable.formFRecordId })
    .from(selfReferralPrescriptionsTable)
    .where(inArray(selfReferralPrescriptionsTable.formFRecordId, records.map((r) => r.id)));
  const have = new Set(existing.map((e) => e.formFRecordId));
  const missing = records.filter((r) => !have.has(r.id));
  if (missing.length === 0) return;

  const signature = await findDoctorSignature();

  const rows = missing.map((r) => {
    const createdIso = r.createdAt ? new Date(r.createdAt as Date | string).toISOString() : "";
    const content: PrescriptionContentInput = {
      formFRecordId: r.id,
      patientName: r.patientName ?? "",
      spouseFather: r.husbandFatherName ?? "",
      age: r.age ?? "",
      prescriptionDate: r.procedureDate?.trim() || r.date?.trim() || createdIso.slice(0, 10),
      adviceText: SELF_REFERRAL_PRESCRIPTION_ADVICE,
      doctorName: SELF_REFERRAL_OPD_DOCTOR,
      doctorQualifications: SELF_REFERRAL_OPD_DOCTOR_QUALIFICATIONS,
    };
    return {
      formFRecordId: r.id,
      patientId: r.patientId ?? null,
      patientName: content.patientName,
      spouseFather: content.spouseFather,
      age: content.age,
      prescriptionDate: content.prescriptionDate,
      adviceText: content.adviceText,
      doctorName: content.doctorName,
      doctorQualifications: content.doctorQualifications,
      doctorRegistrationNo: signature?.registrationNo ?? "",
      signatureId: signature?.id ?? null,
      signatureImageDataUrl: signature?.imageDataUrl ?? null,
      contentHash: prescriptionContentHash(content),
    };
  });

  await db.insert(selfReferralPrescriptionsTable).values(rows).onConflictDoNothing();
}
