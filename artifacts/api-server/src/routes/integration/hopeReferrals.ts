// ============================================================================
// CARE staff "HOPE Referrals" inbox API. Mounted with requireStaffAuth +
// requireStaffPermission("/hope-referrals"). Single fast workflow:
//   open referral → verify patient → verify/map tests → create CARE order → bill
// Order/patient creation uses canonical paths; billing is handed off to the
// existing (frozen) billing desk. This router never writes a bill.
// ============================================================================
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte, inArray, or, ilike, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  diagnosticReferralsTable,
  diagnosticReferralItemsTable,
  diagnosticReferralEventsTable,
  externalPatientLinksTable,
  patientsTable,
  integrationOutboxTable,
  serviceCatalogueMappingsTable,
  serviceCatalogueMappingSynonymsTable,
  testsTable,
} from "@workspace/db";
import type { StaffAuthRequest } from "../../middleware/requireStaffAuth";
import { matchPatient } from "../../services/integration/patientMatching";
import { expandTargetToTestIds, classifyModality } from "../../services/integration/catalogueMapping";
import { createOrAppendCareOrder, type AcceptLine } from "../../services/integration/careOrder";
import { writeReferralEvent, writeLinkEvent } from "../../services/integration/audit";
import { assertTransition, isReferralStatus, TERMINAL_STATUSES } from "../../services/integration/referralStateMachine";
import { enqueueOutboxEvent } from "../../services/integration/outbox";
import { normalizeTestName } from "../../services/integration/normalize";
import type { ReferralStatus } from "@workspace/db";

export const hopeReferralsRouter = Router();

const staffName = (req: StaffAuthRequest) => req.staffSession?.subjectName ?? "staff";

// ── Stats for filter chips ───────────────────────────────────────────────────
hopeReferralsRouter.get("/stats", async (_req, res) => {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const raw = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'RECEIVED_BY_CARE')                       AS new,
      count(*) FILTER (WHERE priority IN ('urgent','emergency') AND status NOT IN ('CANCELLED','EXPIRED','DELIVERED')) AS urgent,
      count(*) FILTER (WHERE received_at >= ${startOfToday.toISOString()})       AS today,
      count(*) FILTER (WHERE status = 'PATIENT_ACCEPTED')                        AS patient_accepted,
      count(*) FILTER (WHERE status IN ('RECEIVED_BY_CARE','PATIENT_CONTACTED')) AS awaiting_patient,
      count(*) FILTER (WHERE mapping_status IN ('unmapped','partial') AND status NOT IN ('CANCELLED','EXPIRED')) AS unmapped,
      count(*) FILTER (WHERE match_status = 'conflict')                          AS identity_conflict,
      count(*) FILTER (WHERE status = 'CARE_ORDER_CREATED')                      AS awaiting_billing,
      count(*) FILTER (WHERE status = 'PARTIALLY_BOOKED')                        AS partially_fulfilled,
      count(*) FILTER (WHERE status = 'CANCELLED')                              AS cancelled
    FROM diagnostic_referrals
  `);
  const rowsArr = (raw as unknown as { rows?: Record<string, string>[] }).rows ?? (raw as unknown as Record<string, string>[]);
  const row = (Array.isArray(rowsArr) ? rowsArr[0] : undefined) ?? {};
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(row)) counts[k] = Number(v ?? 0);
  const deadRows = await db.select({ c: sql<number>`count(distinct ${integrationOutboxTable.correlationId})` }).from(integrationOutboxTable).where(eq(integrationOutboxTable.status, "dead"));
  res.json({ ...counts, sync_errors: Number(deadRows[0]?.c ?? 0) });
});

// ── List with filters + search ───────────────────────────────────────────────
hopeReferralsRouter.get("/", async (req, res) => {
  const filter = String(req.query.filter ?? "");
  const search = String(req.query.search ?? "").trim();
  const conds: ReturnType<typeof eq>[] = [];
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);

  switch (filter) {
    case "new": conds.push(eq(diagnosticReferralsTable.status, "RECEIVED_BY_CARE")); break;
    case "urgent": conds.push(inArray(diagnosticReferralsTable.priority, ["urgent", "emergency"]) as ReturnType<typeof eq>); break;
    case "today": conds.push(gte(diagnosticReferralsTable.receivedAt, startOfToday) as ReturnType<typeof eq>); break;
    case "patient_accepted": conds.push(eq(diagnosticReferralsTable.status, "PATIENT_ACCEPTED")); break;
    case "awaiting_patient": conds.push(inArray(diagnosticReferralsTable.status, ["RECEIVED_BY_CARE", "PATIENT_CONTACTED"]) as ReturnType<typeof eq>); break;
    case "unmapped": conds.push(inArray(diagnosticReferralsTable.mappingStatus, ["unmapped", "partial"]) as ReturnType<typeof eq>); break;
    case "identity_conflict": conds.push(eq(diagnosticReferralsTable.matchStatus, "conflict")); break;
    case "awaiting_billing": conds.push(eq(diagnosticReferralsTable.status, "CARE_ORDER_CREATED")); break;
    case "partially_fulfilled": conds.push(eq(diagnosticReferralsTable.status, "PARTIALLY_BOOKED")); break;
    case "cancelled": conds.push(eq(diagnosticReferralsTable.status, "CANCELLED")); break;
    case "sync_errors": {
      const dead = await db.select({ cid: integrationOutboxTable.correlationId }).from(integrationOutboxTable).where(eq(integrationOutboxTable.status, "dead"));
      const ids = [...new Set(dead.map((d) => d.cid).filter(Boolean) as string[])];
      conds.push(ids.length ? (inArray(diagnosticReferralsTable.referralUuid, ids) as ReturnType<typeof eq>) : (sql`false` as unknown as ReturnType<typeof eq>));
      break;
    }
    default: break;
  }
  if (search) {
    conds.push(or(
      ilike(diagnosticReferralsTable.patientName, `%${search}%`),
      ilike(diagnosticReferralsTable.patientPhone, `%${search}%`),
      ilike(diagnosticReferralsTable.sourcePatientId, `%${search}%`),
    ) as ReturnType<typeof eq>);
  }

  const referrals = await db
    .select()
    .from(diagnosticReferralsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(diagnosticReferralsTable.receivedAt))
    .limit(100);

  const ids = referrals.map((r) => r.id);
  const itemCounts = ids.length
    ? await db.select({ referralId: diagnosticReferralItemsTable.referralId, c: sql<number>`count(*)` }).from(diagnosticReferralItemsTable).where(inArray(diagnosticReferralItemsTable.referralId, ids)).groupBy(diagnosticReferralItemsTable.referralId)
    : [];
  const countMap = new Map(itemCounts.map((r) => [r.referralId, Number(r.c)]));

  res.json({
    referrals: referrals.map((r) => ({
      id: r.id, referralUuid: r.referralUuid, patientName: r.patientName, patientPhone: r.patientPhone,
      sourcePatientId: r.sourcePatientId, patientAge: r.patientAge, patientGender: r.patientGender,
      referringDoctorName: r.referringDoctorName, department: r.department, priority: r.priority,
      status: r.status, matchStatus: r.matchStatus, mappingStatus: r.mappingStatus,
      testCount: countMap.get(r.id) ?? 0, receivedAt: r.receivedAt,
    })),
  });
});

// ── Detail (referral + items + events + LIVE patient candidates) ─────────────
hopeReferralsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.id, id)).limit(1);
  if (!ref) { res.status(404).json({ error: "Referral not found" }); return; }
  const items = await db.select().from(diagnosticReferralItemsTable).where(eq(diagnosticReferralItemsTable.referralId, id)).orderBy(diagnosticReferralItemsTable.lineNo);
  const events = await db.select().from(diagnosticReferralEventsTable).where(eq(diagnosticReferralEventsTable.referralId, id)).orderBy(desc(diagnosticReferralEventsTable.createdAt)).limit(100);

  // Live patient match (unless already resolved to a CARE patient).
  let match: Awaited<ReturnType<typeof matchPatient>> | null = null;
  let carePatient: { id: number; patientId: string; name: string; phone: string } | null = null;
  if (ref.carePatientId) {
    const [p] = await db.select().from(patientsTable).where(eq(patientsTable.id, ref.carePatientId)).limit(1);
    if (p) carePatient = { id: p.id, patientId: p.patientId, name: `${p.firstName} ${p.lastName}`.trim(), phone: p.phone };
  } else {
    match = await matchPatient(db, { sourceSystem: ref.sourceOrg, sourcePatientId: ref.sourcePatientId, name: ref.patientName, phone: ref.patientPhone, age: ref.patientAge, gender: ref.patientGender });
  }

  // Resolve expandable CARE test ids per item (for the order handoff preview).
  const itemsOut = [];
  for (const it of items) {
    let resolvedTestIds: number[] = [];
    if (it.careTestId) resolvedTestIds = [it.careTestId];
    else if (it.carePackageId) resolvedTestIds = await expandTargetToTestIds(db, { mappingId: 0, careTestId: null, carePackageId: it.carePackageId, careDisplayName: null, department: null, modality: null, mappingType: "one_to_package" });
    itemsOut.push({ ...it, resolvedTestIds, careModality: classifyModality(it.department, it.modality) });
  }

  res.json({ referral: ref, items: itemsOut, events, patientMatch: match, carePatient });
});

// ── Mark patient contacted ───────────────────────────────────────────────────
hopeReferralsRouter.post("/:id/contact-patient", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.id, id)).limit(1);
  if (!ref) { res.status(404).json({ error: "Not found" }); return; }
  if (!isReferralStatus(ref.status)) { res.status(409).json({ error: "Unknown state" }); return; }
  try { assertTransition(ref.status as ReferralStatus, "PATIENT_CONTACTED"); } catch (e) { res.status(409).json({ error: (e as Error).message }); return; }
  await db.transaction(async (tx) => {
    await tx.update(diagnosticReferralsTable).set({ status: "PATIENT_CONTACTED" }).where(eq(diagnosticReferralsTable.id, id));
    await writeReferralEvent(tx, { referralId: id, eventType: "patient.contacted", fromStatus: ref.status, toStatus: "PATIENT_CONTACTED", actorType: "staff", actorName: staffName(req), organisation: "CARE" });
  });
  res.json({ status: "PATIENT_CONTACTED" });
});

// ── Confirm / create / block patient identity ────────────────────────────────
const ConfirmPatientSchema = z.object({
  action: z.enum(["confirm_existing", "create_new", "block"]),
  carePatientId: z.number().int().positive().optional(),
});
hopeReferralsRouter.post("/:id/confirm-patient", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  const parsed = ConfirmPatientSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.id, id)).limit(1);
  if (!ref) { res.status(404).json({ error: "Not found" }); return; }

  if (parsed.data.action === "block") {
    await db.transaction(async (tx) => {
      await tx.update(diagnosticReferralsTable).set({ matchStatus: "conflict" }).where(eq(diagnosticReferralsTable.id, id));
      await writeReferralEvent(tx, { referralId: id, eventType: "patient.blocked", actorType: "staff", actorName: staffName(req), organisation: "CARE", reason: "identity_conflict_blocked" });
    });
    res.json({ matchStatus: "conflict" });
    return;
  }

  const carePatientId = parsed.data.carePatientId;
  if (!carePatientId) { res.status(400).json({ error: "carePatientId is required for confirm_existing/create_new" }); return; }
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, carePatientId)).limit(1);
  if (!patient) { res.status(400).json({ error: "CARE patient not found" }); return; }

  await db.transaction(async (tx) => {
    // Persist a confirmed crosswalk link (idempotent — reuse if present).
    const [existing] = await tx.select().from(externalPatientLinksTable).where(and(eq(externalPatientLinksTable.sourceSystem, ref.sourceOrg), eq(externalPatientLinksTable.sourcePatientId, ref.sourcePatientId), eq(externalPatientLinksTable.linkStatus, "confirmed"))).limit(1);
    let linkId = existing?.id ?? null;
    if (!linkId) {
      const [link] = await tx.insert(externalPatientLinksTable).values({
        sourceSystem: ref.sourceOrg, sourcePatientId: ref.sourcePatientId, carePatientId,
        linkStatus: "confirmed", matchMethod: parsed.data.action === "create_new" ? "created_new" : "manual",
        confidence: "100", confirmedBy: staffName(req), confirmedAt: new Date(),
      }).returning({ id: externalPatientLinksTable.id });
      linkId = link.id;
    }
    await tx.update(diagnosticReferralsTable).set({ carePatientId, patientLinkId: linkId, matchStatus: "confirmed" }).where(eq(diagnosticReferralsTable.id, id));
    await writeLinkEvent(tx, { linkId, sourceSystem: ref.sourceOrg, sourcePatientId: ref.sourcePatientId, carePatientId, eventType: parsed.data.action === "create_new" ? "created_new" : "confirmed", toStatus: "confirmed", actor: staffName(req) });
    await writeReferralEvent(tx, { referralId: id, eventType: "patient.confirmed", actorType: "staff", actorName: staffName(req), organisation: "CARE", payload: { carePatientId, action: parsed.data.action } });
  });
  res.json({ carePatientId, matchStatus: "confirmed" });
});

// ── Map an unmapped/changed test to a CARE test (optionally persist mapping) ──
const MapTestSchema = z.object({
  itemId: z.number().int().positive(),
  careTestId: z.number().int().positive().optional(),
  carePackageId: z.number().int().positive().optional(),
  persistMapping: z.boolean().optional(),
});
hopeReferralsRouter.post("/:id/map-test", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  const parsed = MapTestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  if (!parsed.data.careTestId && !parsed.data.carePackageId) { res.status(400).json({ error: "careTestId or carePackageId required" }); return; }
  const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.id, id)).limit(1);
  if (!ref) { res.status(404).json({ error: "Not found" }); return; }
  const [item] = await db.select().from(diagnosticReferralItemsTable).where(and(eq(diagnosticReferralItemsTable.id, parsed.data.itemId), eq(diagnosticReferralItemsTable.referralId, id))).limit(1);
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }

  let displayName: string | null = item.careDisplayName;
  let department: string | null = item.department;
  let modality: string | null = item.modality;
  if (parsed.data.careTestId) {
    const [t] = await db.select().from(testsTable).where(eq(testsTable.id, parsed.data.careTestId)).limit(1);
    if (!t) { res.status(400).json({ error: "CARE test not found" }); return; }
    displayName = t.name; department = t.department; modality = t.department;
  }

  await db.transaction(async (tx) => {
    let mappingId: number | null = item.mappingId;
    if (parsed.data.persistMapping) {
      const [m] = await tx.insert(serviceCatalogueMappingsTable).values({
        sourceSystem: ref.sourceOrg, sourceCode: item.sourceTestCode ?? null,
        sourceName: item.sourceTestName, sourceNameNormalized: normalizeTestName(item.sourceTestName),
        sourceModality: item.sourceModality ?? null, careTestId: parsed.data.careTestId ?? null,
        carePackageId: parsed.data.carePackageId ?? null, careDisplayName: displayName, department, modality,
        mappingType: parsed.data.carePackageId ? "one_to_package" : "one_to_one",
        mappingStatus: "active", confidence: "100", createdBy: staffName(req),
      }).returning({ id: serviceCatalogueMappingsTable.id });
      mappingId = m.id;
      // Add the source name as a synonym for future auto-resolution.
      await tx.insert(serviceCatalogueMappingSynonymsTable).values({ mappingId: m.id, synonym: item.sourceTestName, synonymNormalized: normalizeTestName(item.sourceTestName) }).catch(() => {});
    }
    await tx.update(diagnosticReferralItemsTable).set({
      careTestId: parsed.data.careTestId ?? null, carePackageId: parsed.data.carePackageId ?? null,
      careDisplayName: displayName, department, modality, mappingId, itemStatus: "mapped",
      changedBy: staffName(req),
    }).where(eq(diagnosticReferralItemsTable.id, item.id));
    await writeReferralEvent(tx, { referralId: id, itemId: item.id, eventType: "test.mapped_manually", actorType: "staff", actorName: staffName(req), organisation: "CARE", payload: { careTestId: parsed.data.careTestId, carePackageId: parsed.data.carePackageId, persisted: !!parsed.data.persistMapping } });

    // Recompute referral mapping status.
    const all = await tx.select({ itemStatus: diagnosticReferralItemsTable.itemStatus }).from(diagnosticReferralItemsTable).where(eq(diagnosticReferralItemsTable.referralId, id));
    const unmapped = all.filter((a) => a.itemStatus === "unmapped").length;
    const mapping = unmapped === 0 ? "all_mapped" : unmapped === all.length ? "unmapped" : "partial";
    await tx.update(diagnosticReferralsTable).set({ mappingStatus: mapping }).where(eq(diagnosticReferralsTable.id, id));
  });
  res.json({ itemId: item.id, itemStatus: "mapped" });
});

// ── Accept selected/all items → create the CARE order ────────────────────────
const AcceptSchema = z.object({ itemIds: z.array(z.number().int().positive()).optional() });
hopeReferralsRouter.post("/:id/accept", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  const parsed = AcceptSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.id, id)).limit(1);
  if (!ref) { res.status(404).json({ error: "Not found" }); return; }
  if (!ref.carePatientId) { res.status(409).json({ error: "Confirm the patient identity before creating a CARE order." }); return; }
  if (!isReferralStatus(ref.status) || TERMINAL_STATUSES.has(ref.status as ReferralStatus)) { res.status(409).json({ error: `Referral is ${ref.status}; cannot accept.` }); return; }

  const allItems = await db.select().from(diagnosticReferralItemsTable).where(eq(diagnosticReferralItemsTable.referralId, id));
  const want = parsed.data.itemIds ? new Set(parsed.data.itemIds) : null;
  const targetItems = allItems.filter((it) =>
    (want ? want.has(it.id) : true) &&
    (it.careTestId || it.carePackageId) &&
    !["accepted", "billed", "declined", "cancelled", "sample_collected", "study_scheduled", "in_progress", "completed", "reported", "delivered"].includes(it.itemStatus),
  );
  if (targetItems.length === 0) { res.status(400).json({ error: "No mapped, not-yet-accepted items to accept. Map unmapped tests first." }); return; }

  // Build order lines (expand packages), remembering which referral item each came from.
  const lines: AcceptLine[] = [];
  for (const it of targetItems) {
    let testIds: number[] = [];
    if (it.careTestId) testIds = [it.careTestId];
    else if (it.carePackageId) testIds = await expandTargetToTestIds(db, { mappingId: 0, careTestId: null, carePackageId: it.carePackageId, careDisplayName: null, department: null, modality: null, mappingType: "one_to_package" });
    for (const testId of testIds) lines.push({ referralItemId: it.id, testId, displayName: it.careDisplayName ?? it.sourceTestName });
  }
  if (lines.length === 0) { res.status(400).json({ error: "Selected items expand to no active CARE tests." }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      const order = await createOrAppendCareOrder(tx, {
        existingOrderId: ref.careOrderId ?? null,
        patientId: ref.carePatientId!,
        doctorId: ref.careDoctorId ?? null,
        clinicalHistory: [ref.clinicalHistory, ref.provisionalDiagnosis ? `Provisional Dx: ${ref.provisionalDiagnosis}` : null].filter(Boolean).join(" | ") || null,
        clientRef: ref.referralUuid,
        lines,
      });

      // Link each accepted referral item to its (first) order line + mark accepted.
      const firstOtByItem = new Map<number, number>();
      for (const l of order.lines) if (!firstOtByItem.has(l.referralItemId)) firstOtByItem.set(l.referralItemId, l.orderTestId);
      for (const it of targetItems) {
        await tx.update(diagnosticReferralItemsTable).set({ itemStatus: "accepted", decision: "accept", careOrderTestId: firstOtByItem.get(it.id) ?? null, changedBy: staffName(req) }).where(eq(diagnosticReferralItemsTable.id, it.id));
        await writeReferralEvent(tx, { referralId: id, itemId: it.id, eventType: "item.accepted", actorType: "staff", actorName: staffName(req), organisation: "CARE" });
      }

      // Header status: all items accepted → CARE_ORDER_CREATED, else PARTIALLY_BOOKED.
      const remaining = allItems.filter((it) => !targetItems.find((t) => t.id === it.id) && !["declined", "unavailable", "cancelled"].includes(it.itemStatus) && (it.careTestId || it.carePackageId));
      const nextStatus: ReferralStatus = remaining.length > 0 ? "PARTIALLY_BOOKED" : "CARE_ORDER_CREATED";
      assertTransition(ref.status as ReferralStatus, nextStatus);
      await tx.update(diagnosticReferralsTable).set({ status: nextStatus, careOrderId: order.orderId }).where(eq(diagnosticReferralsTable.id, id));
      await writeReferralEvent(tx, { referralId: id, eventType: "order.created", fromStatus: ref.status, toStatus: nextStatus, actorType: "staff", actorName: staffName(req), organisation: "CARE", payload: { orderId: order.orderId, orderNumber: order.orderNumber, lineCount: order.lines.length } });

      // Emit order.created + per-item status to HOPE.
      await enqueueOutboxEvent(tx, {
        eventType: "diagnostic_order.created", idempotencyKey: `diagnostic_order.created:${ref.referralUuid}:${order.orderId}`,
        correlationId: ref.referralUuid, aggregateType: "diagnostic_referral", aggregateId: ref.referralUuid, partnerId: ref.createdByPartnerId ?? null,
        payload: { referralUuid: ref.referralUuid, careOrderId: order.orderId, careOrderNumber: order.orderNumber, status: nextStatus, acceptedItems: targetItems.map((t) => ({ sourceTestName: t.sourceTestName, sourceTestCode: t.sourceTestCode })) },
      });

      return order;
    });

    res.status(201).json({
      orderId: result.orderId, orderNumber: result.orderNumber, patientId: ref.carePatientId,
      totalAmount: result.totalAmount,
      // Deep link for the existing billing desk to open this order/patient.
      billing: { orderId: result.orderId, patientId: ref.carePatientId, path: `/billing?orderId=${result.orderId}` },
    });
  } catch (e) {
    console.error("[integration] accept failed:", (e as Error)?.message);
    res.status(500).json({ error: "Failed to create CARE order", detail: (e as Error)?.message });
  }
});

// ── Decline selected/all items (or the whole referral) ───────────────────────
const DeclineSchema = z.object({ itemIds: z.array(z.number().int().positive()).optional(), reason: z.string().optional() });
hopeReferralsRouter.post("/:id/decline", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  const parsed = DeclineSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.id, id)).limit(1);
  if (!ref) { res.status(404).json({ error: "Not found" }); return; }
  const reason = parsed.data.reason ?? "declined_by_patient";
  await db.transaction(async (tx) => {
    if (parsed.data.itemIds && parsed.data.itemIds.length) {
      await tx.update(diagnosticReferralItemsTable).set({ itemStatus: "declined", decision: "reject", changeReason: reason, changedBy: staffName(req) }).where(and(eq(diagnosticReferralItemsTable.referralId, id), inArray(diagnosticReferralItemsTable.id, parsed.data.itemIds)));
      await writeReferralEvent(tx, { referralId: id, eventType: "item.declined", actorType: "staff", actorName: staffName(req), organisation: "CARE", reason, payload: { itemIds: parsed.data.itemIds } });
    } else if (isReferralStatus(ref.status)) {
      try { assertTransition(ref.status as ReferralStatus, "PATIENT_DECLINED"); await tx.update(diagnosticReferralsTable).set({ status: "PATIENT_DECLINED" }).where(eq(diagnosticReferralsTable.id, id)); } catch { /* keep status */ }
      await tx.update(diagnosticReferralItemsTable).set({ itemStatus: "declined", decision: "reject", changeReason: reason }).where(eq(diagnosticReferralItemsTable.referralId, id));
      await writeReferralEvent(tx, { referralId: id, eventType: "patient.declined", toStatus: "PATIENT_DECLINED", actorType: "staff", actorName: staffName(req), organisation: "CARE", reason });
    }
  });
  res.json({ ok: true });
});

// ── Cancel referral (before fulfilment) ──────────────────────────────────────
hopeReferralsRouter.post("/:id/cancel", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "cancelled_by_care";
  const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.id, id)).limit(1);
  if (!ref) { res.status(404).json({ error: "Not found" }); return; }
  if (!isReferralStatus(ref.status)) { res.status(409).json({ error: "Unknown state" }); return; }
  try { assertTransition(ref.status as ReferralStatus, "CANCELLED"); } catch (e) { res.status(409).json({ error: (e as Error).message + " — the order is already in fulfilment; use CARE cancellation/refund." }); return; }
  await db.transaction(async (tx) => {
    await tx.update(diagnosticReferralsTable).set({ status: "CANCELLED" }).where(eq(diagnosticReferralsTable.id, id));
    await writeReferralEvent(tx, { referralId: id, eventType: "referral.cancelled", fromStatus: ref.status, toStatus: "CANCELLED", actorType: "staff", actorName: staffName(req), organisation: "CARE", reason });
    await enqueueOutboxEvent(tx, { eventType: "diagnostic_referral.cancelled", idempotencyKey: `diagnostic_referral.cancelled:${ref.referralUuid}`, correlationId: ref.referralUuid, aggregateId: ref.referralUuid, partnerId: ref.createdByPartnerId ?? null, payload: { referralUuid: ref.referralUuid, reason } });
  });
  res.json({ status: "CANCELLED" });
});
