import { db, emergencyImportedTransactionsTable, emergencyPatientResolutionsTable, ordersTable, patientsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import {
  applyManualPatientResolution,
  candidateLabel,
  classifyPatientMatch,
  PatientResolutionError,
  type EmergencyTransaction,
  type MatchCandidate,
  type MatchDecision,
  type ManualPatientResolution,
} from "@workspace/emergency-billing";
import { createCanonicalPatient } from "../routes/patients";
import { mapEmergencyGender, synthesizeDob } from "./emergencyReconcileHelpers";

export async function loadResolutions(uuids: string[]): Promise<Map<string, ManualPatientResolution>> {
  const map = new Map<string, ManualPatientResolution>();
  if (!uuids.length) return map;
  const rows = await db
    .select()
    .from(emergencyPatientResolutionsTable)
    .where(inArray(emergencyPatientResolutionsTable.emergencyTransactionUuid, uuids));
  for (const r of rows) {
    map.set(r.emergencyTransactionUuid, {
      emergencyTransactionUuid: r.emergencyTransactionUuid,
      action: r.action === "create_new" ? "create_new" : "select_existing",
      carePatientId: r.carePatientId,
      carePatientLabel: r.carePatientLabel,
      resolvedByStaffName: r.resolvedByStaffName,
      resolvedByStaffId: r.resolvedByStaffId,
      resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
    });
  }
  return map;
}

export async function enrichCandidates(base: MatchCandidate[]): Promise<MatchCandidate[]> {
  if (!base.length) return base;
  const ids = base.map((c) => c.carePatientId);
  const rows = await db
    .select({
      id: patientsTable.id,
      dateOfBirth: patientsTable.dateOfBirth,
      ageValue: patientsTable.ageValue,
      ageUnit: patientsTable.ageUnit,
      address: patientsTable.address,
    })
    .from(patientsTable)
    .where(inArray(patientsTable.id, ids));
  const extra = new Map(rows.map((r) => [r.id, r]));
  const visits = await db
    .select({
      patientId: ordersTable.patientId,
      lastVisitAt: sql<Date>`max(${ordersTable.createdAt})`,
    })
    .from(ordersTable)
    .where(inArray(ordersTable.patientId, ids))
    .groupBy(ordersTable.patientId);
  const visitMap = new Map(visits.map((v) => [v.patientId, v.lastVisitAt]));
  return base.map((c) => {
    const e = extra.get(c.carePatientId);
    const last = visitMap.get(c.carePatientId);
    return {
      ...c,
      dateOfBirth: e?.dateOfBirth ?? c.dateOfBirth ?? null,
      ageValue: e?.ageValue ?? c.ageValue ?? null,
      ageUnit: e?.ageUnit ?? c.ageUnit ?? null,
      address: e?.address ?? c.address ?? null,
      lastVisitAt: last ? new Date(last).toISOString() : c.lastVisitAt ?? null,
    };
  });
}

export function classifyEmergencyPatient(t: EmergencyTransaction, candidates: MatchCandidate[]): MatchDecision {
  return classifyPatientMatch(
    {
      carePatientId: t.patient.carePatientId,
      uhid: t.patient.uhid,
      firstName: t.patient.firstName,
      lastName: t.patient.lastName,
      mobile: t.patient.mobile,
      sex: t.patient.sex,
    },
    candidates,
  );
}

export async function resolveEmergencyPatient(opts: {
  transaction: EmergencyTransaction;
  action: "select_existing" | "create_new";
  carePatientId?: number | null;
  alreadyImported: boolean;
  careBillId: number | null;
  candidates: MatchCandidate[];
  resolvedByStaffName: string;
  resolvedByStaffId: number | null;
}): Promise<{
  resolution: ManualPatientResolution;
  decision: MatchDecision;
}> {
  const { transaction: t } = opts;
  if (opts.alreadyImported) {
    throw new PatientResolutionError("Already imported — resolver is read-only", "ALREADY_IMPORTED");
  }
  if (t.status === "VOID") {
    throw new PatientResolutionError("Voided emergency bills cannot be resolved", "NOT_REVIEWABLE");
  }

  const existing = await loadResolutions([t.emergencyTransactionUuid]);
  const prior = existing.get(t.emergencyTransactionUuid) ?? null;
  const classified = classifyEmergencyPatient(t, opts.candidates);

  if (opts.action === "create_new") {
    let patientId = prior?.action === "create_new" ? prior.carePatientId : null;
    let label = prior?.action === "create_new" ? prior.carePatientLabel ?? null : null;
    if (!patientId) {
      const created = await createCanonicalPatient({
        firstName: t.patient.firstName,
        lastName: t.patient.lastName,
        phone: t.patient.mobile,
        dateOfBirth: synthesizeDob(t.patient),
        gender: mapEmergencyGender(t.patient.sex),
        ageValue: t.patient.ageValue,
        ageUnit: t.patient.ageUnit,
      });
      patientId = created.id;
      label = candidateLabel({ uhid: created.patientId, firstName: created.firstName, lastName: created.lastName });
    }
    const decision = applyManualPatientResolution(classified, { action: "create_new", carePatientId: patientId });
    const resolution = await upsertResolution({
      emergencyTransactionUuid: t.emergencyTransactionUuid,
      action: "create_new",
      carePatientId: patientId,
      carePatientLabel: label,
      resolvedByStaffName: opts.resolvedByStaffName,
      resolvedByStaffId: opts.resolvedByStaffId,
    });
    return { resolution, decision };
  }

  const decision = applyManualPatientResolution(classified, {
    action: "select_existing",
    carePatientId: opts.carePatientId ?? null,
  });
  const hit = classified.candidates.find((c) => c.carePatientId === decision.carePatientId)!;
  const resolution = await upsertResolution({
    emergencyTransactionUuid: t.emergencyTransactionUuid,
    action: "select_existing",
    carePatientId: hit.carePatientId,
    carePatientLabel: candidateLabel(hit),
    resolvedByStaffName: opts.resolvedByStaffName,
    resolvedByStaffId: opts.resolvedByStaffId,
  });
  return { resolution, decision };
}

async function upsertResolution(row: {
  emergencyTransactionUuid: string;
  action: "select_existing" | "create_new";
  carePatientId: number | null;
  carePatientLabel: string | null;
  resolvedByStaffName: string;
  resolvedByStaffId: number | null;
}): Promise<ManualPatientResolution> {
  const [saved] = await db
    .insert(emergencyPatientResolutionsTable)
    .values({
      emergencyTransactionUuid: row.emergencyTransactionUuid,
      action: row.action,
      carePatientId: row.carePatientId,
      carePatientLabel: row.carePatientLabel,
      resolvedByStaffName: row.resolvedByStaffName,
      resolvedByStaffId: row.resolvedByStaffId,
      resolvedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: emergencyPatientResolutionsTable.emergencyTransactionUuid,
      set: {
        action: row.action,
        carePatientId: row.carePatientId,
        carePatientLabel: row.carePatientLabel,
        resolvedByStaffName: row.resolvedByStaffName,
        resolvedByStaffId: row.resolvedByStaffId,
        resolvedAt: new Date(),
      },
    })
    .returning();
  return {
    emergencyTransactionUuid: saved.emergencyTransactionUuid,
    action: saved.action === "create_new" ? "create_new" : "select_existing",
    carePatientId: saved.carePatientId,
    carePatientLabel: saved.carePatientLabel,
    resolvedByStaffName: saved.resolvedByStaffName,
    resolvedByStaffId: saved.resolvedByStaffId,
    resolvedAt: saved.resolvedAt ? new Date(saved.resolvedAt).toISOString() : new Date().toISOString(),
  };
}

export async function importedCareBillId(uuid: string): Promise<number | null> {
  const [row] = await db
    .select({ careBillId: emergencyImportedTransactionsTable.careBillId })
    .from(emergencyImportedTransactionsTable)
    .where(eq(emergencyImportedTransactionsTable.emergencyTransactionUuid, uuid))
    .limit(1);
  return row?.careBillId ?? null;
}
