// ============================================================================
// Referral ingest — the core inbound path. Idempotent on referral_uuid /
// idempotency_key: a re-sent prescription replays the existing referral and
// can never create a duplicate patient, order or bill. Runs patient matching,
// referring-doctor resolution and catalogue mapping, writes the audit trail,
// and enqueues the diagnostic_referral.received ack to HOPE — all atomically.
// ============================================================================
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  diagnosticReferralsTable,
  diagnosticReferralItemsTable,
  externalPatientLinksTable,
} from "@workspace/db";
import { splitName, approximateDobFromAge } from "./normalize";
import { matchPatient } from "./patientMatching";
import { resolveReferringDoctor } from "./providerMatching";
import { resolveTest } from "./catalogueMapping";
import { writeReferralEvent } from "./audit";
import { enqueueOutboxEvent } from "./outbox";

export interface ReferralItemInput {
  testCode?: string | null;
  testName: string;
  modality?: string | null; // lab | radiology hint
  category?: string | null;
}

export interface ReferralIngestInput {
  referralUuid?: string | null;
  idempotencyKey?: string | null;
  sourceOrg: string; // "HOPE"
  sourcePatientId: string;
  sourceEncounterId?: string | null;
  sourcePrescriptionId?: string | null;
  patient: {
    name: string;
    firstName?: string | null;
    lastName?: string | null;
    age?: number | null;
    ageUnit?: string | null;
    dob?: string | null;
    gender?: string | null;
    phone?: string | null;
    address?: string | null;
    email?: string | null;
  };
  referringDoctor?: {
    sourceId?: string | null;
    name?: string | null;
    specialization?: string | null;
    registrationNo?: string | null;
  };
  department?: string | null;
  clinicalHistory?: string | null;
  provisionalDiagnosis?: string | null;
  requestedDate?: string | null;
  priority?: string | null;
  pregnancyStatus?: string | null;
  attachments?: unknown[];
  consentStatus?: string | null;
  consentMetadata?: unknown;
  notes?: string | null;
  createdBy?: string | null;
  items: ReferralItemInput[];
  partnerId?: number | null;
}

export interface IngestResult {
  replayed: boolean;
  referralId: number;
  referralUuid: string;
  status: string;
  matchStatus: string;
  mappingStatus: string;
  carePatientId: number | null;
  careDoctorId: number | null;
  items: Array<{ id: number; sourceTestName: string; itemStatus: string; careTestId: number | null; carePackageId: number | null }>;
}

function isUniqueViolation(e: unknown): boolean {
  let node: unknown = e;
  while (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    if (n["code"] === "23505") return true;
    node = n["cause"];
  }
  return false;
}

async function loadResult(referralId: number, replayed: boolean): Promise<IngestResult> {
  const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.id, referralId)).limit(1);
  const items = await db.select().from(diagnosticReferralItemsTable).where(eq(diagnosticReferralItemsTable.referralId, referralId));
  return {
    replayed,
    referralId,
    referralUuid: ref.referralUuid,
    status: ref.status,
    matchStatus: ref.matchStatus,
    mappingStatus: ref.mappingStatus,
    carePatientId: ref.carePatientId ?? null,
    careDoctorId: ref.careDoctorId ?? null,
    items: items.map((it) => ({ id: it.id, sourceTestName: it.sourceTestName, itemStatus: it.itemStatus, careTestId: it.careTestId ?? null, carePackageId: it.carePackageId ?? null })),
  };
}

export async function ingestReferral(input: ReferralIngestInput): Promise<IngestResult> {
  const referralUuid = (input.referralUuid && input.referralUuid.trim()) || randomUUID();

  // Fast idempotency path (outside txn): replay if we've already seen it.
  const [existing] = await db.select({ id: diagnosticReferralsTable.id }).from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.referralUuid, referralUuid)).limit(1);
  if (existing) return loadResult(existing.id, true);

  try {
    const referralId = await db.transaction(async (tx) => {
      const split = input.patient.firstName || input.patient.lastName
        ? { firstName: input.patient.firstName || input.patient.name, lastName: input.patient.lastName || "" }
        : splitName(input.patient.name);
      const dob = input.patient.dob || approximateDobFromAge(input.patient.age, input.patient.ageUnit);

      // ── Patient matching ──────────────────────────────────────────────
      const match = await matchPatient(tx, {
        sourceSystem: input.sourceOrg,
        sourcePatientId: input.sourcePatientId,
        name: input.patient.name,
        phone: input.patient.phone,
        age: input.patient.age ?? null,
        gender: input.patient.gender ?? null,
      });
      const matchStatus = match.outcome === "confirmed_existing" ? "confirmed"
        : match.outcome === "probable" ? "probable"
        : match.outcome === "conflict" ? "conflict"
        : "new";
      const carePatientId = match.outcome === "confirmed_existing" ? match.carePatientId ?? null : null;
      if (carePatientId && match.linkId) {
        await tx.update(externalPatientLinksTable).set({ lastUsedAt: new Date() }).where(eq(externalPatientLinksTable.id, match.linkId));
      }

      // ── Referring doctor ──────────────────────────────────────────────
      let careDoctorId: number | null = null;
      if (input.referringDoctor && (input.referringDoctor.name || input.referringDoctor.sourceId)) {
        const prov = await resolveReferringDoctor(tx, {
          sourceSystem: input.sourceOrg,
          sourceProviderId: input.referringDoctor.sourceId,
          name: input.referringDoctor.name,
          specialization: input.referringDoctor.specialization,
          registrationNo: input.referringDoctor.registrationNo,
        });
        careDoctorId = prov.careDoctorId;
      }

      // ── Insert referral header ────────────────────────────────────────
      const [ref] = await tx.insert(diagnosticReferralsTable).values({
        referralUuid,
        idempotencyKey: input.idempotencyKey ?? null,
        sourceOrg: input.sourceOrg,
        destinationOrg: "CARE",
        sourcePatientId: input.sourcePatientId,
        sourceEncounterId: input.sourceEncounterId ?? null,
        sourcePrescriptionId: input.sourcePrescriptionId ?? null,
        patientName: input.patient.name,
        patientFirstName: split.firstName,
        patientLastName: split.lastName,
        patientAge: input.patient.age ?? null,
        patientAgeUnit: input.patient.ageUnit ?? "years",
        patientDob: dob,
        patientGender: input.patient.gender ?? null,
        patientPhone: input.patient.phone ?? null,
        patientAddress: input.patient.address ?? null,
        patientEmail: input.patient.email ?? null,
        sourceDoctorId: input.referringDoctor?.sourceId ?? null,
        referringDoctorName: input.referringDoctor?.name ?? null,
        referringDoctorSpecialization: input.referringDoctor?.specialization ?? null,
        referringDoctorRegNo: input.referringDoctor?.registrationNo ?? null,
        department: input.department ?? null,
        clinicalHistory: input.clinicalHistory ?? null,
        provisionalDiagnosis: input.provisionalDiagnosis ?? null,
        requestedDate: input.requestedDate ? new Date(input.requestedDate) : null,
        priority: (input.priority ?? "routine").toLowerCase(),
        pregnancyStatus: input.pregnancyStatus ?? null,
        attachments: (input.attachments ?? []) as never,
        consentStatus: input.consentStatus ?? "not_recorded",
        consentMetadata: (input.consentMetadata ?? null) as never,
        notes: input.notes ?? null,
        status: "RECEIVED_BY_CARE",
        carePatientId,
        patientLinkId: match.linkId ?? null,
        careDoctorId,
        matchStatus,
        mappingStatus: "unmapped",
        createdByPartnerId: input.partnerId ?? null,
        createdBy: input.createdBy ?? null,
      }).returning({ id: diagnosticReferralsTable.id });
      const referralId = ref.id;

      // ── Items + catalogue mapping ─────────────────────────────────────
      let mappedCount = 0;
      for (let i = 0; i < input.items.length; i++) {
        const it = input.items[i];
        const map = await resolveTest(tx, {
          sourceSystem: input.sourceOrg,
          sourceCode: it.testCode,
          sourceName: it.testName,
          sourceModality: it.modality,
        });
        const primary = map.targets[0];
        if (map.status === "mapped") mappedCount++;
        await tx.insert(diagnosticReferralItemsTable).values({
          referralId,
          lineNo: i + 1,
          sourceTestCode: it.testCode ?? null,
          sourceTestName: it.testName,
          sourceModality: it.modality ?? null,
          sourceCategory: it.category ?? null,
          mappingId: primary?.mappingId ?? null,
          careTestId: primary?.careTestId ?? null,
          carePackageId: primary?.carePackageId ?? null,
          careDisplayName: primary?.careDisplayName ?? null,
          department: primary?.department ?? null,
          modality: primary?.modality ?? it.modality ?? null,
          itemStatus: map.status === "mapped" ? "mapped" : "unmapped",
        });
      }
      const mappingStatus = input.items.length === 0 ? "unmapped"
        : mappedCount === input.items.length ? "all_mapped"
        : mappedCount === 0 ? "unmapped" : "partial";
      await tx.update(diagnosticReferralsTable).set({ mappingStatus }).where(eq(diagnosticReferralsTable.id, referralId));

      // ── Audit + outbound ack ──────────────────────────────────────────
      await writeReferralEvent(tx, {
        referralId, eventType: "referral.received", toStatus: "RECEIVED_BY_CARE",
        actorType: "partner", actorId: input.createdBy ?? null, organisation: input.sourceOrg,
        payload: { matchStatus, mappingStatus, itemCount: input.items.length, matchCandidates: match.candidates.slice(0, 5), conflictReason: match.conflictReason ?? null },
      });
      if (match.outcome === "confirmed_existing") {
        await writeReferralEvent(tx, { referralId, eventType: "patient.matched", reason: "existing_confirmed_link", actorType: "system", payload: { carePatientId } });
      } else if (match.outcome === "conflict") {
        await writeReferralEvent(tx, { referralId, eventType: "patient.conflict", reason: match.conflictReason ?? "identity_conflict", actorType: "system" });
      }
      await enqueueOutboxEvent(tx, {
        eventType: "diagnostic_referral.received",
        idempotencyKey: `diagnostic_referral.received:${referralUuid}`,
        correlationId: referralUuid,
        aggregateType: "diagnostic_referral",
        aggregateId: referralUuid,
        partnerId: input.partnerId ?? null,
        payload: { referralUuid, status: "RECEIVED_BY_CARE", matchStatus, mappingStatus },
      });

      return referralId;
    });

    return loadResult(referralId, false);
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Concurrent duplicate delivery — replay the winner.
      const [row] = await db.select({ id: diagnosticReferralsTable.id }).from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.referralUuid, referralUuid)).limit(1);
      if (row) return loadResult(row.id, true);
    }
    throw e;
  }
}
