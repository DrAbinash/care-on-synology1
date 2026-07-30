// ============================================================================
// Inbound inter-org API (HOPE → CARE), v1. Mounted WITHOUT staff auth; each
// route self-applies requireIntegrationPartnerAuth with its declared, code-fixed
// permission. Versioned contract — see docs/hope-care-integration/04_API_CONTRACT.md.
// ============================================================================
import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { diagnosticReferralsTable, diagnosticReferralItemsTable, externalResultLinksTable } from "@workspace/db";
import {
  requireIntegrationPartnerAuth,
  type IntegrationPartnerAuthRequest,
} from "../../middleware/requireIntegrationPartnerAuth";
import { ingestReferral, type ReferralIngestInput } from "../../services/integration/referralIngest";
import { writeReferralEvent } from "../../services/integration/audit";
import { assertTransition, isReferralStatus } from "../../services/integration/referralStateMachine";
import type { ReferralStatus } from "@workspace/db";
import { sendWhatsAppNow, type WaMessagePurpose } from "../../services/whatsapp/WhatsAppOutbox";

export const integrationInboundRouter = Router();

const CONTRACT_VERSION = "1.0";

// ── Health (open) ────────────────────────────────────────────────────────────
integrationInboundRouter.get("/health", (_req, res) => {
  res.json({ ok: true, service: "care-integration-inbound", contractVersion: CONTRACT_VERSION });
});

// ── Schemas ──────────────────────────────────────────────────────────────────
const TestSchema = z.object({
  code: z.string().trim().optional().nullable(),
  name: z.string().trim().min(1, "test name required"),
  modality: z.string().trim().optional().nullable(), // lab | radiology
  category: z.string().trim().optional().nullable(),
});

const CreateReferralSchema = z.object({
  referralUuid: z.string().trim().optional().nullable(),
  idempotencyKey: z.string().trim().optional().nullable(),
  source: z.object({
    org: z.string().trim().min(1),
    patientId: z.string().trim().min(1),
    encounterId: z.string().trim().optional().nullable(),
    prescriptionId: z.string().trim().optional().nullable(),
    user: z.string().trim().optional().nullable(),
  }),
  patient: z.object({
    name: z.string().trim().min(1),
    firstName: z.string().trim().optional().nullable(),
    lastName: z.string().trim().optional().nullable(),
    age: z.number().int().nonnegative().optional().nullable(),
    ageUnit: z.string().trim().optional().nullable(),
    dob: z.string().trim().optional().nullable(),
    gender: z.string().trim().optional().nullable(),
    phone: z.string().trim().optional().nullable(),
    address: z.string().trim().optional().nullable(),
    email: z.string().trim().optional().nullable(),
  }),
  referringDoctor: z.object({
    id: z.string().trim().optional().nullable(),
    name: z.string().trim().optional().nullable(),
    specialization: z.string().trim().optional().nullable(),
    registrationNo: z.string().trim().optional().nullable(),
  }).optional(),
  clinical: z.object({
    department: z.string().trim().optional().nullable(),
    history: z.string().trim().optional().nullable(),
    provisionalDiagnosis: z.string().trim().optional().nullable(),
    pregnancyStatus: z.string().trim().optional().nullable(),
  }).optional(),
  priority: z.enum(["routine", "urgent", "emergency"]).optional(),
  requestedDate: z.string().trim().optional().nullable(),
  consent: z.object({ status: z.string().trim().optional().nullable(), metadata: z.unknown().optional() }).optional(),
  attachments: z.array(z.unknown()).optional(),
  notes: z.string().trim().optional().nullable(),
  tests: z.array(TestSchema).min(1, "at least one test is required"),
});

// ── POST /diagnostic-referrals — create/receive a referral (idempotent) ──────
integrationInboundRouter.post("/diagnostic-referrals", requireIntegrationPartnerAuth("diagnostic_referral:create"), async (req: IntegrationPartnerAuthRequest, res) => {
  const parsed = CreateReferralSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid referral payload", details: parsed.error.issues });
    return;
  }
  const b = parsed.data;
  const partner = req.integrationPartner!;

  // Source-organisation check (defence in depth): the credential's org must
  // match the payload's declared source org.
  if (b.source.org.toUpperCase() !== partner.sourceOrgCode.toUpperCase()) {
    res.status(403).json({ error: `Source organisation '${b.source.org}' does not match this credential's organisation '${partner.sourceOrgCode}'.` });
    return;
  }

  const input: ReferralIngestInput = {
    referralUuid: b.referralUuid ?? null,
    idempotencyKey: b.idempotencyKey ?? null,
    sourceOrg: b.source.org.toUpperCase(),
    sourcePatientId: b.source.patientId,
    sourceEncounterId: b.source.encounterId ?? null,
    sourcePrescriptionId: b.source.prescriptionId ?? null,
    createdBy: b.source.user ?? null,
    patient: {
      name: b.patient.name,
      firstName: b.patient.firstName ?? null,
      lastName: b.patient.lastName ?? null,
      age: b.patient.age ?? null,
      ageUnit: b.patient.ageUnit ?? null,
      dob: b.patient.dob ?? null,
      gender: b.patient.gender ?? null,
      phone: b.patient.phone ?? null,
      address: b.patient.address ?? null,
      email: b.patient.email ?? null,
    },
    referringDoctor: b.referringDoctor ? {
      sourceId: b.referringDoctor.id ?? null,
      name: b.referringDoctor.name ?? null,
      specialization: b.referringDoctor.specialization ?? null,
      registrationNo: b.referringDoctor.registrationNo ?? null,
    } : undefined,
    department: b.clinical?.department ?? null,
    clinicalHistory: b.clinical?.history ?? null,
    provisionalDiagnosis: b.clinical?.provisionalDiagnosis ?? null,
    pregnancyStatus: b.clinical?.pregnancyStatus ?? null,
    priority: b.priority ?? "routine",
    requestedDate: b.requestedDate ?? null,
    consentStatus: b.consent?.status ?? null,
    consentMetadata: b.consent?.metadata ?? null,
    attachments: b.attachments ?? [],
    notes: b.notes ?? null,
    items: b.tests.map((t) => ({ testCode: t.code ?? null, testName: t.name, modality: t.modality ?? null, category: t.category ?? null })),
    partnerId: partner.id,
  };

  try {
    const result = await ingestReferral(input);
    res.status(result.replayed ? 200 : 201).json({
      referralUuid: result.referralUuid,
      referralId: result.referralId,
      status: result.status,
      matchStatus: result.matchStatus,
      mappingStatus: result.mappingStatus,
      replayed: result.replayed,
      items: result.items,
      contractVersion: CONTRACT_VERSION,
    });
  } catch (e) {
    console.error("[integration] ingest failed:", (e as Error)?.message);
    res.status(500).json({ error: "Failed to record referral" });
  }
});

// ── GET /diagnostic-referrals/:uuid — status polling ─────────────────────────
integrationInboundRouter.get("/diagnostic-referrals/:uuid", requireIntegrationPartnerAuth("diagnostic_referral:read"), async (req: IntegrationPartnerAuthRequest, res) => {
  const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.referralUuid, String(req.params.uuid))).limit(1);
  if (!ref || ref.sourceOrg.toUpperCase() !== req.integrationPartner!.sourceOrgCode.toUpperCase()) {
    res.status(404).json({ error: "Referral not found" });
    return;
  }
  const items = await db.select().from(diagnosticReferralItemsTable).where(eq(diagnosticReferralItemsTable.referralId, ref.id));
  res.json({
    referralUuid: ref.referralUuid,
    status: ref.status,
    matchStatus: ref.matchStatus,
    mappingStatus: ref.mappingStatus,
    items: items.map((it) => ({ sourceTestName: it.sourceTestName, itemStatus: it.itemStatus })),
    contractVersion: CONTRACT_VERSION,
  });
});

// ── PUT /diagnostic-referrals/:uuid — amend a pending referral ───────────────
const UpdateSchema = z.object({
  clinical: z.object({ history: z.string().optional().nullable(), provisionalDiagnosis: z.string().optional().nullable() }).optional(),
  priority: z.enum(["routine", "urgent", "emergency"]).optional(),
  notes: z.string().optional().nullable(),
});
integrationInboundRouter.put("/diagnostic-referrals/:uuid", requireIntegrationPartnerAuth("diagnostic_referral:update"), async (req: IntegrationPartnerAuthRequest, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid update", details: parsed.error.issues }); return; }
  const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.referralUuid, String(req.params.uuid))).limit(1);
  if (!ref || ref.sourceOrg.toUpperCase() !== req.integrationPartner!.sourceOrgCode.toUpperCase()) { res.status(404).json({ error: "Referral not found" }); return; }
  // Only amendable before CARE has created an order (brief §14).
  const amendable: ReferralStatus[] = ["PRESCRIBED", "OFFERED_TO_CARE", "SENT_TO_CARE", "RECEIVED_BY_CARE", "PATIENT_CONTACTED", "PATIENT_ACCEPTED"];
  if (!amendable.includes(ref.status as ReferralStatus)) {
    res.status(409).json({ error: `Referral can no longer be amended from HOPE (status ${ref.status}). Use cancellation/amendment workflow.` });
    return;
  }
  await db.update(diagnosticReferralsTable).set({
    clinicalHistory: parsed.data.clinical?.history ?? ref.clinicalHistory,
    provisionalDiagnosis: parsed.data.clinical?.provisionalDiagnosis ?? ref.provisionalDiagnosis,
    priority: parsed.data.priority ?? ref.priority,
    notes: parsed.data.notes ?? ref.notes,
  }).where(eq(diagnosticReferralsTable.id, ref.id));
  await writeReferralEvent(db, { referralId: ref.id, eventType: "referral.updated", actorType: "partner", organisation: ref.sourceOrg, reason: "amended_from_source", payload: parsed.data });
  res.json({ referralUuid: ref.referralUuid, status: ref.status, updated: true });
});

// ── POST /diagnostic-referrals/:uuid/cancel ──────────────────────────────────
integrationInboundRouter.post("/diagnostic-referrals/:uuid/cancel", requireIntegrationPartnerAuth("diagnostic_referral:cancel"), async (req: IntegrationPartnerAuthRequest, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "cancelled_by_source";
  const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.referralUuid, String(req.params.uuid))).limit(1);
  if (!ref || ref.sourceOrg.toUpperCase() !== req.integrationPartner!.sourceOrgCode.toUpperCase()) { res.status(404).json({ error: "Referral not found" }); return; }
  if (!isReferralStatus(ref.status)) { res.status(409).json({ error: "Referral in unknown state" }); return; }
  try {
    assertTransition(ref.status as ReferralStatus, "CANCELLED");
  } catch {
    // Already billed / sampled / reported — cannot silently cancel (brief §14).
    res.status(409).json({ error: `Referral cannot be cancelled from HOPE at status ${ref.status}. It is already in fulfilment; use CARE's cancellation/amendment workflow.`, status: ref.status });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(diagnosticReferralsTable).set({ status: "CANCELLED" }).where(eq(diagnosticReferralsTable.id, ref.id));
    await writeReferralEvent(tx, { referralId: ref.id, eventType: "referral.cancelled", fromStatus: ref.status, toStatus: "CANCELLED", actorType: "partner", organisation: ref.sourceOrg, reason });
  });
  res.json({ referralUuid: ref.referralUuid, status: "CANCELLED" });
});

// ── POST /diagnostic-referrals/:uuid/acknowledge — HOPE acks a critical result ─
integrationInboundRouter.post("/diagnostic-referrals/:uuid/acknowledge", requireIntegrationPartnerAuth("diagnostic_result:acknowledge"), async (req: IntegrationPartnerAuthRequest, res) => {
  const { resultLinkId, acknowledgedBy, method } = req.body ?? {};
  const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.referralUuid, String(req.params.uuid))).limit(1);
  if (!ref || ref.sourceOrg.toUpperCase() !== req.integrationPartner!.sourceOrgCode.toUpperCase()) { res.status(404).json({ error: "Referral not found" }); return; }
  if (resultLinkId) {
    await db.update(externalResultLinksTable).set({ criticalAckStatus: "acknowledged", criticalAckBy: typeof acknowledgedBy === "string" ? acknowledgedBy : "HOPE", criticalAckAt: new Date() }).where(eq(externalResultLinksTable.id, Number(resultLinkId)));
  }
  await writeReferralEvent(db, { referralId: ref.id, eventType: "result.acknowledged", actorType: "partner", organisation: ref.sourceOrg, actorName: typeof acknowledgedBy === "string" ? acknowledgedBy : null, reason: typeof method === "string" ? method : null });
  res.json({ acknowledged: true });
});

// ── POST /whatsapp/messages — HOPE enqueues patient WhatsApp via CARE outbox ─
const HOPE_WA_PURPOSES = [
  "manual_staff_send", "appointment_reminder", "report_ready", "bill_created",
] as const satisfies readonly WaMessagePurpose[];

const HopeWhatsappSchema = z.object({
  recipientPhone: z.string().trim().min(1),
  messagePurpose: z.enum(HOPE_WA_PURPOSES),
  text: z.string().trim().min(1).max(4096),
  idempotencyKey: z.string().trim().optional(),
  patientId: z.number().int().positive().optional().nullable(),
  sourceOrg: z.string().trim().optional(),
});

integrationInboundRouter.post("/whatsapp/messages", requireIntegrationPartnerAuth("whatsapp:enqueue"), async (req: IntegrationPartnerAuthRequest, res) => {
  const parsed = HopeWhatsappSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const partnerOrg = req.integrationPartner!.sourceOrgCode.toUpperCase();
  if (body.sourceOrg && body.sourceOrg.toUpperCase() !== partnerOrg) {
    res.status(403).json({ error: `sourceOrg must match partner organisation '${partnerOrg}'` });
    return;
  }

  const result = await sendWhatsAppNow({
    recipientPhone: body.recipientPhone,
    messagePurpose: body.messagePurpose,
    text: body.text,
    patientId: body.patientId ?? null,
    idempotencyKey: body.idempotencyKey,
    createdBy: `hope:${req.integrationPartner!.code}`,
  });

  if (!result.ok && !result.skipped) {
    res.status(502).json({ ok: false, error: result.error ?? "WhatsApp enqueue failed", outboxId: result.outboxId });
    return;
  }
  res.json({
    ok: true,
    skipped: result.skipped ?? false,
    messageId: result.messageId ?? null,
    outboxId: result.outboxId ?? null,
    error: result.error ?? null,
  });
});
