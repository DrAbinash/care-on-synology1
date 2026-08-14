/**
 * CARE-side Emergency Billing reconciliation.
 * Creates canonical orders/bills/payments through the same tables and
 * downstream hooks as the billing desk. Does NOT post accounting or
 * commission itself — autoVoucherForPayment + existing commission reports
 * pick imported bills up because they are ordinary CARE bills with
 * source provenance in notes + emergency_imported_transactions.
 */
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  patientsTable,
  ordersTable,
  orderTestsTable,
  billsTable,
  paymentsTable,
  billAuditsTable,
  emergencyImportedTransactionsTable,
  emergencyReconciliationBatchesTable,
  testsTable,
} from "@workspace/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  applyIdempotentOutcome,
  applyManualPatientResolution,
  classifyPatientMatch,
  emptyImportResult,
  isSafeToAutoImport,
  SOURCE,
  summarizeTransactions,
  type EmergencyTransaction,
  type ImportBatchResult,
  type ImportMethod,
  type MatchCandidate,
  type PreviewRow,
  type ReconciliationSummary,
} from "@workspace/emergency-billing";
import { generateOrderNumber } from "../routes/orders";
import { generateBillNumber } from "../routes/bills";
import { getWalkInLedgerId } from "../routes/ledgers";
import { autoVoucherForPayment } from "./auto-voucher";
import { generateTestTokensForOrder } from "../routes/test-tokens";
import { generateStudiesForOrder } from "../routes/radiology";
import {
  buildEmergencyOrderNotes,
  emergencyClientRef,
  emergencyOrderClientRef,
  mapEmergencyGender,
  synthesizeDob,
} from "./emergencyReconcileHelpers";

import {
  enrichCandidates,
  loadResolutions,
} from "./emergencyPatientResolve";

export {
  buildEmergencyOrderNotes,
  emergencyClientRef,
  emergencyOrderClientRef,
  mapEmergencyGender,
  synthesizeDob,
} from "./emergencyReconcileHelpers";


function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
    const e = cur as { code?: string; message?: string; cause?: unknown };
    if (e.code === "23505") return true;
    if (/duplicate key value violates unique constraint/i.test(e.message ?? "")) return true;
    cur = e.cause;
  }
  return false;
}

export async function loadMatchCandidates(txns: EmergencyTransaction[]): Promise<MatchCandidate[]> {
  const ids = [...new Set(txns.map((t) => t.patient.carePatientId).filter((n): n is number => Number.isInteger(n)))];
  const uhids = [...new Set(txns.map((t) => t.patient.uhid).filter((u): u is string => !!u))];
  const phones = [...new Set(txns.map((t) => t.patient.mobile).filter(Boolean))];
  if (ids.length === 0 && uhids.length === 0 && phones.length === 0) return [];

  const clauses = [];
  if (ids.length) clauses.push(inArray(patientsTable.id, ids));
  if (uhids.length) clauses.push(inArray(patientsTable.patientId, uhids));
  if (phones.length) {
    clauses.push(
      or(
        ...phones.map((p) => {
          const digits = p.replace(/\D/g, "").slice(-10);
          return sql`${patientsTable.phone} LIKE ${"%" + (digits || p) + "%"}`;
        }),
      )!,
    );
  }
  const rows = await db
    .select({
      id: patientsTable.id,
      patientId: patientsTable.patientId,
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      phone: patientsTable.phone,
      gender: patientsTable.gender,
      dateOfBirth: patientsTable.dateOfBirth,
      ageValue: patientsTable.ageValue,
      ageUnit: patientsTable.ageUnit,
      address: patientsTable.address,
    })
    .from(patientsTable)
    .where(or(...clauses))
    .limit(5000);

  return rows.map((r) => ({
    carePatientId: r.id,
    uhid: r.patientId,
    firstName: r.firstName,
    lastName: r.lastName,
    phone: r.phone,
    sex: r.gender,
    dateOfBirth: r.dateOfBirth,
    ageValue: r.ageValue,
    ageUnit: r.ageUnit,
    address: r.address,
  }));
}

export async function alreadyImportedMap(uuids: string[]): Promise<Map<string, { careBillId: number | null }>> {
  const map = new Map<string, { careBillId: number | null }>();
  if (uuids.length === 0) return map;
  const rows = await db
    .select({
      uuid: emergencyImportedTransactionsTable.emergencyTransactionUuid,
      careBillId: emergencyImportedTransactionsTable.careBillId,
    })
    .from(emergencyImportedTransactionsTable)
    .where(inArray(emergencyImportedTransactionsTable.emergencyTransactionUuid, uuids));
  for (const r of rows) map.set(r.uuid, { careBillId: r.careBillId });
  return map;
}

export async function previewEmergencyTransactions(txns: EmergencyTransaction[]): Promise<{
  rows: PreviewRow[];
  summary: ReconciliationSummary;
}> {
  const imported = await alreadyImportedMap(txns.map((t) => t.emergencyTransactionUuid));
  const candidates = await enrichCandidates(await loadMatchCandidates(txns));
  const resolutions = await loadResolutions(txns.map((t) => t.emergencyTransactionUuid));
  const rows: PreviewRow[] = txns.map((t) => {
    const prior = imported.get(t.emergencyTransactionUuid);
    const blocked = t.status === "VOID";
    let match = classifyPatientMatch(
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
    const stored = resolutions.get(t.emergencyTransactionUuid) ?? null;
    if (stored && !prior) {
      match = applyManualPatientResolution(match, stored);
    }
    const chosen = match.candidates.find((c) => c.carePatientId === match.carePatientId) ?? match.candidates[0];
    const resolvedLabel = stored?.carePatientLabel
      || (chosen ? `${chosen.uhid} — ${chosen.firstName} ${chosen.lastName}`.replace(/\s+/g, " ").trim() : null);
    return {
      emergencyTransactionUuid: t.emergencyTransactionUuid,
      emergencyBillNumber: t.emergencyBillNumber,
      matchClass: match.matchClass,
      matchReason: match.reason,
      carePatientId: match.carePatientId,
      carePatientLabel: resolvedLabel,
      alreadyImported: !!prior,
      careBillId: prior?.careBillId ?? null,
      blocked,
      blockReason: blocked ? `VOID: ${t.voidReason || "cancelled on emergency NAS"}` : null,
      transaction: t,
      candidates: match.candidates,
      resolution: stored
        ? {
            action: stored.action,
            carePatientId: stored.carePatientId,
            carePatientLabel: stored.carePatientLabel ?? resolvedLabel,
            resolvedByStaffName: stored.resolvedByStaffName ?? "",
            resolvedAt: stored.resolvedAt ?? "",
          }
        : null,
    };
  });

  const money = summarizeTransactions(txns);
  const first = txns[0];
  const summary: ReconciliationSummary = {
    sessionUuid: first?.emergencySessionUuid ?? null,
    sessionStartedAt: null,
    sessionEndedAt: null,
    ...money,
    exactMatches: rows.filter((r) => r.matchClass === "EXACT_MATCH" && !r.alreadyImported && !r.blocked).length,
    newPatients: rows.filter((r) => r.matchClass === "NEW_PATIENT" && !r.alreadyImported && !r.blocked).length,
    needsReview: rows.filter((r) => r.matchClass === "PROBABLE_MATCH" && !r.alreadyImported && !r.blocked).length,
    conflicts: rows.filter((r) => r.matchClass === "CONFLICT" && !r.alreadyImported && !r.blocked).length,
    alreadyImported: rows.filter((r) => r.alreadyImported).length,
    safeToImport: rows.filter((r) =>
      isSafeToAutoImport(r.matchClass, r.alreadyImported, r.blocked),
    ).length,
  };
  return { rows, summary };
}

export interface ImportOverrides {
  /** Force-import a PROBABLE/CONFLICT row onto a chosen CARE patient. */
  assignPatient?: Record<string, number>;
}

export async function importEmergencyTransactions(opts: {
  transactions: EmergencyTransaction[];
  importMethod: ImportMethod;
  importedBy: string;
  importedByUserId: number | null;
  sourceNas?: string | null;
  onlySafe?: boolean;
  overrides?: ImportOverrides;
}): Promise<{ result: ImportBatchResult; batchUuid: string; preview: PreviewRow[] }> {
  const { rows: preview } = await previewEmergencyTransactions(opts.transactions);
  const batchUuid = randomUUID();
  let result = emptyImportResult();
  const assign = opts.overrides?.assignPatient ?? {};

  const [batch] = await db
    .insert(emergencyReconciliationBatchesTable)
    .values({
      batchUuid,
      emergencySessionUuid: opts.transactions[0]?.emergencySessionUuid ?? null,
      sourceNas: opts.sourceNas ?? null,
      importMethod: opts.importMethod,
      suppliedCount: opts.transactions.length,
      importedBy: opts.importedBy,
      importedByUserId: opts.importedByUserId,
    })
    .returning();

  for (const row of preview) {
    const t = row.transaction;
    if (row.alreadyImported) {
      result = applyIdempotentOutcome(result, "already_reconciled");
      continue;
    }
    if (row.blocked) {
      result = applyIdempotentOutcome(result, "review", t.emergencyTransactionUuid, row.blockReason ?? "void");
      continue;
    }
    const forcedPatientId = assign[t.emergencyTransactionUuid] ?? row.resolution?.carePatientId ?? null;
    const safe = isSafeToAutoImport(row.matchClass, false, false) || Number.isInteger(forcedPatientId);
    if (opts.onlySafe !== false && !safe) {
      result = applyIdempotentOutcome(
        result,
        row.matchClass === "CONFLICT" ? "conflict" : "review",
        t.emergencyTransactionUuid,
        row.matchReason,
      );
      continue;
    }
    try {
      const imported = await importOneTransaction({
        t,
        preview: row,
        forcedPatientId: forcedPatientId ?? null,
        importMethod: opts.importMethod,
        importedBy: opts.importedBy,
        batchId: batch.id,
      });
      result = applyIdempotentOutcome(result, imported === "already" ? "already_reconciled" : "created");
    } catch (err) {
      if (isUniqueViolation(err)) {
        result = applyIdempotentOutcome(result, "already_reconciled");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        result = applyIdempotentOutcome(result, "failure", t.emergencyTransactionUuid, msg);
      }
    }
  }

  await db
    .update(emergencyReconciliationBatchesTable)
    .set({
      suppliedCount: result.supplied,
      importedCount: result.imported,
      alreadyImportedCount: result.alreadyReconciled,
      conflictCount: result.conflicts,
      failureCount: result.failures,
      skippedReviewCount: result.skippedReview,
      resultJson: result as unknown as Record<string, unknown>,
    })
    .where(eq(emergencyReconciliationBatchesTable.id, batch.id));

  return { result, batchUuid, preview };
}

async function nextPatientId(tx: Parameters<Parameters<(typeof db)["transaction"]>[0]>[0]): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('care_erp_patient_id'))`);
  const rows = await tx
    .select({ patientId: patientsTable.patientId })
    .from(patientsTable)
    .where(sql`${patientsTable.patientId} LIKE 'P-%'`);
  let max = 0;
  for (const row of rows) {
    const num = parseInt(String(row.patientId).slice(2).replace(/\D/g, ""), 10);
    if (!Number.isNaN(num) && num > max) max = num;
  }
  return `P-${String(max + 1).padStart(5, "0")}`;
}

async function importOneTransaction(opts: {
  t: EmergencyTransaction;
  preview: PreviewRow;
  forcedPatientId: number | null;
  importMethod: ImportMethod;
  importedBy: string;
  batchId: number;
}): Promise<"created" | "already"> {
  const { t } = opts;
  const clientRef = emergencyClientRef(t.emergencyTransactionUuid);
  const existingBill = await db
    .select({ id: billsTable.id })
    .from(billsTable)
    .where(and(eq(billsTable.clientRef, clientRef), sql`${billsTable.status} != 'cancelled'`))
    .limit(1);
  if (existingBill[0]) {
    await db
      .insert(emergencyImportedTransactionsTable)
      .values({
        emergencyTransactionUuid: t.emergencyTransactionUuid,
        originalEmgBillNumber: t.emergencyBillNumber,
        emergencySessionUuid: t.emergencySessionUuid,
        careBillId: existingBill[0].id,
        carePatientId: null,
        matchClass: opts.preview.matchClass,
        importMethod: opts.importMethod,
        batchId: opts.batchId,
        originalCreatedAt: t.createdAt ? new Date(t.createdAt) : null,
        originalStaff: t.createdByStaffName,
        importedBy: opts.importedBy,
        payloadJson: t as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: emergencyImportedTransactionsTable.emergencyTransactionUuid });
    return "already";
  }

  if (!t.lines.length) throw new Error("Emergency transaction has no line items");
  const serviceIds = t.lines.map((l) => l.careServiceId).filter((id) => Number.isInteger(id) && id > 0);
  if (serviceIds.length !== t.lines.length) throw new Error("Missing canonical CARE service id on a line");
  const catalog = await db.select({ id: testsTable.id }).from(testsTable).where(inArray(testsTable.id, serviceIds));
  const known = new Set(catalog.map((c) => c.id));
  const missing = serviceIds.filter((id) => !known.has(id));
  if (missing.length) throw new Error(`Unknown CARE service ids: ${missing.join(", ")}`);

  const net = Number(t.netAmount);
  const received = Number(t.amountReceived);
  const due = Number(t.dueAmount);
  if (Math.abs(net - received - due) > 0.05) {
    throw new Error(`Due math mismatch: net ${net} received ${received} due ${due}`);
  }

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('care_erp_emergency_import'))`);
    const [dup] = await tx
      .select({ id: emergencyImportedTransactionsTable.id, careBillId: emergencyImportedTransactionsTable.careBillId })
      .from(emergencyImportedTransactionsTable)
      .where(eq(emergencyImportedTransactionsTable.emergencyTransactionUuid, t.emergencyTransactionUuid))
      .limit(1);
    if (dup) return { already: true as const, billId: dup.careBillId, patientId: 0, payments: [] as Array<{ id: number; amount: number; method: string }> };

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('care_erp_bill_number'))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('care_erp_order_number'))`);

    let patientId = opts.forcedPatientId ?? opts.preview.carePatientId;
    if (!patientId) {
      const uhid = t.patient.uhid?.trim();
      const patientNumber = uhid && /^P-\d+/.test(uhid) ? uhid : await nextPatientId(tx);
      const [inserted] = await tx
        .insert(patientsTable)
        .values({
          patientId: patientNumber,
          firstName: t.patient.firstName.trim() || "Unknown",
          lastName: t.patient.lastName.trim() || "-",
          dateOfBirth: synthesizeDob(t.patient),
          gender: mapEmergencyGender(t.patient.sex),
          phone: t.patient.mobile?.trim() || "0000000000",
          ageValue: t.patient.ageValue,
          ageUnit: t.patient.ageUnit,
        })
        .returning();
      patientId = inserted.id;
    }

    const ledgerId = await getWalkInLedgerId();
    const orderNumber = await generateOrderNumber(tx);
    const [order] = await tx
      .insert(ordersTable)
      .values({
        orderNumber,
        patientId,
        doctorId: t.referringDoctorId,
        status: "pending",
        totalAmount: Number(t.grossAmount).toFixed(2),
        notes: buildEmergencyOrderNotes(t),
        ledgerId,
        clientRef: emergencyOrderClientRef(t.emergencyTransactionUuid),
      })
      .returning();

    for (const line of t.lines) {
      const qty = Math.max(1, Math.round(line.quantity || 1));
      for (let i = 0; i < qty; i++) {
        await tx.insert(orderTestsTable).values({
          orderId: order.id,
          testId: line.careServiceId,
          price: Number(line.unitPrice).toFixed(2),
          displayName: line.serviceName || null,
        });
      }
    }

    const billNumber = await generateBillNumber(ledgerId, tx);
    const paid = Math.max(0, received);
    const balance = Math.max(0, net - paid);
    const status = paid >= net - 0.01 ? "paid" : paid > 0 ? "partial" : "pending";
    const actor = `${opts.importedBy} / ${t.createdByStaffName}`.slice(0, 200);

    const [bill] = await tx
      .insert(billsTable)
      .values({
        billNumber,
        orderId: order.id,
        patientId,
        subtotal: Number(t.grossAmount).toFixed(2),
        discount: Number(t.discountAmount).toFixed(2),
        discountReason: t.discountReason,
        taxAmount: "0.00",
        totalAmount: net.toFixed(2),
        originalTotal: net.toFixed(2),
        paidAmount: paid.toFixed(2),
        balanceAmount: balance.toFixed(2),
        status,
        ledgerId,
        createdByName: actor,
        clientRef,
      })
      .returning();

    await tx.insert(billAuditsTable).values({
      billId: bill.id,
      editedBy: actor,
      reason: "Emergency billing import",
      changeType: "bill_created",
      oldValue: null,
      newValue: `source=${SOURCE}; emg=${t.emergencyBillNumber}; uuid=${t.emergencyTransactionUuid}; total=₹${net.toFixed(2)}; paid=₹${paid.toFixed(2)}; due=₹${balance.toFixed(2)}`,
    });

    const payments: Array<{ id: number; amount: number; method: string }> = [];
    const splits = t.payments.filter((p) => p.amount > 0);
    const toInsert = splits.length
      ? splits
      : paid > 0
        ? [{ method: "cash" as const, amount: paid, referenceNumber: null }]
        : [];
    for (const p of toInsert) {
      const [pay] = await tx
        .insert(paymentsTable)
        .values({
          billId: bill.id,
          amount: Number(p.amount).toFixed(2),
          method: p.method || "cash",
          referenceNumber: p.referenceNumber ?? `EMG-${t.emergencyBillNumber}`,
          notes: `source=${SOURCE}; emergency_transaction_uuid=${t.emergencyTransactionUuid}`,
          recordedByName: actor,
        })
        .returning();
      payments.push({ id: pay.id, amount: Number(p.amount), method: p.method || "cash" });
    }

    await tx.insert(emergencyImportedTransactionsTable).values({
      emergencyTransactionUuid: t.emergencyTransactionUuid,
      originalEmgBillNumber: t.emergencyBillNumber,
      emergencySessionUuid: t.emergencySessionUuid,
      careBillId: bill.id,
      carePatientId: patientId,
      matchClass: opts.forcedPatientId ? "EXACT_MATCH" : opts.preview.matchClass,
      importMethod: opts.importMethod,
      batchId: opts.batchId,
      originalCreatedAt: t.createdAt ? new Date(t.createdAt) : null,
      originalStaff: t.createdByStaffName,
      importedBy: opts.importedBy,
      payloadJson: t as unknown as Record<string, unknown>,
    });

    return { already: false as const, billId: bill.id, patientId, payments, billNumber: bill.billNumber, actor };
  });

  if (created.already) return "already";

  const ledgerId = await getWalkInLedgerId();
  const [orderRow] = await db
    .select({ id: ordersTable.id, patientId: ordersTable.patientId })
    .from(ordersTable)
    .where(eq(ordersTable.clientRef, emergencyOrderClientRef(t.emergencyTransactionUuid)))
    .limit(1);
  if (orderRow) {
    generateStudiesForOrder({
      billId: created.billId!,
      orderId: orderRow.id,
      patientId: orderRow.patientId,
      priority: "emergency",
      dicomFields: t.referringDoctorName ? { referringDoctor: t.referringDoctorName } : undefined,
    }).catch((err) => console.warn("[emergency-import] study fan-out failed", err));
    generateTestTokensForOrder({
      ledgerId,
      billId: created.billId!,
      orderId: orderRow.id,
      patientId: orderRow.patientId,
      source: SOURCE,
    }).catch((err) => console.warn("[emergency-import] token fan-out failed", err));
  }

  const [pat] = await db.select().from(patientsTable).where(eq(patientsTable.id, created.patientId));
  const patientName = pat ? `${pat.firstName} ${pat.lastName}`.trim() : t.patient.firstName;
  for (const p of created.payments) {
    autoVoucherForPayment({
      billId: created.billId!,
      amount: p.amount,
      method: p.method,
      billNumber: created.billNumber!,
      patientName,
      performedBy: created.actor,
      paymentId: p.id,
    }).catch(() => {
      /* already logged */
    });
  }

  return "created";
}
