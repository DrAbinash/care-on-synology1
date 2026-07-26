import { Router } from "express";
import { db, billsTable, paymentsTable, ordersTable, patientsTable } from "@workspace/db";
import { billAuditsTable, superAdminSessionsTable, ledgersTable } from "@workspace/db/schema";
import { sendBillEditEmail, sendBillReprintEmail } from "../email";
import { isValidUsbKey, isUsbGateEnforced, getUsbKeyHeader } from "../middleware/requireSuperAdminUsb";
import { auditFromRequest } from "../lib/audit";
import { lastOverallClosureBoundary, isBeforeClosureBoundary } from "../lib/closureBoundary";
import type { Request, Response } from "express";

/**
 * Reject super-admin bill mutations if the USB pen-drive gate is enforced and
 * the request does not carry a valid X-SA-USB-Key header. Returns true when
 * the response has been sent (caller should return). Centralised here so the
 * super-admin token flow used by /:id/super-edit and DELETE /:id matches the
 * rest of the super-admin surface.
 *
 * If the user has remoteLoginEnabled, the USB check is skipped on routes that
 * already validated the session token via requireSuperAdmin. For the direct
 * bill-mutation routes the caller should just pass the USB key header.
 */
function rejectIfUsbMissing(req: Request, res: Response): boolean {
  if (!isUsbGateEnforced()) return false;
  const usb = getUsbKeyHeader(req);
  if (!usb || !isValidUsbKey(usb)) {
    res.status(401).json({ error: "USB key required" });
    return true;
  }
  return false;
}
import { generateTokenForBill } from "./tokens";
import { generateTestTokensForOrder } from "./test-tokens";
import { generateStudiesForOrder } from "./radiology";
import { sendBillWhatsapp } from "./whatsapp";
import { autoVoucherForPayment } from "../lib/auto-voucher";
import { getSlowThresholdMs } from "../lib/requestMetrics";
import { eq, and, sql, desc, like, or, gt, ne, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  ListBillsQueryParams,
  CreateBillBody,
  GetBillParams,
  UpdateBillParams,
  UpdateBillBody,
  CreatePaymentBody,
  ListPaymentsQueryParams,
  SuperEditBillParams,
  SuperEditBillBody,
  DeleteBillParams,
  DeleteBillBody,
  LogBillReprintParams,
  LogBillReprintBody,
  ListBillAuditsParams,
  CancelBillParams,
  CancelBillBody,
  CancelRefundTestsBody,
  RefundBillParams,
  RefundBillBody,
} from "@workspace/api-zod";
import { orderTestsTable, testsTable, doctorsTable, clinicSettingsTable } from "@workspace/db";
import { sanitizePatient } from "./patients";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { FULL_ACCESS_ROLES, requireStaffSubPermission } from "../middleware/requireStaffAuth";
import { getWalkInLedgerId } from "./ledgers";

export const billsRouter = Router();
export const paymentsRouter = Router();

// Per-ledger counter — id=1 (default) also includes legacy NULL rows
async function countBillsForLedger(ledgerId: number): Promise<number> {
  const where = ledgerId === 1
    ? sql`${billsTable.ledgerId} = 1 OR ${billsTable.ledgerId} IS NULL`
    : sql`${billsTable.ledgerId} = ${ledgerId}`;
  const r = await db.select({ count: sql<number>`count(*)` }).from(billsTable).where(where);
  return Number(r[0]?.count ?? 0);
}

// Takes the order row the caller already holds (this runs inside the hot
// save-and-print guard wave — no re-select).
async function resolveLedgerForOrder(order: typeof ordersTable.$inferSelect): Promise<number> {
  if (order.ledgerId) return order.ledgerId;
  if (order.doctorId) {
    const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, order.doctorId));
    if (d?.ledgerId) return d.ledgerId;
  }
  // Walk-in / no-referral: route to the designated walk-in ledger
  return getWalkInLedgerId();
}

/**
 * Bill numbers are pure-numeric: YYYYMM + 4-digit sequence (e.g. 2026050001).
 * Older rows in the DB may still carry the legacy `BILL-YYYYMM-####` prefix;
 * `parseBillNumberParts` handles both shapes so the renumber logic keeps
 * working across the migration.
 */
// A pooled db handle OR an open transaction — callers holding the bill-number
// advisory lock MUST pass their `tx` (see the note below), so the type admits it.
type DbOrTx = typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];
export async function generateBillNumber(_ledgerId: number, dbHandle: DbOrTx = db): Promise<string> {
  const date = new Date();
  const yyyymm = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
  // Use the global MAX across ALL numeric bills, not a per-ledger count.
  // COUNT per ledger breaks when multiple ledgers share the same bill_number
  // unique space — ledger A and B independently arrive at the same sequence
  // number and collide on the UNIQUE constraint.
  //
  // Callers that hold the care_erp_bill_number advisory lock (see call sites
  // in this file and self-registration.ts) MUST pass their `tx` handle here,
  // not the pooled `db`. The lock only serializes concurrent callers against
  // each other if this SELECT runs on the same connection/transaction that
  // holds the lock — using a separate pooled connection here would also
  // reintroduce a connection-pool deadlock under load (every concurrent
  // transaction blocked on the lock holds a pool connection; the lock
  // holder's own generateBillNumber call would then have no free connection
  // left to borrow, since the pool has a fixed max size).
  const [row] = await dbHandle
    .select({ maxBill: sql<string | null>`MAX(bill_number)` })
    .from(billsTable)
    .where(sql`bill_number ~ '^[0-9]+$'`);
  let seq = 1;
  if (row?.maxBill) {
    const parts = parseBillNumberParts(row.maxBill);
    if (parts) seq = parts.seq + 1;
  }
  return `${yyyymm}${String(seq).padStart(4, "0")}`;
}

function parseBillNumberParts(billNumber: string): { monthPrefix: string; seq: number } | null {
  const legacy = billNumber.match(/^BILL-(\d{6})-(\d+)$/);
  if (legacy) return { monthPrefix: legacy[1]!, seq: Number(legacy[2]) };
  const numeric = billNumber.match(/^(\d{6})(\d{4,})$/);
  if (numeric) return { monthPrefix: numeric[1]!, seq: Number(numeric[2]) };
  return null;
}

async function buildBill(bill: typeof billsTable.$inferSelect) {
  // Runs on the hot save-and-print path (and once per row on the bills list),
  // so the independent lookups are batched instead of awaited one by one.
  const [[patient], [order], payments] = await Promise.all([
    db.select().from(patientsTable).where(eq(patientsTable.id, bill.patientId)),
    db.select().from(ordersTable).where(eq(ordersTable.id, bill.orderId)),
    db.select().from(paymentsTable).where(eq(paymentsTable.billId, bill.id)).orderBy(desc(paymentsTable.createdAt)),
  ]);

  let orderDetails = null;
  if (order) {
    const [orderTestRows, doctorRows] = await Promise.all([
      db
        .select({ orderTest: orderTestsTable, test: testsTable })
        .from(orderTestsTable)
        .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
        .where(eq(orderTestsTable.orderId, order.id)),
      order.doctorId
        ? db.select().from(doctorsTable).where(eq(doctorsTable.id, order.doctorId))
        : Promise.resolve([] as (typeof doctorsTable.$inferSelect)[]),
    ]);

    const doctor = doctorRows[0] ?? null;

    orderDetails = {
      ...order,
      totalAmount: Number(order.totalAmount),
      patient: patient ? sanitizePatient(patient) : null,
      doctor,
      tests: orderTestRows.map((ot) => ({
        ...ot.orderTest,
        price: Number(ot.orderTest.price),
        displayName: ot.orderTest.displayName ?? null,
        test: ot.test ? { ...ot.test, price: Number(ot.test.price) } : null,
      })),
    };
  }

  return {
    ...bill,
    subtotal: Number(bill.subtotal),
    discount: Number(bill.discount),
    taxAmount: Number(bill.taxAmount),
    totalAmount: Number(bill.totalAmount),
    originalTotal: Number(bill.originalTotal),
    paidAmount: Number(bill.paidAmount),
    balanceAmount: Number(bill.balanceAmount),
    patient: patient ? sanitizePatient(patient) : null,
    order: orderDetails,
    payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
  };
}

billsRouter.get("/creators", async (_req, res) => {
  const rows = await db
    .selectDistinct({ createdByName: billsTable.createdByName })
    .from(billsTable)
    .where(sql`${billsTable.createdByName} IS NOT NULL AND ${billsTable.createdByName} != ''`)
    .orderBy(billsTable.createdByName);
  return res.json(rows.map((r) => r.createdByName));
});

billsRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const dueOnly = req.query.dueOnly === "1" || req.query.dueOnly === "true";
  if (q.length < 2) {
    res.json([]);
    return;
  }
  const pattern = `%${q.toLowerCase()}%`;
  const rows = await db
    .select({
      id: billsTable.id,
      billNumber: billsTable.billNumber,
      totalAmount: billsTable.totalAmount,
      paidAmount: billsTable.paidAmount,
      balanceAmount: billsTable.balanceAmount,
      status: billsTable.status,
      createdAt: billsTable.createdAt,
      patientName: sql<string>`${patientsTable.firstName} || ' ' || ${patientsTable.lastName}`,
      patientId: patientsTable.patientId,
      phone: patientsTable.phone,
      doctorName: doctorsTable.name,
    })
    .from(billsTable)
    .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .leftJoin(ordersTable, eq(billsTable.orderId, ordersTable.id))
    .leftJoin(doctorsTable, eq(ordersTable.doctorId, doctorsTable.id))
    .where(
      and(
        or(
          sql`LOWER(${billsTable.billNumber}) LIKE ${pattern}`,
          sql`LOWER(${patientsTable.firstName} || ' ' || ${patientsTable.lastName}) LIKE ${pattern}`,
          sql`LOWER(${patientsTable.patientId}) LIKE ${pattern}`,
          sql`${patientsTable.phone} LIKE ${pattern}`,
        ),
        dueOnly ? gt(sql`${billsTable.balanceAmount}::numeric`, sql`0`) : undefined,
      ),
    )
    .orderBy(desc(billsTable.createdAt))
    .limit(15);

  res.json(
    rows.map((r) => ({
      ...r,
      totalAmount: Number(r.totalAmount),
      paidAmount: Number(r.paidAmount),
      balanceAmount: Number(r.balanceAmount),
      doctorName: r.doctorName ?? null,
    })),
  );
});

billsRouter.get("/preview-number", async (req, res) => {
  // Either ledgerId or doctorId must resolve to a valid ledger. We refuse to
  // silently default to ledger #1 because that misnumbers and mis-attributes
  // bills for any branch other than the first.
  const doctorIdRaw = req.query.doctorId;
  const ledgerIdRaw = req.query.ledgerId;
  let ledgerId: number | null = null;
  if (ledgerIdRaw !== undefined && ledgerIdRaw !== "") {
    const n = Number(ledgerIdRaw);
    if (!Number.isInteger(n) || n < 1) {
      return res.status(400).json({ error: "Invalid request", details: [{ path: ["ledgerId"], message: "ledgerId must be a positive integer" }] });
    }
    const [lg] = await db.select({ id: ledgersTable.id }).from(ledgersTable).where(eq(ledgersTable.id, n));
    if (!lg) {
      return res.status(400).json({ error: "Invalid request", details: [{ path: ["ledgerId"], message: `Ledger with id ${n} does not exist.` }] });
    }
    ledgerId = n;
  } else if (doctorIdRaw !== undefined && doctorIdRaw !== "") {
    const docId = Number(doctorIdRaw);
    if (!Number.isInteger(docId) || docId < 1) {
      return res.status(400).json({ error: "Invalid request", details: [{ path: ["doctorId"], message: "doctorId must be a positive integer" }] });
    }
    const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, docId));
    if (!d) {
      return res.status(400).json({ error: "Invalid request", details: [{ path: ["doctorId"], message: `Doctor with id ${docId} does not exist.` }] });
    }
    if (d.ledgerId == null) {
      return res.status(400).json({ error: "Invalid request", details: [{ path: ["doctorId"], message: `Doctor ${docId} has no ledger assigned; specify ledgerId explicitly.` }] });
    }
    ledgerId = d.ledgerId;
  } else {
    // No params given — use the designated walk-in ledger (falls back to id=1 if none tagged)
    ledgerId = await getWalkInLedgerId();
  }
  const next = await generateBillNumber(ledgerId);
  return res.json({ next, ledgerId });
});

billsRouter.get("/", async (req, res) => {
  const parsed = ListBillsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }
  const { status, patientId, page = 1, limit = 20 } = parsed.data;
  const offset = (page - 1) * limit;

  // Extra filters not in the strict zod schema: dues-only + date range. These
  // are read directly from req.query so we don't have to round-trip OpenAPI
  // codegen. Powers the Dues report page.
  const dueOnly = req.query.dueOnly === "1" || req.query.dueOnly === "true";
  // When no specific status filter is set, callers can pass excludeCancelled=1
  // to suppress cancelled rows (default view on the Bills page).
  const excludeCancelled = req.query.excludeCancelled === "1" || req.query.excludeCancelled === "true";
  const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom ? req.query.dateFrom : null;
  const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo ? req.query.dateTo : null;
  const dateField = req.query.dateField === "due" ? "due" : "created";
  const createdBy = typeof req.query.createdBy === "string" && req.query.createdBy ? req.query.createdBy : null;

  // ISO date strings only — basic guard against SQL injection via the raw fragments.
  const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (dateFrom && !isoDateRe.test(dateFrom)) {
    res.status(400).json({ error: "dateFrom must be YYYY-MM-DD" });
    return;
  }
  if (dateTo && !isoDateRe.test(dateTo)) {
    res.status(400).json({ error: "dateTo must be YYYY-MM-DD" });
    return;
  }

  const conditions: (ReturnType<typeof eq> | ReturnType<typeof gt> | ReturnType<typeof sql>)[] = [];
  if (status) conditions.push(eq(billsTable.status, status));
  else if (excludeCancelled) conditions.push(ne(billsTable.status, "cancelled"));
  if (patientId) conditions.push(eq(billsTable.patientId, patientId));
  if (dueOnly) {
    // Only include bills with an actual outstanding balance AND not cancelled.
    // Cancelled bills should have balanceAmount=0 already (zeroed on cancel),
    // but the status exclusion is a safety net for any legacy rows.
    conditions.push(gt(sql`${billsTable.balanceAmount}::numeric`, sql`0`));
    conditions.push(ne(billsTable.status, "cancelled"));
  }
  if (createdBy) {
    conditions.push(sql`${billsTable.createdByName} = ${createdBy}`);
  }
  if (dateFrom || dateTo) {
    if (dateField === "due") {
      // Bills only have a due date when one was set; bills with NULL dueDate are excluded by this filter.
      if (dateFrom) conditions.push(sql`${billsTable.dueDate} >= ${dateFrom}` as unknown as ReturnType<typeof eq>);
      if (dateTo) conditions.push(sql`${billsTable.dueDate} <= ${dateTo}` as unknown as ReturnType<typeof eq>);
    } else {
      // Compare on the date portion of created_at, in the server's local timezone.
      if (dateFrom) conditions.push(sql`(${billsTable.createdAt})::date >= ${dateFrom}::date` as unknown as ReturnType<typeof eq>);
      if (dateTo) conditions.push(sql`(${billsTable.createdAt})::date <= ${dateTo}::date` as unknown as ReturnType<typeof eq>);
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [bills, countResult, totalsResult] = await Promise.all([
    db.select().from(billsTable).where(where).orderBy(desc(billsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(billsTable).where(where),
    // Aggregate totals across the FULL filtered set (not just the current page) — used by the Dues card.
    db.select({
      totalAmount: sql<string>`COALESCE(SUM(${billsTable.totalAmount}::numeric), 0)`,
      paidAmount: sql<string>`COALESCE(SUM(${billsTable.paidAmount}::numeric), 0)`,
      balanceAmount: sql<string>`COALESCE(SUM(${billsTable.balanceAmount}::numeric), 0)`,
      refundAmount: sql<string>`COALESCE(SUM(${billsTable.refundAmount}::numeric), 0)`,
    }).from(billsTable).where(where),
  ]);

  const billsWithDetails = await Promise.all(bills.map(buildBill));
  res.json({
    bills: billsWithDetails,
    total: Number(countResult[0]?.count ?? 0),
    page,
    limit,
    totals: {
      totalAmount: Number(totalsResult[0]?.totalAmount ?? 0),
      paidAmount: Number(totalsResult[0]?.paidAmount ?? 0),
      balanceAmount: Number(totalsResult[0]?.balanceAmount ?? 0),
      refundAmount: Number(totalsResult[0]?.refundAmount ?? 0),
    },
  });
});

billsRouter.post("/", async (req: StaffAuthRequest, res) => {
  const payload = req.body?.data ?? req.body ?? {};
  const parsed = CreateBillBody.safeParse(payload);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const { orderId, discount = 0, dueDate, clientRef } = parsed.data;
  const startedAt = Date.now();
  const inlinePayments = Array.isArray(payload.payments) ? payload.payments : [];
  const discountReason = typeof payload?.discountReason === "string" ? payload.discountReason.trim() || null : null;
  const discountReasonNote = typeof payload?.discountReasonNote === "string" ? payload.discountReasonNote.trim() || null : null;
  const isVip = !!payload?.isVip;

  // ── Idempotency check — clientRef deduplication ───────────────────────────
  // If this request carries a clientRef UUID, check whether a bill was already
  // created for it. If yes, return the existing bill immediately (HTTP 200).
  // This makes POST /api/bills safe to retry after a network timeout — the
  // browser gets the real bill response instead of a duplicate or a 409.
  if (clientRef) {
    const existingByRef = await db.execute<{ id: number }>(
      sql`SELECT id FROM bills WHERE client_ref = ${clientRef} AND status != 'cancelled' LIMIT 1`
    );
    const refRows = Array.isArray(existingByRef) ? existingByRef : (existingByRef as any).rows ?? [];
    const refId: number | undefined = refRows[0]?.id;
    if (refId) {
      const [existingBillRow] = await db.select().from(billsTable)
        .where(eq(billsTable.id, refId));
      if (existingBillRow) {
        // Return the same shape the original creation would have returned
        res.status(200).json({
          id: existingBillRow.id,
          billNumber: existingBillRow.billNumber,
          _idempotent: true, // signals the frontend this is a replayed response
        });
        return;
      }
    }
  }

  if (discount > 0 && !discountReason) {
    res.status(400).json({ error: "Discount reason is required when a discount is given" });
    return;
  }

  // Optional DICOM MWL fields captured at billing desk and written into the
  // auto-generated radiology study rows. Not part of the Zod schema so we read
  // them directly from the raw payload — same pattern as discountReason above.
  const rawDicom = payload?.dicomFields;
  const dicomFields: { studyDescription?: string; bodyPart?: string; scheduledStationAETitle?: string; referringDoctor?: string } | undefined =
    rawDicom && typeof rawDicom === "object"
      ? {
          studyDescription: typeof rawDicom.studyDescription === "string" ? rawDicom.studyDescription.trim() || undefined : undefined,
          bodyPart: typeof rawDicom.bodyPart === "string" ? rawDicom.bodyPart.trim() || undefined : undefined,
          scheduledStationAETitle: typeof rawDicom.scheduledStationAETitle === "string" ? rawDicom.scheduledStationAETitle.trim() || undefined : undefined,
          referringDoctor: typeof rawDicom.referringDoctor === "string" ? rawDicom.referringDoctor.trim() || undefined : undefined,
        }
      : undefined;

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  // The guard lookups, order-line fetch, ledger resolution, and Form-F clinic
  // flags are all independent once the order row is loaded — batch them into
  // one round-trip wave instead of five sequential awaits. This is the hot
  // billing-desk save path; every serial round-trip here delays the receipt
  // print. Result checks below run in the original order so error precedence
  // is unchanged.
  const tenSecondsAgo = new Date(Date.now() - 60_000); // 60s window (was 10s) — covers slow connections and timeout retries
  const [existingBillRows, existingRecentRows, orderLineTests, ledgerId, formFClinic] = await Promise.all([
    db
      .select({ id: billsTable.id, billNumber: billsTable.billNumber })
      .from(billsTable)
      .where(and(eq(billsTable.orderId, orderId), ne(billsTable.status, "cancelled")))
      .limit(1),
    // Skipped entirely when the caller sent a clientRef: the idempotency
    // check above (lines ~376-395) already matches THIS exact submission
    // precisely by UUID, which is what this guard exists to catch ("network
    // retries" per the comment below). Without this skip, a billing-desk
    // user who legitimately bills the same patient twice in quick succession
    // (e.g. a forgotten test added as a second order) gets falsely blocked
    // for up to 60s even though clientRef proves this is a brand-new,
    // distinct submission, not a retry of the first one.
    clientRef
      ? Promise.resolve([] as { id: number; billNumber: string }[])
      : db
          .select({ id: billsTable.id, billNumber: billsTable.billNumber })
          .from(billsTable)
          .where(and(
            eq(billsTable.patientId, order.patientId),
            ne(billsTable.status, "cancelled"),
            gt(billsTable.createdAt, tenSecondsAgo),
          ))
          .limit(1),
    db
      .select({ testId: orderTestsTable.testId, isActive: testsTable.isActive, name: testsTable.name })
      .from(orderTestsTable)
      .innerJoin(testsTable, eq(testsTable.id, orderTestsTable.testId))
      .where(eq(orderTestsTable.orderId, orderId)),
    resolveLedgerForOrder(order),
    // Only shapes the response at the very end; a failure here must not fail
    // billing, so it degrades to null instead of rejecting the whole wave.
    db
      .select({ formFTestIds: clinicSettingsTable.formFTestIds, formFBillingPrompt: clinicSettingsTable.formFBillingPrompt })
      .from(clinicSettingsTable)
      .limit(1)
      .then((rows) => rows[0] ?? null)
      .catch((e) => {
        req.log?.warn?.({ err: e }, "Form-F billing prompt check failed");
        return null;
      }),
  ]);

  // Guard against double-billing:
  // 1) Same order — prevents re-billing an order that already has a bill.
  // 2) Same patient within 60s, clientRef-less requests only — a fallback
  //    fence for callers that don't send an idempotency key (multi-tab
  //    races, keyboard+click races). Callers that do send a clientRef are
  //    already deduplicated precisely above, so this is skipped for them.
  const [existingBill] = existingBillRows;
  if (existingBill) {
    res.status(409).json({
      error: `This order already has an active bill (${existingBill.billNumber}). Cancel it first before creating a new one.`,
    });
    return;
  }

  const [existingRecent] = existingRecentRows;
  if (existingRecent) {
    res.status(409).json({
      error: `A bill for this patient was just created (${existingRecent.billNumber}). Please wait a few seconds before billing again.`,
    });
    return;
  }

  // Refuse to bill against an order that contains discontinued / removed tests
  // (matches the same guard applied at order creation in orders.ts). Catches
  // the case where a test is deactivated *between* order creation and billing.
  const inactiveLineTests = orderLineTests.filter((t) => !t.isActive);
  if (inactiveLineTests.length > 0) {
    res.status(400).json({
      error: "Invalid request",
      details: [{
        path: ["orderId"],
        message: `Order contains discontinued tests and cannot be billed: ${inactiveLineTests.map((t) => `#${t.testId} ${t.name}`).join(", ")}. Edit the order to remove them.`,
      }],
    });
    return;
  }

  const subtotal = Number(order.totalAmount);
  const discountAmt = Number(discount);

  if (!Number.isFinite(discountAmt) || discountAmt < 0) {
    res.status(400).json({ error: "Discount must be zero or a positive number" });
    return;
  }
  if (discountAmt > subtotal) {
    res.status(400).json({ error: `Discount (${discountAmt.toFixed(2)}) cannot exceed subtotal (${subtotal.toFixed(2)})` });
    return;
  }

  const session = req.staffSession;
  const actorName = session?.subjectName?.trim() || "";
  if (session && !FULL_ACCESS_ROLES.has(session.role) && discountAmt > 0) {
    const maxPct = session.maxDiscount ?? 0;
    const maxAllowed = Math.round((subtotal * maxPct / 100) * 100) / 100;
    if (discountAmt > maxAllowed + 0.01) {
      res.status(403).json({ error: `Your maximum allowed discount is ${maxPct}% (₹${maxAllowed.toFixed(2)} on this bill). Please ask an admin to apply a higher discount.` });
      return;
    }
  }

  const taxAmount = 0;
  const totalAmount = subtotal - discountAmt + taxAmount;

  // Atomically: generate bill number, backfill order's ledgerId, bind patient
  // to ledger, and insert the bill row. Previously these were 3-4 sequential
  // writes outside any transaction — a mid-flight failure (e.g. unique-key
  // collision on billNumber) would leave the order/patient mutated with no
  // matching bill row.
  const txStartedAt = Date.now();
  const { bill, pat, validPayments: txPayments } = await db.transaction(async (tx) => {
    // Serialize bill-number allocation across concurrent requests. Without
    // this, two overlapping POST /api/bills calls (two billing counters
    // saving within the same instant, a busy clinic's normal case) can both
    // read the same MAX(bill_number) via generateBillNumber() before either
    // commits, then both try to INSERT the same bill_number — one succeeds,
    // the other throws a raw 23505 unique-violation that surfaces to the
    // billing desk as an opaque "Internal server error" (bill not saved, no
    // indication a retry would work). pg_advisory_xact_lock serializes the
    // read-then-insert critical section per Postgres session and releases
    // automatically on commit/rollback — same pattern already used for
    // patient_id generation (see generatePatientId in patients.ts) and the
    // audit hash chain (see AUDIT_CHAIN_XACT_LOCK in lib/audit.ts).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('care_erp_bill_number'))`);
    const billNumber = await generateBillNumber(ledgerId, tx);

    if (!order.ledgerId) {
      await tx.update(ordersTable).set({ ledgerId }).where(eq(ordersTable.id, orderId));
    }
    const [patRow] = await tx.select().from(patientsTable).where(eq(patientsTable.id, order.patientId));
    if (patRow && !patRow.ledgerId) {
      await tx.update(patientsTable).set({ ledgerId }).where(eq(patientsTable.id, patRow.id));
    }

    // Compute paid amount from inline payments (validated amount > 0 by schema) - exclude pending "online" gateway payments
    const validPayments = (inlinePayments as Array<{ amount: number; method?: string; referenceNumber?: string; notes?: string }>).filter((p) => Number.isFinite(p.amount) && p.amount > 0 && p.method !== "online");
    const paidAmountInline = validPayments.reduce((s, p) => s + p.amount, 0);
    const balanceAmountInline = Math.max(0, totalAmount - paidAmountInline);
    const billStatus = paidAmountInline >= totalAmount - 0.01 ? "paid" : paidAmountInline > 0 ? "partial" : "pending";

    const [billRow] = await tx.insert(billsTable).values({
      billNumber,
      orderId,
      patientId: order.patientId,
      subtotal: subtotal.toFixed(2),
      discount: discountAmt.toFixed(2),
      discountReason,
      discountReasonNote,
      taxAmount: taxAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      originalTotal: totalAmount.toFixed(2),
      paidAmount: paidAmountInline.toFixed(2),
      balanceAmount: balanceAmountInline.toFixed(2),
      status: billStatus,
      ledgerId,
      dueDate: dueDate ?? null,
      createdByName: actorName || null,
      // Store idempotency key so retries return this bill, not a duplicate
      clientRef: clientRef ?? null,
    }).returning();

    // Record each payment split atomically with the bill
    for (const p of validPayments) {
      await tx.insert(paymentsTable).values({
        billId: billRow.id,
        amount: p.amount.toFixed(2),
        method: p.method || "cash",
        referenceNumber: p.referenceNumber ?? null,
        notes: p.notes ?? null,
        recordedByName: actorName || null,
      });
    }

    return { bill: billRow, pat: patRow, validPayments };
  });

  const txnDoneAt = Date.now();

  // Radiology study fan-out — fire-and-forget. The billing desk's receipt and
  // token slip never show study/accession data, and study creation for a
  // multi-modality bill is the single slowest post-commit chain (per-study
  // accession allocation, priority, and radiologist auto-assignment). It was
  // already best-effort ("failure is logged but never blocks bill creation"),
  // so it no longer gates the HTTP response either — the studies appear in
  // the radiology worklist within a moment of the bill saving, long before
  // the patient reaches the room. Idempotent per orderTest via
  // `radiology_studies_order_test_uq`, so a crash-and-retry cannot duplicate.
  generateStudiesForOrder({
    billId: bill.id,
    orderId: order.id,
    patientId: order.patientId,
    priority: isVip ? "vip" : "routine",
    dicomFields,
  }).catch((err) => {
    console.warn("Radiology study fan-out failed:", err);
  });

  // Post-commit fan-out that the response DOES need — the queue token and the
  // per-test department tokens are printed on the token slip, so they must be
  // in the response body. They hit different tables and run concurrently with
  // each other AND with buildBill (which only reads rows the transaction
  // above already committed), so the desk waits for the slowest of the three,
  // not the sum. Each token failure is logged but never blocks bill creation.
  const [tokenInfo, testTokens, built] = await Promise.all([
    generateTokenForBill({
      ledgerId,
      billId: bill.id,
      patientId: order.patientId,
      priority: isVip ? 5 : 0,
    }).catch((err) => {
      console.warn("Token generation failed:", err);
      return null;
    }),
    generateTestTokensForOrder({
      ledgerId,
      billId: bill.id,
      orderId: order.id,
      patientId: order.patientId,
      priority: isVip ? 5 : 0,
    }).catch((err) => {
      console.warn("Per-test token generation failed:", err);
      return [];
    }),
    buildBill(bill),
  ]);

  // Auto-generate accounting vouchers for each inline payment — async, never blocks billing
  const patientName = pat ? `${pat.firstName} ${pat.lastName}`.trim() : undefined;
  for (const p of txPayments ?? []) {
    autoVoucherForPayment({
      billId: bill.id,
      amount: p.amount,
      method: p.method || "cash",
      billNumber: bill.billNumber,
      patientName,
      performedBy: actorName || null,
    }).catch(() => {/* already logged inside */});
  }

  // Fire WhatsApp send asynchronously — don't block the response
  if (pat?.phone && tokenInfo) {
    sendBillWhatsapp({
      phone: pat.phone,
      patientName: `${pat.firstName} ${pat.lastName}`.trim(),
      billNumber: bill.billNumber,
      totalAmount,
      tokenNo: tokenInfo.tokenNo,
    }).catch((err) => console.warn("WhatsApp send failed:", err));
  }

  // Determine if this bill contains any Form-F-required tests so the billing
  // desk can prompt for address + guardian name when the clinic setting is on.
  // Uses the clinic row pre-fetched in the parallel wave above.
  let needsFormFData = false;
  try {
    if (formFClinic?.formFBillingPrompt) {
      const formFTestIds: number[] = JSON.parse(formFClinic.formFTestIds ?? "[]");
      needsFormFData = formFTestIds.length > 0 && orderLineTests.some((t) => formFTestIds.includes(t.testId));
    }
  } catch (e) {
    req.log?.warn?.({ err: e }, "Form-F billing prompt check failed");
  }

  const onlinePayment = (inlinePayments as Array<{ amount: number; method?: string }>).find(p => p.method === "online");
  const needsOnlinePayment = !!onlinePayment;
  const onlineAmount = onlinePayment ? Number(onlinePayment.amount) : 0;

  const totalMs = Date.now() - startedAt;
  if (totalMs > getSlowThresholdMs()) {
    // Phase breakdown in the container logs (same slow threshold as the
    // /erp/diagnostics page, which records totals via requestMetrics), so
    // "the desk is slow" is diagnosable from production instead of guessed.
    req.log?.warn?.(
      {
        totalMs,
        guardsMs: txStartedAt - startedAt,
        txnMs: txnDoneAt - txStartedAt,
        fanoutMs: Date.now() - txnDoneAt,
        billId: bill.id,
      },
      "slow bill save",
    );
  }

  // `studies` is now created asynchronously (see fire-and-forget above); the
  // key stays in the response for shape compatibility, but no client reads it.
  res.status(201).json({ ...built, token: tokenInfo, testTokens, studies: [], needsFormFData, needsOnlinePayment, onlineAmount });
});

billsRouter.get("/:id", async (req, res) => {
  const parsed = GetBillParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, parsed.data.id));
  if (!bill) {
    res.status(404).json({ error: "Bill not found" });
    return;
  }
  res.json(await buildBill(bill));
});

billsRouter.put("/:id", requireStaffSubPermission("/billing", "edit"), async (req: StaffAuthRequest, res) => {
  const paramsParsed = UpdateBillParams.safeParse({ id: Number(req.params.id) });
  const bodyParsed = UpdateBillBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { discount, status, dueDate } = bodyParsed.data;

  const [existingBill] = await db.select().from(billsTable).where(eq(billsTable.id, paramsParsed.data.id));
  if (!existingBill) {
    res.status(404).json({ error: "Bill not found" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (status !== undefined) updateData.status = status;
  if (dueDate !== undefined) updateData.dueDate = dueDate;
  if (discount !== undefined) {
    const newDiscount = Number(discount);
    const subtotal = Number(existingBill.subtotal);
    const taxAmount = Number(existingBill.taxAmount);

    if (!Number.isFinite(newDiscount) || newDiscount < 0) {
      res.status(400).json({ error: "Discount must be zero or a positive number" });
      return;
    }
    if (newDiscount > subtotal) {
      res.status(400).json({ error: `Discount (${newDiscount.toFixed(2)}) cannot exceed subtotal (${subtotal.toFixed(2)})` });
      return;
    }

    const session = req.staffSession;
    if (session && !FULL_ACCESS_ROLES.has(session.role) && newDiscount > 0) {
      const maxPct = session.maxDiscount ?? 0;
      const maxAllowed = Math.round((subtotal * maxPct / 100) * 100) / 100;
      if (newDiscount > maxAllowed + 0.01) {
        res.status(403).json({ error: `Your maximum allowed discount is ${maxPct}% (₹${maxAllowed.toFixed(2)} on this bill). Please ask an admin to apply a higher discount.` });
        return;
      }
    }

    const newTotal = subtotal - newDiscount + taxAmount;
    const paidAmount = Number(existingBill.paidAmount);
    const refundAmount = Number(existingBill.refundAmount || 0);
    const newBalance = Math.max(0, Math.round((newTotal - paidAmount - refundAmount) * 100) / 100);
    updateData.discount = String(newDiscount);
    updateData.totalAmount = String(newTotal);
    updateData.balanceAmount = String(newBalance);
  }

  const [updated] = await db.update(billsTable).set(updateData).where(eq(billsTable.id, paramsParsed.data.id)).returning();

  // Always-on advisory audit: a discount edit that exceeds 50% of the active
  // order_tests subtotal is flagged for CA review. Fires regardless of whether
  // the caller supplied editedBy/reason — actor falls back to the staff
  // session so the row is never anonymous. Non-blocking.
  if (discount !== undefined && String(discount) !== existingBill.discount) {
    try {
      const otRows = await db.select({ price: orderTestsTable.price })
        .from(orderTestsTable)
        .where(and(eq(orderTestsTable.orderId, existingBill.orderId), ne(orderTestsTable.status, "cancelled")));
      const ruleSubtotal = otRows.reduce((s, r) => s + Number(r.price ?? 0), 0);
      const newDiscountVal = Number(discount);
      if (ruleSubtotal > 0 && newDiscountVal > 0 && (newDiscountVal / ruleSubtotal) * 100 > 50) {
        const session = req.staffSession;
        const actor = (req.body?.editedBy as string | undefined)
          || session?.subjectName
          || (session ? `staff:${session.id}` : "system");
        await db.insert(billAuditsTable).values({
          billId: paramsParsed.data.id,
          editedBy: actor,
          reason: (req.body?.reason as string | undefined) || "auto-flagged: discount > 50% of active subtotal",
          changeType: "discount_override_warning",
          oldValue: `subtotal=₹${ruleSubtotal.toFixed(2)}`,
          newValue: `discount=₹${newDiscountVal.toFixed(2)} (${((newDiscountVal / ruleSubtotal) * 100).toFixed(1)}% — review)`,
        });
      }
    } catch { /* never block edit on advisory check */ }
  }

  // Audit trail + email notification.
  // The actor is taken from the authenticated session, never trusted from the
  // request body. Previously the whole block was gated on a client-supplied
  // `editedBy`, so a bill status/discount change could be misattributed (spoofed
  // editedBy) or — worse — skip auditing entirely simply by omitting the field.
  // A real status/discount change is now ALWAYS audited under the session actor;
  // `reason` falls back to a default when the caller omits one.
  const editActor = req.staffSession?.subjectName?.trim()
    || (req.body?.editedBy as string | undefined)?.trim()
    || (req.staffSession ? `staff:${req.staffSession.id}` : "unknown");
  const editReason = (req.body?.reason as string | undefined)?.trim() || "bill edit";
  const statusChanged   = status !== undefined && status !== existingBill.status;
  const discountChanged = discount !== undefined && String(discount) !== existingBill.discount;

  // Post-close edit notice — reuses the SAME boundary helpers as /:id/cancel
  // and /:id/refund, which already surface this for money-moving operations.
  // Editing a bill that was created before the last day-close rewrites the
  // totals of an already-signed-off period, so the edit is flagged here too.
  // Advisory only (never blocks, matching the sibling routes), but it is also
  // stamped into the audit reason so the trail itself records that the edit
  // landed on a closed period.
  let closedPeriodWarning: { billCreatedBeforeClose: boolean; lastClosureAt: string | null } | null = null;
  if (statusChanged || discountChanged) {
    try {
      const boundary = await lastOverallClosureBoundary();
      closedPeriodWarning = {
        billCreatedBeforeClose: isBeforeClosureBoundary(new Date(updated.createdAt), boundary),
        lastClosureAt: boundary ? boundary.toISOString() : null,
      };
    } catch (err) {
      req.log?.warn?.({ err }, "Closed-period check failed — edit still succeeded, notice omitted");
    }
  }
  const auditReason = closedPeriodWarning?.billCreatedBeforeClose
    ? `${editReason} [post-close edit: period closed at ${closedPeriodWarning.lastClosureAt}]`
    : editReason;

  {
    const auditEntries: { billId: number; editedBy: string; reason: string; changeType: string; oldValue: string | null; newValue: string | null }[] = [];
    const emailChanges: { field: string; from: string | null; to: string | null }[] = [];

    if (statusChanged) {
      auditEntries.push({ billId: paramsParsed.data.id, editedBy: editActor, reason: auditReason, changeType: "status", oldValue: existingBill.status, newValue: status });
      emailChanges.push({ field: "Status", from: existingBill.status, to: status });
    }
    if (discountChanged) {
      auditEntries.push({ billId: paramsParsed.data.id, editedBy: editActor, reason: auditReason, changeType: "discount", oldValue: existingBill.discount, newValue: String(discount) });
      emailChanges.push({ field: "Discount (₹)", from: existingBill.discount, to: String(discount) });
    }
    if (auditEntries.length > 0) {
      await db.insert(billAuditsTable).values(auditEntries);

      // Fire email asynchronously — don't block the response
      const billForEmail = await buildBill(updated);
      const patientName = billForEmail.patient
        ? `${billForEmail.patient.firstName} ${billForEmail.patient.lastName}`
        : "Unknown Patient";

      sendBillEditEmail({
        billNumber: updated.billNumber,
        patientName,
        editedBy: editActor,
        reason: auditReason,
        changes: emailChanges,
      }).catch(err => console.error("[email] bill edit notification failed:", err));
    }
  }

  res.json({ ...(await buildBill(updated)), closedPeriodWarning });
});

// ── Re-print log: insert audit + email admin/super-admin ─────────────────────
billsRouter.post("/:id/reprint-log", async (req, res) => {
  const paramsParsed = LogBillReprintParams.safeParse(req.params);
  const bodyParsed = LogBillReprintBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: [
        ...(paramsParsed.success ? [] : paramsParsed.error.issues),
        ...(bodyParsed.success ? [] : bodyParsed.error.issues),
      ],
    });
    return;
  }
  const id = paramsParsed.data.id;
  const reprintedBy = bodyParsed.data.reprintedBy.trim();
  const reason = bodyParsed.data.reason.trim();

  const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, id));
  if (!bill) {
    res.status(404).json({ error: "Bill not found" });
    return;
  }

  // Insert the audit row first so concurrent reprints can never collide on the
  // sequence number. The count is then read back, including this just-inserted
  // row, which gives a monotonic per-bill reprint number even under contention.
  const [inserted] = await db.insert(billAuditsTable).values({
    billId: id,
    editedBy: reprintedBy,
    reason,
    changeType: "reprint",
    oldValue: null,
    newValue: "reprint",
  }).returning();

  const counted = await db
    .select({ count: sql<number>`count(*)` })
    .from(billAuditsTable)
    .where(and(
      eq(billAuditsTable.billId, id),
      eq(billAuditsTable.changeType, "reprint"),
      sql`${billAuditsTable.id} <= ${inserted.id}`,
    ));
  const reprintCount = Number(counted[0]?.count ?? 1);

  // Patch the row with its assigned sequence number for cleaner audit display.
  await db.update(billAuditsTable)
    .set({ newValue: `reprint #${reprintCount}` })
    .where(eq(billAuditsTable.id, inserted.id));

  // Patient name for the email
  const [pat] = await db.select().from(patientsTable).where(eq(patientsTable.id, bill.patientId));
  const patientName = pat ? `${pat.firstName} ${pat.lastName}`.trim() : "Unknown Patient";

  // Fire email asynchronously — don't block the response
  sendBillReprintEmail({
    billNumber: bill.billNumber,
    patientName,
    reprintedBy,
    reason,
    reprintCount,
    totalAmount: Number(bill.totalAmount),
  }).catch((err) => console.error("[email] bill reprint notification failed:", err));

  res.json({ success: true, reprintCount });
});

billsRouter.get("/:id/audits", async (req, res) => {
  const paramsParsed = ListBillAuditsParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid request", details: paramsParsed.error.issues });
    return;
  }
  const id = paramsParsed.data.id;
  const audits = await db.select().from(billAuditsTable).where(eq(billAuditsTable.billId, id)).orderBy(desc(billAuditsTable.createdAt));
  res.json(audits);
});

// ── Cancel a bill ─────────────────────────────────────────────────────────────
// Marks a bill as cancelled with mandatory reason + actor. Audit-logged.
// Available to any staff (no super-admin token); same trust model as Edit Bill.
billsRouter.post("/:id/cancel", requireStaffSubPermission("/billing", "delete"), async (req, res) => {
  const paramsParsed = CancelBillParams.safeParse(req.params);
  const bodyParsed = CancelBillBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: [
        ...(paramsParsed.success ? [] : paramsParsed.error.issues),
        ...(bodyParsed.success ? [] : bodyParsed.error.issues),
      ],
    });
    return;
  }
  const id = paramsParsed.data.id;
  const performedBy = (req as StaffAuthRequest).staffSession?.subjectName?.trim() || bodyParsed.data.performedBy.trim();
  const reason = bodyParsed.data.reason.trim();
  if (!performedBy) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }

  // Serialize concurrent cancel/refund attempts on this bill via row-level lock.
  const txResult = await db.transaction(async (tx) => {
    const [bill] = await tx.select().from(billsTable).where(eq(billsTable.id, id)).for("update");
    if (!bill) throw Object.assign(new Error("Bill not found"), { httpStatus: 404 });
    if (bill.status === "cancelled") {
      throw Object.assign(new Error("Bill is already cancelled"), { httpStatus: 409 });
    }

    const [updated] = await tx.update(billsTable).set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledByName: performedBy,
      cancellationReason: reason,
      // Zero out the outstanding balance so cancelled bills never appear
      // in the Due Payments report (dueOnly filter: balanceAmount > 0).
      balanceAmount: "0.00",
    }).where(eq(billsTable.id, id)).returning();

    await tx.insert(billAuditsTable).values({
      billId: id,
      editedBy: performedBy,
      reason,
      changeType: "cancelled",
      oldValue: bill.status,
      newValue: "cancelled",
    });

    // CRITICAL: cascade cancellation into order_tests so referral commission
    // and doctor-ledger reports (which filter on order_tests.status, NOT
    // bills.status) stop accruing on this bill. Without this, a cancelled
    // bill keeps paying commission to the referring doctor forever.
    const cascadedTests = await tx.update(orderTestsTable).set({
      status: "cancelled",
      cancelledByName: performedBy,
      cancelledAt: new Date(),
      cancellationReason: `Bill cancelled: ${reason}`,
    } as Partial<typeof orderTestsTable.$inferSelect>)
      .where(and(eq(orderTestsTable.orderId, bill.orderId), ne(orderTestsTable.status, "cancelled")))
      .returning({ id: orderTestsTable.id });

    if (cascadedTests.length > 0) {
      await tx.insert(billAuditsTable).values({
        billId: id,
        editedBy: performedBy,
        reason,
        changeType: "tests_cancelled_cascade",
        oldValue: "active",
        newValue: `${cascadedTests.length} test(s) cancelled (commission accrual stopped)`,
      });
    }

    // Optional: simultaneously refund the paid amount in the same transaction.
    // Body shape: { autoRefund: { method: "cash" | "upi" | ... } }. When omitted,
    // behaviour is unchanged (cancel-only).
    const autoRefundParsed = z.object({
      autoRefund: z.object({ method: z.string().min(1) }).optional(),
    }).safeParse(req.body);
    let refundedAmount = 0;
    let refundMethod: string | null = null;
    if (autoRefundParsed.success && autoRefundParsed.data.autoRefund) {
      const currentPaid = Number(bill.paidAmount);
      if (currentPaid > 0.0001) {
        refundMethod = autoRefundParsed.data.autoRefund.method.trim().toLowerCase();
        refundedAmount = Math.round(currentPaid * 100) / 100;
        const currentRefund = Number(bill.refundAmount);
        const newRefund = Math.round((currentRefund + refundedAmount) * 100) / 100;
        await tx.insert(paymentsTable).values({
          billId: id,
          amount: String(-refundedAmount),
          method: refundMethod,
          referenceNumber: null,
          notes: `REFUND on cancellation: ${reason}`,
          recordedByName: performedBy,
        });
        // FIX: totalAmount is NEVER mutated — cancelled bill's balance is always 0.
        await tx.update(billsTable).set({
          paidAmount: "0.00",
          refundAmount: String(newRefund),
          balanceAmount: "0.00",
        }).where(eq(billsTable.id, id));
        await tx.insert(billAuditsTable).values({
          billId: id,
          editedBy: performedBy,
          reason,
          changeType: "refund",
          oldValue: `paid=₹${currentPaid.toFixed(2)}`,
          newValue: `refund=₹${refundedAmount.toFixed(2)} via ${refundMethod} (auto on cancel)`,
        });
      }
    }

    return { updated, oldStatus: bill.status, cascadedTestCount: cascadedTests.length, refundedAmount, refundMethod };
  }).catch((err: Error & { httpStatus?: number }) => {
    if (err.httpStatus) {
      res.status(err.httpStatus).json({ error: err.message });
      return null;
    }
    throw err;
  });
  if (!txResult) return;
  const { updated, oldStatus, cascadedTestCount, refundedAmount, refundMethod } = txResult;

  // Auto-generate refund voucher when an auto-refund happened on cancellation.
  if (refundedAmount > 0 && refundMethod) {
    try {
      const [patForVoucher] = await db
        .select({ firstName: patientsTable.firstName, lastName: patientsTable.lastName })
        .from(patientsTable)
        .where(eq(patientsTable.id, updated.patientId));
      autoVoucherForPayment({
        billId: id,
        amount: -refundedAmount,
        method: refundMethod,
        billNumber: updated.billNumber,
        patientName: patForVoucher ? `${patForVoucher.firstName} ${patForVoucher.lastName}`.trim() : null,
        performedBy,
      }).catch(() => {});
    } catch { /* never block */ }
  }

  // Best-effort email notification (re-use the bill-edit template)
  try {
    const billForEmail = await buildBill(updated);
    const patientName = billForEmail.patient
      ? `${billForEmail.patient.firstName} ${billForEmail.patient.lastName}`
      : "Unknown Patient";
    const changes: { field: string; from: string | null; to: string | null }[] = [
      { field: "Status", from: oldStatus, to: "cancelled" },
    ];
    if (cascadedTestCount > 0) {
      changes.push({ field: "Tests cancelled", from: null, to: `${cascadedTestCount} (commission stopped)` });
    }
    if (refundedAmount > 0 && refundMethod) {
      changes.push({ field: "Auto refund", from: null, to: `₹${refundedAmount.toFixed(2)} via ${refundMethod}` });
    }
    sendBillEditEmail({
      billNumber: updated.billNumber,
      patientName,
      editedBy: performedBy,
      reason: `[CANCELLED] ${reason}`,
      changes,
    }).catch((err) => console.error("[email] bill cancel notification failed:", err));
  } catch (err) {
    req.log?.warn?.({ err }, "Cancel email send failed");
  }

  // Same closed-period notice as /:id/refund — only meaningful when this
  // cancellation actually moved money (autoRefund). See the refund route
  // below for the full rationale; never blocks, no approval required.
  let closedPeriodWarning: { billCreatedBeforeClose: boolean; lastClosureAt: string | null } | null = null;
  if (refundedAmount > 0 && refundMethod) {
    try {
      const boundary = await lastOverallClosureBoundary();
      closedPeriodWarning = {
        billCreatedBeforeClose: isBeforeClosureBoundary(new Date(updated.createdAt), boundary),
        lastClosureAt: boundary ? boundary.toISOString() : null,
      };
    } catch (err) {
      req.log?.warn?.({ err }, "Closed-period check failed — cancellation still succeeded, notice omitted");
    }
  }

  res.json({ ...(await buildBill(updated)), closedPeriodWarning });
});

// ── Refund a payment against a bill ───────────────────────────────────────────
// Records a refund of `amount`. Inserts a negative-amount payment row so the
// payment history shows it, decrements paidAmount, increments refundAmount,
// recomputes balanceAmount + status, audits, and emails.
billsRouter.post("/:id/refund", requireStaffSubPermission("/billing", "refund"), async (req, res) => {
  const paramsParsed = RefundBillParams.safeParse(req.params);
  const bodyParsed = RefundBillBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: [
        ...(paramsParsed.success ? [] : paramsParsed.error.issues),
        ...(bodyParsed.success ? [] : bodyParsed.error.issues),
      ],
    });
    return;
  }
  const id = paramsParsed.data.id;
  const performedBy = (req as StaffAuthRequest).staffSession?.subjectName?.trim() || bodyParsed.data.performedBy.trim();
  const reason = bodyParsed.data.reason.trim();
  const rawAmount = bodyParsed.data.amount;
  const method = (bodyParsed.data.method ?? "cash").trim().toLowerCase();
  if (!performedBy) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }

  // Round to 2 decimals to avoid float comparison surprises (₹).
  const amount = Math.round(rawAmount * 100) / 100;

  // Serialize concurrent refunds against this bill: lock the row, re-read latest
  // values inside the transaction, then validate + write atomically. This
  // prevents two simultaneous refund requests from each reading the same
  // paidAmount and over-refunding the bill.
  const result = await db.transaction(async (tx) => {
    const [bill] = await tx.select().from(billsTable).where(eq(billsTable.id, id)).for("update");
    if (!bill) throw Object.assign(new Error("Bill not found"), { httpStatus: 404 });

    const currentPaid = Number(bill.paidAmount);
    const currentTotal = Number(bill.totalAmount);
    const currentRefund = Number(bill.refundAmount);

    if (amount > currentPaid + 0.0001) {
      throw Object.assign(
        new Error(`Refund (₹${amount.toFixed(2)}) cannot exceed amount currently paid (₹${currentPaid.toFixed(2)})`),
        { httpStatus: 400 },
      );
    }

    const newPaid = Math.max(0, Math.round((currentPaid - amount) * 100) / 100);
    const newRefund = Math.round((currentRefund + amount) * 100) / 100;
    // FIX: totalAmount is NEVER mutated by a refund — it preserves the original
    // billed amount for historical revenue accuracy.
    // balance_amount = total − paid − refund  ← true net money still owed.
    // This means balance = 0 when the patient has paid their net obligation
    // (paid_amount + refund_amount = total_amount), so:
    //   • Dues filter (balance > 0) correctly excludes fully-settled refund bills.
    //   • Add-payment guard uses the correct remaining payable amount.
    //   • Daily-summary outstanding = SUM(balance) is correct without adjustment.
    const newBalance = Math.max(0, Math.round((currentTotal - newPaid - newRefund) * 100) / 100);
    // Status: paid when net owed (total − refund) is fully collected.
    const netOwed = Math.max(0, Math.round((currentTotal - newRefund) * 100) / 100);
    const newStatus = bill.status === "cancelled"
      ? "cancelled"
      : newPaid <= 0
        ? "pending"
        : newPaid < netOwed
          ? "partial"
          : "paid";

    // Insert the refund as a negative-amount payment row so it shows up inline
    // in the payment history alongside regular payments.
    await tx.insert(paymentsTable).values({
      billId: id,
      amount: String(-amount),
      method,
      referenceNumber: null,
      notes: `REFUND: ${reason}`,
      recordedByName: performedBy,
    });

    // totalAmount intentionally excluded — must not be mutated by a refund.
    const [updated] = await tx.update(billsTable).set({
      paidAmount: String(newPaid),
      refundAmount: String(newRefund),
      balanceAmount: String(newBalance),
      status: newStatus,
    }).where(eq(billsTable.id, id)).returning();

    await tx.insert(billAuditsTable).values({
      billId: id,
      editedBy: performedBy,
      reason,
      changeType: "refund",
      oldValue: `paid=₹${currentPaid.toFixed(2)}, refunded=₹${currentRefund.toFixed(2)}`,
      newValue: `refund=₹${amount.toFixed(2)} via ${method}; paid=₹${newPaid.toFixed(2)}, refunded=₹${newRefund.toFixed(2)}`,
    });

    return { updated, currentPaid, currentRefund, newPaid, newRefund };
  }).catch((err: Error & { httpStatus?: number }) => {
    if (err.httpStatus) {
      res.status(err.httpStatus).json({ error: err.message });
      return null;
    }
    throw err;
  });
  if (!result) return;
  const { updated, currentPaid, currentRefund, newPaid, newRefund } = result;

  // Auto-generate refund voucher — async, never blocks response
  try {
    const [patForVoucher] = await db
      .select({ firstName: patientsTable.firstName, lastName: patientsTable.lastName })
      .from(patientsTable)
      .where(eq(patientsTable.id, updated.patientId));
    autoVoucherForPayment({
      billId: id,
      amount: -amount, // negative signals a refund voucher
      method,
      billNumber: updated.billNumber,
      patientName: patForVoucher ? `${patForVoucher.firstName} ${patForVoucher.lastName}`.trim() : null,
      performedBy,
    }).catch(() => {/* already logged inside */});
  } catch { /* never block */ }

  try {
    const billForEmail = await buildBill(updated);
    const patientName = billForEmail.patient
      ? `${billForEmail.patient.firstName} ${billForEmail.patient.lastName}`
      : "Unknown Patient";
    sendBillEditEmail({
      billNumber: updated.billNumber,
      patientName,
      editedBy: performedBy,
      reason: `[REFUND] ${reason}`,
      changes: [
        { field: "Refund (₹)", from: currentRefund.toFixed(2), to: newRefund.toFixed(2) },
        { field: "Paid (₹)", from: currentPaid.toFixed(2), to: newPaid.toFixed(2) },
      ],
    }).catch((err) => console.error("[email] refund notification failed:", err));
  } catch (err) {
    req.log?.warn?.({ err }, "Refund email send failed");
  }

  // ── Closed-period notice (informational only — never blocks) ───────────
  // Per the ERP's existing carry-forward rule (Specification §7, Locked
  // Rule #10/#11): this refund is NOT blocked and requires NO owner
  // approval even if the original bill predates the most recent day-close.
  // It already correctly belongs to the current open reconciliation window
  // (see bills.ts refund transaction above — payment.createdAt = NOW()).
  // This flag exists purely so staff get a heads-up that the bill they are
  // refunding was part of an already-closed, signed-off period.
  let closedPeriodWarning: { billCreatedBeforeClose: boolean; lastClosureAt: string | null } | null = null;
  try {
    const boundary = await lastOverallClosureBoundary();
    closedPeriodWarning = {
      billCreatedBeforeClose: isBeforeClosureBoundary(new Date(updated.createdAt), boundary),
      lastClosureAt: boundary ? boundary.toISOString() : null,
    };
  } catch (err) {
    req.log?.warn?.({ err }, "Closed-period check failed — refund still succeeded, notice omitted");
  }

  res.json({ ...(await buildBill(updated)), closedPeriodWarning });
});

// ── Change Referring Doctor ──────────────────────────────────────────────────
// Updates the order's doctorId, audit-logs the change, and returns the updated
// bill. Commission recalculation happens naturally because the commission
// report reads the current doctorId on each run.
billsRouter.post("/:id/change-doctor", async (req: StaffAuthRequest, res) => {
  const paramsParsed = z.object({ id: z.coerce.number().positive() }).safeParse(req.params);
  const bodyParsed = z.object({
    newDoctorId: z.union([z.coerce.number().positive(), z.literal(0), z.null()]),
    reason: z.string().min(1),
    // Actor is taken from the authenticated session, not trusted from the body
    // (this endpoint redirects a referrer's commission, so a spoofed actor
    // hid who reassigned it). Kept optional as a legacy fallback only.
    performedBy: z.string().min(1).optional(),
  }).safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: "Invalid request", details: [...(paramsParsed.error?.issues ?? []), ...(bodyParsed.error?.issues ?? [])] });
    return;
  }
  const id = paramsParsed.data.id;
  const { newDoctorId, reason } = bodyParsed.data;
  const actor = req.staffSession?.subjectName?.trim() || bodyParsed.data.performedBy?.trim() || "unknown";

  const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, id));
  if (!bill) { res.status(404).json({ error: "Bill not found" }); return; }

  // Resolve old and new doctor names for the audit trail
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, bill.orderId));
  const [oldDoctor] = order?.doctorId
    ? await db.select({ name: doctorsTable.name }).from(doctorsTable).where(eq(doctorsTable.id, order.doctorId))
    : [undefined];

  const isSelf = newDoctorId === 0 || newDoctorId === null;
  const [newDoctor] = isSelf
    ? [{ name: "Walk-in / Self" }]
    : await db.select({ name: doctorsTable.name }).from(doctorsTable).where(eq(doctorsTable.id, newDoctorId as number));
  if (!isSelf && !newDoctor) { res.status(400).json({ error: "New doctor not found" }); return; }

  await db.transaction(async (tx) => {
    // Update the order (doctor lives on the order, not the bill)
    await tx.update(ordersTable).set({ doctorId: isSelf ? null : newDoctorId }).where(eq(ordersTable.id, bill.orderId));

    // Audit
    await tx.insert(billAuditsTable).values({
      billId: id,
      editedBy: actor,
      reason,
      changeType: "referral",
      oldValue: oldDoctor?.name ?? "(none)",
      newValue: newDoctor?.name ?? "(none)",
    });
  });

  res.json(await buildBill(bill));
});

// Helper: verify super admin session token
async function verifySuperAdminToken(token: string): Promise<{ valid: boolean; userName: string }> {
  if (!token) return { valid: false, userName: "" };
  const [session] = await db.select().from(superAdminSessionsTable).where(eq(superAdminSessionsTable.token, token));
  if (!session || !session.isActive || new Date(session.expiresAt) < new Date()) {
    return { valid: false, userName: "" };
  }
  return { valid: true, userName: session.userName };
}

// ── Super-admin: full amount edit ─────────────────────────────────────────────
billsRouter.patch("/:id/super-edit", async (req, res) => {
  if (rejectIfUsbMissing(req, res)) return;
  const paramsParsed = SuperEditBillParams.safeParse(req.params);
  const bodyParsed = SuperEditBillBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: [
        ...(paramsParsed.success ? [] : paramsParsed.error.issues),
        ...(bodyParsed.success ? [] : bodyParsed.error.issues),
      ],
    });
    return;
  }
  const id = paramsParsed.data.id;
  const { token, reason, subtotal, discount, taxAmount } = bodyParsed.data;

  const { valid, userName } = await verifySuperAdminToken(token);
  if (!valid) {
    res.status(403).json({ error: "Super admin session expired or invalid. Please re-authenticate via the Super Admin Portal." });
    return;
  }
  const superAdminName = userName;

  const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, id));
  if (!bill) {
    res.status(404).json({ error: "Bill not found" });
    return;
  }

  const newSubtotal  = subtotal  !== undefined ? Number(subtotal)  : Number(bill.subtotal);
  const newDiscount  = discount  !== undefined ? Number(discount)  : Number(bill.discount);
  const newTaxAmount = taxAmount !== undefined ? Number(taxAmount) : Number(bill.taxAmount);
  const newTotal     = newSubtotal - newDiscount + newTaxAmount;
  const paidAmount   = Number(bill.paidAmount);
  // FIX: include refundAmount in balance calculation — balance = total − paid − refund
  // (same invariant enforced by the refund route; without this, super-editing a
  // refunded bill overstates the outstanding balance by the refund amount).
  const refundAmount = Number(bill.refundAmount ?? 0);
  const newBalance   = newTotal - paidAmount - refundAmount;
  // Status: paid when net owed (total − refund) is fully collected.
  const netOwed    = Math.max(0, newTotal - refundAmount);
  const newStatus    = newBalance <= 0 && paidAmount > 0 ? "paid"
                     : paidAmount > 0 && paidAmount < netOwed ? "partial"
                     : paidAmount > 0 ? "paid"
                     : "pending";

  const [updated] = await db.update(billsTable).set({
    subtotal:      String(newSubtotal),
    discount:      String(newDiscount),
    taxAmount:     String(newTaxAmount),
    totalAmount:   String(newTotal),
    balanceAmount: String(Math.max(0, newBalance)),
    status:        newStatus,
  }).where(eq(billsTable.id, id)).returning();

  // Audit each changed field
  const auditRows: { billId: number; editedBy: string; reason: string; changeType: string; oldValue: string | null; newValue: string | null }[] = [];
  if (newSubtotal !== Number(bill.subtotal))   auditRows.push({ billId: id, editedBy: superAdminName, reason, changeType: "subtotal",   oldValue: bill.subtotal,   newValue: String(newSubtotal) });

  // Audit warning: if the new subtotal no longer matches sum(order_tests.price),
  // commission/doctor-ledger reports (which compute off order_tests, not bills)
  // will silently disagree with the bill. Surface this for the CA review page.
  if (newSubtotal !== Number(bill.subtotal)) {
    const otRows = await db.select({ price: orderTestsTable.price, status: orderTestsTable.status })
      .from(orderTestsTable).where(eq(orderTestsTable.orderId, bill.orderId));
    const activeSum = otRows
      .filter((r) => r.status !== "cancelled")
      .reduce((s, r) => s + Number(r.price ?? 0), 0);
    if (Math.abs(activeSum - newSubtotal) > 0.01) {
      auditRows.push({
        billId: id, editedBy: superAdminName, reason,
        changeType: "subtotal_mismatch_warning",
        oldValue: `order_tests sum=₹${activeSum.toFixed(2)}`,
        newValue: `bill subtotal=₹${newSubtotal.toFixed(2)} (commission report will use order_tests sum, not this)`,
      });
    }
  }
  if (newDiscount !== Number(bill.discount))   auditRows.push({ billId: id, editedBy: superAdminName, reason, changeType: "discount",   oldValue: bill.discount,   newValue: String(newDiscount) });
  if (newTaxAmount !== Number(bill.taxAmount)) auditRows.push({ billId: id, editedBy: superAdminName, reason, changeType: "taxAmount",  oldValue: bill.taxAmount,  newValue: String(newTaxAmount) });
  if (newTotal !== Number(bill.totalAmount))   auditRows.push({ billId: id, editedBy: superAdminName, reason, changeType: "totalAmount", oldValue: bill.totalAmount, newValue: String(newTotal) });
  if (auditRows.length > 0) await db.insert(billAuditsTable).values(auditRows);

  res.json(await buildBill(updated));
});

// ── Super-admin: delete bill + renumber subsequent ────────────────────────────
billsRouter.delete("/:id", async (req, res) => {
  if (rejectIfUsbMissing(req, res)) return;
  const paramsParsed = DeleteBillParams.safeParse(req.params);
  const bodyParsed = DeleteBillBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: [
        ...(paramsParsed.success ? [] : paramsParsed.error.issues),
        ...(bodyParsed.success ? [] : bodyParsed.error.issues),
      ],
    });
    return;
  }
  const id = paramsParsed.data.id;
  const { token, reason } = bodyParsed.data;

  const { valid, userName } = await verifySuperAdminToken(token);
  if (!valid) {
    res.status(403).json({ error: "Super admin session expired or invalid. Please re-authenticate via the Super Admin Portal." });
    return;
  }

  const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, id));
  if (!bill) {
    res.status(404).json({ error: "Bill not found" });
    return;
  }

  // Parse bill number to get YYYYMM prefix and sequence number (handles both
  // legacy `BILL-YYYYMM-####` and current pure-numeric `YYYYMM####`).
  const billNumMatch = parseBillNumberParts(bill.billNumber);

  // Pre-audit (bill_audits has no FK constraint so insert before or after is fine)
  await db.insert(billAuditsTable).values({
    billId: id,
    editedBy: userName,
    reason: `[DELETED] ${reason}`,
    changeType: "deleted",
    oldValue: bill.billNumber,
    newValue: null,
  });

  // Delete payments + bill, reset order, renumber later bills — all in one
  // transaction. Otherwise a partial failure (e.g. mid-renumber) leaves the
  // sequence with gaps or duplicate numbers and an inconsistent order status.
  await db.transaction(async (tx) => {
    await tx.delete(paymentsTable).where(eq(paymentsTable.billId, id));
    await tx.delete(billsTable).where(eq(billsTable.id, id));
    await tx.update(ordersTable).set({ status: "pending" }).where(eq(ordersTable.id, bill.orderId));

    if (billNumMatch) {
      const { monthPrefix, seq: deletedSeq } = billNumMatch;

      // Match both legacy `BILL-YYYYMM-...` and numeric `YYYYMM...` rows for
      // the same month so renumbering works during/after the format switch.
      const laterBills = await tx
        .select()
        .from(billsTable)
        .where(
          or(
            like(billsTable.billNumber, `BILL-${monthPrefix}-%`),
            like(billsTable.billNumber, `${monthPrefix}%`),
          ),
        )
        .orderBy(billsTable.billNumber);

      for (const lb of laterBills) {
        const parts = parseBillNumberParts(lb.billNumber);
        if (!parts || parts.monthPrefix !== monthPrefix) continue;
        if (parts.seq <= deletedSeq) continue;
        const newBillNumber = `${monthPrefix}${String(parts.seq - 1).padStart(4, "0")}`;
        await tx.update(billsTable).set({ billNumber: newBillNumber }).where(eq(billsTable.id, lb.id));
      }
    }
  });

  res.json({ success: true, deletedBillNumber: bill.billNumber });
});

// Payments
paymentsRouter.get("/", async (req, res) => {
  const parsed = ListPaymentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }
  const { billId, page = 1, limit = 20 } = parsed.data;
  const offset = (page - 1) * limit;

  // Optional text search (q >= 2 chars) — finds bills by patient name/ID/phone/bill#
  // then filters payments to those bills. Read directly from req.query to avoid
  // roundtripping through OpenAPI codegen.
  const q = typeof req.query.q === "string" && req.query.q.trim().length >= 2 ? req.query.q.trim() : null;

  // Resolve text-search into a set of bill IDs upfront
  let searchBillIds: number[] | null = null;
  if (q) {
    const pattern = `%${q.toLowerCase()}%`;
    const matchingBills = await db
      .select({ id: billsTable.id })
      .from(billsTable)
      .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
      .where(
        or(
          sql`LOWER(${billsTable.billNumber}) LIKE ${pattern}`,
          sql`LOWER(${patientsTable.firstName} || ' ' || COALESCE(${patientsTable.lastName}, '')) LIKE ${pattern}`,
          sql`LOWER(COALESCE(${patientsTable.patientId}, '')) LIKE ${pattern}`,
          sql`COALESCE(${patientsTable.phone}, '') LIKE ${pattern}`,
        ),
      )
      .limit(100);
    searchBillIds = matchingBills.map((b) => b.id);
    if (searchBillIds.length === 0) {
      res.json({ payments: [], total: 0, page, limit });
      return;
    }
  }

  const conditions = [];
  if (billId) conditions.push(eq(paymentsTable.billId, billId));
  if (searchBillIds) conditions.push(inArray(paymentsTable.billId, searchBillIds));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: paymentsTable.id,
        billId: paymentsTable.billId,
        billNumber: billsTable.billNumber,
        amount: paymentsTable.amount,
        method: paymentsTable.method,
        referenceNumber: paymentsTable.referenceNumber,
        notes: paymentsTable.notes,
        recordedByName: paymentsTable.recordedByName,
        createdAt: paymentsTable.createdAt,
        patientName: sql<string>`COALESCE(${patientsTable.firstName} || ' ' || COALESCE(${patientsTable.lastName}, ''), '')`,
        patientPid: patientsTable.patientId,
      })
      .from(paymentsTable)
      .leftJoin(billsTable, eq(paymentsTable.billId, billsTable.id))
      .leftJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
      .where(where)
      .orderBy(desc(paymentsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(paymentsTable).where(where),
  ]);

  res.json({
    payments: rows.map((p) => ({
      ...p,
      amount: Number(p.amount),
      billNumber: p.billNumber ?? `#${p.billId}`,
      patientName: p.patientName?.trim() || null,
      patientPid: p.patientPid ?? null,
    })),
    total: Number(countResult[0]?.count ?? 0),
    page,
    limit,
  });
});

// ── Cancel a single test on a bill (partial cancellation) ────────────────────
// Marks one order_test row as cancelled, recalculates bill totals, and audits.
// Requires at least one active test to remain — to cancel everything, use the
// full-bill cancel endpoint instead.
billsRouter.post("/:id/cancel-test", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid bill id" });
    return;
  }
  const { orderTestId, performedBy, reason } = req.body as { orderTestId?: unknown; performedBy?: unknown; reason?: unknown };
  if (!orderTestId || !performedBy || !reason) {
    res.status(400).json({ error: "orderTestId, performedBy, and reason are required" });
    return;
  }
  const otId = Number(orderTestId);
  const actor = String(performedBy).trim();
  const why = String(reason).trim();
  if (!Number.isInteger(otId) || otId < 1) {
    res.status(400).json({ error: "orderTestId must be a positive integer" });
    return;
  }
  if (!actor) { res.status(400).json({ error: "performedBy is required" }); return; }
  if (!why)   { res.status(400).json({ error: "reason is required" }); return; }

  const result = await db.transaction(async (tx) => {
    const [bill] = await tx.select().from(billsTable).where(eq(billsTable.id, id)).for("update");
    if (!bill) throw Object.assign(new Error("Bill not found"), { httpStatus: 404 });
    if (bill.status === "cancelled") throw Object.assign(new Error("Bill is already cancelled"), { httpStatus: 409 });

    const [orderTest] = await tx.select().from(orderTestsTable).where(eq(orderTestsTable.id, otId));
    if (!orderTest) throw Object.assign(new Error("Test not found"), { httpStatus: 404 });
    if (orderTest.orderId !== bill.orderId) throw Object.assign(new Error("Test does not belong to this bill's order"), { httpStatus: 400 });
    if ((orderTest as { status?: string }).status === "cancelled") throw Object.assign(new Error("Test is already cancelled"), { httpStatus: 409 });

    // Get all tests on this order to check we won't remove the last active one
    const allTests = await tx.select().from(orderTestsTable).where(eq(orderTestsTable.orderId, bill.orderId));
    const remainingActive = allTests.filter((t) => t.id !== otId && (t as { status?: string }).status !== "cancelled");
    if (remainingActive.length === 0) {
      throw Object.assign(
        new Error("Cannot cancel the last active test. Use 'Cancel Bill' to cancel the whole bill."),
        { httpStatus: 400 },
      );
    }

    // Mark the test as cancelled
    await tx.update(orderTestsTable).set({
      status: "cancelled",
      cancelledByName: actor,
      cancelledAt: new Date(),
      cancellationReason: why,
    } as Partial<typeof orderTestsTable.$inferSelect>).where(eq(orderTestsTable.id, otId));

    // Recalculate totals from remaining active tests
    const newSubtotal = remainingActive.reduce((sum, t) => sum + Number(t.price), 0);
    const oldDiscount = Number(bill.discount);
    const newDiscount = Math.min(oldDiscount, newSubtotal); // cap discount at new subtotal
    const newTotal = Math.max(0, Math.round((newSubtotal - newDiscount + Number(bill.taxAmount)) * 100) / 100);
    const newPaid = Number(bill.paidAmount);
    const refundAmount = Number(bill.refundAmount || 0);
    const newBalance = Math.max(0, Math.round((newTotal - newPaid - refundAmount) * 100) / 100);
    const newStatus = newBalance <= 0 && newPaid > 0 ? "paid"
      : newPaid > 0 ? "partial"
      : "pending";

    const [updated] = await tx.update(billsTable).set({
      subtotal: String(Math.round(newSubtotal * 100) / 100),
      discount: String(Math.round(newDiscount * 100) / 100),
      totalAmount: String(newTotal),
      balanceAmount: String(newBalance),
      status: newStatus,
    }).where(eq(billsTable.id, id)).returning();

    await tx.insert(billAuditsTable).values({
      billId: id,
      editedBy: actor,
      reason: why,
      changeType: "test-cancelled",
      oldValue: `testId=${otId}, price=₹${Number(orderTest.price).toFixed(2)}`,
      newValue: `subtotal=₹${newSubtotal.toFixed(2)}, total=₹${newTotal.toFixed(2)}`,
    });

    return updated;
  }).catch((err: Error & { httpStatus?: number }) => {
    if (err.httpStatus) { res.status(err.httpStatus).json({ error: err.message }); return null; }
    throw err;
  });

  if (!result) return;
  res.json(await buildBill(result));
});

// ── Cancel selected tests and optionally refund their value ──────────────────────────────────────────────────────
// Cancels multiple order_test rows, recalculates bill totals, and if the
// bill is now over-paid, records a refund for the excess amount.
billsRouter.post("/:id/cancel-refund-tests", async (req: StaffAuthRequest, res) => {
  const paramsParsed = z.object({ id: z.coerce.number() }).safeParse(req.params);
  const bodyParsed = CancelRefundTestsBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: "Invalid request", details: [
      ...(paramsParsed.success ? [] : paramsParsed.error.issues),
      ...(bodyParsed.success ? [] : bodyParsed.error.issues),
    ] });
    return;
  }
  const id = paramsParsed.data.id;
  const { orderTestIds, reason, performedBy, refundMethod } = bodyParsed.data;
  const actor = performedBy.trim() || req.staffSession?.subjectName?.trim() || "";
  if (!actor) { res.status(401).json({ error: "Staff authentication required" }); return; }
  if (!Array.isArray(orderTestIds) || orderTestIds.length === 0) {
    res.status(400).json({ error: "Select at least one test to cancel" }); return;
  }

  const txResult = await db.transaction(async (tx) => {
    const [bill] = await tx.select().from(billsTable).where(eq(billsTable.id, id)).for("update");
    if (!bill) throw Object.assign(new Error("Bill not found"), { httpStatus: 404 });
    if (bill.status === "cancelled") throw Object.assign(new Error("Bill is already cancelled"), { httpStatus: 409 });

    // Fetch all tests for this order
    const allTests = await tx.select().from(orderTestsTable).where(eq(orderTestsTable.orderId, bill.orderId));
    const targetIds = new Set(orderTestIds.map(Number));
    const targets = allTests.filter((t) => targetIds.has(t.id));
    if (targets.length !== targetIds.size) {
      throw Object.assign(new Error("One or more selected tests do not belong to this bill"), { httpStatus: 400 });
    }
    const alreadyCancelled = targets.filter((t) => (t as { status?: string }).status === "cancelled");
    if (alreadyCancelled.length > 0) {
      throw Object.assign(new Error(`${alreadyCancelled.length} test(s) already cancelled`), { httpStatus: 409 });
    }

    // Ensure at least one active test remains
    const remainingActive = allTests.filter(
      (t) => !targetIds.has(t.id) && (t as { status?: string }).status !== "cancelled",
    );
    if (remainingActive.length === 0) {
      throw Object.assign(new Error("Cannot cancel all tests. Use 'Cancel Bill' to void the entire bill."), { httpStatus: 400 });
    }

    // Cancel selected tests
    const now = new Date();
    for (const ot of targets) {
      await tx.update(orderTestsTable).set({
        status: "cancelled",
        cancelledByName: actor,
        cancelledAt: now,
        cancellationReason: reason,
      } as Partial<typeof orderTestsTable.$inferSelect>).where(eq(orderTestsTable.id, ot.id));
    }

    // Recalculate bill totals from remaining active tests
    const newSubtotal = remainingActive.reduce((sum, t) => sum + Number(t.price), 0);
    const oldDiscount = Number(bill.discount);
    const newDiscount = Math.min(oldDiscount, newSubtotal);
    const newTotal = Math.max(0, Math.round((newSubtotal - newDiscount + Number(bill.taxAmount)) * 100) / 100);
    const oldPaid = Number(bill.paidAmount);
    const oldRefund = Number(bill.refundAmount);

    let refundedAmount = 0;
    let refundRecorded = false;

    // If overpaid after removing tests, auto-refund the excess
    if (oldPaid > newTotal + 0.0001) {
      refundedAmount = Math.round((oldPaid - newTotal) * 100) / 100;
      const method = (refundMethod ?? "cash").trim().toLowerCase();
      const newRefund = Math.round((oldRefund + refundedAmount) * 100) / 100;
      const newPaid = Math.max(0, Math.round((oldPaid - refundedAmount) * 100) / 100);
      const newBalance = Math.max(0, Math.round((newTotal - newPaid - newRefund) * 100) / 100);
      const newStatus = newPaid <= 0 ? "pending" : newPaid < newTotal ? "partial" : "paid";

      await tx.insert(paymentsTable).values({
        billId: id,
        amount: String(-refundedAmount),
        method,
        referenceNumber: null,
        notes: `REFUND (test cancel): ${reason}`,
        recordedByName: actor,
      });

      await tx.update(billsTable).set({
        subtotal: String(Math.round(newSubtotal * 100) / 100),
        discount: String(Math.round(newDiscount * 100) / 100),
        totalAmount: String(newTotal),
        paidAmount: String(newPaid),
        refundAmount: String(newRefund),
        balanceAmount: String(newBalance),
        status: newStatus,
      }).where(eq(billsTable.id, id));

      refundRecorded = true;
    } else {
      const newPaid = oldPaid;
      const newBalance = Math.max(0, Math.round((newTotal - newPaid - oldRefund) * 100) / 100);
      const newStatus = newPaid <= 0 ? "pending" : newPaid < newTotal ? "partial" : "paid";

      await tx.update(billsTable).set({
        subtotal: String(Math.round(newSubtotal * 100) / 100),
        discount: String(Math.round(newDiscount * 100) / 100),
        totalAmount: String(newTotal),
        balanceAmount: String(newBalance),
        status: newStatus,
      }).where(eq(billsTable.id, id));
    }

    const [updated] = await tx.select().from(billsTable).where(eq(billsTable.id, id));

    // Audit log
    await tx.insert(billAuditsTable).values({
      billId: id,
      editedBy: actor,
      reason,
      changeType: "tests-cancelled",
      oldValue: `cancelled ${targets.length} test(s): ${targets.map((t) => `id=${t.id}, price=₹${Number(t.price).toFixed(2)}`).join("; ")}`,
      newValue: `subtotal=₹${newSubtotal.toFixed(2)}, total=₹${newTotal.toFixed(2)}, paid=₹${updated.paidAmount}${refundRecorded ? `, refunded=₹${refundedAmount.toFixed(2)}` : ""}`,
    });

    return { updated, targets, refundedAmount, refundRecorded, refundMethod: refundMethod ?? "cash" };
  }).catch((err: Error & { httpStatus?: number }) => {
    if (err.httpStatus) { res.status(err.httpStatus).json({ error: err.message }); return null; }
    throw err;
  });

  if (!txResult) return;
  const { updated, targets, refundedAmount, refundRecorded, refundMethod: method } = txResult;

  // Voucher + email
  if (refundRecorded && refundedAmount > 0) {
    try {
      const [patForVoucher] = await db
        .select({ firstName: patientsTable.firstName, lastName: patientsTable.lastName })
        .from(patientsTable).where(eq(patientsTable.id, updated.patientId));
      autoVoucherForPayment({
        billId: id, amount: -refundedAmount, method,
        billNumber: updated.billNumber,
        patientName: patForVoucher ? `${patForVoucher.firstName} ${patForVoucher.lastName}`.trim() : null,
        performedBy: actor,
      }).catch(() => {});
    } catch { /* never block */ }
  }

  try {
    const billForEmail = await buildBill(updated);
    const patientName = billForEmail.patient
      ? `${billForEmail.patient.firstName} ${billForEmail.patient.lastName}`
      : "Unknown Patient";
    const changes: { field: string; from: string | null; to: string | null }[] = [
      { field: "Tests cancelled", from: null, to: `${targets.length} (commission stopped)` },
      { field: "New Total", from: null, to: `₹${Number(updated.totalAmount).toFixed(2)}` },
    ];
    if (refundRecorded) {
      changes.push({ field: "Auto Refund", from: null, to: `₹${refundedAmount.toFixed(2)} via ${method}` });
    }
    sendBillEditEmail({
      billNumber: updated.billNumber,
      patientName,
      editedBy: actor,
      reason: `[TESTS CANCELLED] ${reason}`,
      changes,
    }).catch((err) => console.error("[email] cancel-refund-tests notification failed:", err));
  } catch (err) {
    req.log?.warn?.({ err }, "Cancel-refund-tests email send failed");
  }

  res.json(await buildBill(updated));
});

paymentsRouter.post("/", async (req, res) => {
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const { billId, amount, method, referenceNumber, notes } = parsed.data;
  const actorName = (req as StaffAuthRequest).staffSession?.subjectName?.trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Payment amount must be greater than zero. Use the refund endpoint to process refunds." });
    return;
  }

  // ── Serialize concurrent payment attempts on this bill via row-level lock ──
  // Wrapping in a transaction with FOR UPDATE prevents two simultaneous payment
  // requests from both passing the balance check before either commits.
  // This closes the double-click race condition (Bug #1).
  let payment: typeof paymentsTable.$inferSelect;
  let newPaidAmount: number;

  try {
    const txResult = await db.transaction(async (tx) => {
      const [bill] = await tx
        .select()
        .from(billsTable)
        .where(eq(billsTable.id, billId))
        .for("update")
        .limit(1);

      if (!bill) throw Object.assign(new Error("Bill not found"), { httpStatus: 404 });

      const currentBalance = Number(bill.balanceAmount);
      if (amount > currentBalance + 0.01) {
        throw Object.assign(
          new Error(`Payment amount (₹${amount.toFixed(2)}) exceeds outstanding balance (₹${currentBalance.toFixed(2)})`),
          { httpStatus: 400 },
        );
      }

      const [inserted] = await tx.insert(paymentsTable).values({
        billId,
        amount: String(amount),
        method,
        referenceNumber: referenceNumber ?? null,
        notes: notes ?? null,
        recordedByName: actorName || null,
      }).returning();

      const paid = Number(bill.paidAmount) + amount;
      const existingRefund = Number(bill.refundAmount ?? 0);
      const balance = Number(bill.totalAmount) - paid - existingRefund;
      const newStatus = balance <= 0 ? "paid" : paid > 0 ? "partial" : bill.status;

      await tx.update(billsTable).set({
        paidAmount: String(paid),
        balanceAmount: String(Math.max(0, balance)),
        status: newStatus,
      }).where(eq(billsTable.id, billId));

      return { inserted, paid };
    });

    payment = txResult.inserted;
    newPaidAmount = txResult.paid;
  } catch (err: any) {
    const status = err.httpStatus ?? 500;
    res.status(status).json({ error: err.message });
    return;
  }

  // Auto-generate accounting voucher — async, never blocks payment response
  const [billForVoucher] = await db
    .select({ billNumber: billsTable.billNumber, patientId: billsTable.patientId })
    .from(billsTable)
    .where(eq(billsTable.id, billId));
  if (billForVoucher) {
    const [patientRow] = await db
      .select({ firstName: patientsTable.firstName, lastName: patientsTable.lastName })
      .from(patientsTable)
      .where(eq(patientsTable.id, billForVoucher.patientId));
    autoVoucherForPayment({
      billId,
      amount,
      method,
      billNumber: billForVoucher.billNumber,
      patientName: patientRow ? `${patientRow.firstName} ${patientRow.lastName}`.trim() : null,
      performedBy: actorName || null,
    }).catch(() => {/* already logged inside */});
  }

  res.status(201).json({ ...payment, amount: Number(payment.amount) });
});

// ── Swap a test on an active bill (replaces testId + price, recalculates totals) ──
// This replaces the old "display name" edit. The new test is selected from the
// catalog, so commission rules apply correctly to the swapped testId.
billsRouter.post("/:id/swap-test", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  const { orderTestId, newTestId, reason, performedBy } = req.body as {
    orderTestId?: number; newTestId?: number; reason?: string; performedBy?: string;
  };

  if (!Number.isFinite(id) || !Number.isFinite(orderTestId) || !Number.isFinite(newTestId)) {
    res.status(400).json({ error: "Invalid bill, orderTest, or newTest id" });
    return;
  }
  if (!reason || !reason.trim()) {
    res.status(400).json({ error: "Reason is required" });
    return;
  }
  if (!performedBy || !performedBy.trim()) {
    res.status(401).json({ error: "Staff name required" });
    return;
  }

  const txResult = await db.transaction(async (tx) => {
    // 1) Lock the bill
    const [bill] = await tx.select().from(billsTable).where(eq(billsTable.id, id)).for("update");
    if (!bill) throw Object.assign(new Error("Bill not found"), { httpStatus: 404 });
    if (bill.status === "cancelled") {
      throw Object.assign(new Error("Bill is cancelled — cannot swap test"), { httpStatus: 409 });
    }

    // 2) Find the orderTest row
    const [otRow] = await tx.select().from(orderTestsTable).where(eq(orderTestsTable.id, orderTestId!));
    if (!otRow) throw Object.assign(new Error("Order test not found"), { httpStatus: 404 });
    if (otRow.status === "cancelled") {
      throw Object.assign(new Error("Cannot swap a cancelled test"), { httpStatus: 409 });
    }
    if (otRow.orderId !== bill.orderId) {
      throw Object.assign(new Error("Order test does not belong to this bill"), { httpStatus: 400 });
    }

    // 3) Fetch the new test
    const [newTest] = await tx.select().from(testsTable).where(eq(testsTable.id, newTestId!));
    if (!newTest) throw Object.assign(new Error("New test not found in catalog"), { httpStatus: 404 });
    if (!newTest.isActive) {
      throw Object.assign(new Error("New test is inactive"), { httpStatus: 400 });
    }

    const oldTestName = otRow.displayName || (await tx.select({ name: testsTable.name }).from(testsTable).where(eq(testsTable.id, otRow.testId)).then(r => r[0]?.name ?? "Unknown"));
    const oldPrice = Number(otRow.price);
    const newPrice = Number(newTest.price);
    const priceDiff = newPrice - oldPrice;

    // 4) Update the orderTest row with new testId and price
    await tx.update(orderTestsTable).set({
      testId: newTestId,
      price: newPrice.toFixed(2),
      displayName: null, // clear any old override
    }).where(eq(orderTestsTable.id, orderTestId!));

    // 5) Recalculate order total
    const allTests = await tx.select().from(orderTestsTable).where(eq(orderTestsTable.orderId, bill.orderId));
    const activeTests = allTests.filter((t) => t.status !== "cancelled");
    const newOrderTotal = activeTests.reduce((s, t) => s + Number(t.price), 0);
    await tx.update(ordersTable).set({
      totalAmount: newOrderTotal.toFixed(2),
      updatedAt: new Date(),
    }).where(eq(ordersTable.id, bill.orderId));

    // 6) Recalculate bill — same discount-cap / floor-at-zero / +tax formula
    // cancel-test and cancel-refund-tests already use below; this endpoint
    // was missing all three, so swapping to a cheaper test could leave
    // oldDiscount exceeding the new subtotal and drive totalAmount negative.
    const oldSubtotal = Number(bill.subtotal);
    const oldDiscount = Number(bill.discount);
    const newSubtotal = newOrderTotal;
    const newDiscount = Math.min(oldDiscount, newSubtotal); // cap discount at new subtotal
    const newTotal = Math.max(0, Math.round((newSubtotal - newDiscount + Number(bill.taxAmount)) * 100) / 100);
    const paidAmount = Number(bill.paidAmount);
    const refundAmount = Number(bill.refundAmount || 0);
    const newBalance = Math.max(0, Math.round((newTotal - paidAmount - refundAmount) * 100) / 100);
    const newStatus = newBalance <= 0.01 && paidAmount > 0 ? "paid" : paidAmount > 0 ? "partial" : "pending";

    await tx.update(billsTable).set({
      subtotal: newSubtotal.toFixed(2),
      discount: newDiscount.toFixed(2),
      totalAmount: newTotal.toFixed(2),
      balanceAmount: newBalance.toFixed(2),
      status: newStatus,
      updatedAt: new Date(),
    }).where(eq(billsTable.id, id));

    // 7) Audit the swap
    await tx.insert(billAuditsTable).values({
      billId: id,
      editedBy: performedBy,
      reason: reason.trim(),
      changeType: "test_swapped",
      oldValue: `${oldTestName} (testId=${otRow.testId}, price=${oldPrice.toFixed(2)})`,
      newValue: `${newTest.name} (testId=${newTestId}, price=${newPrice.toFixed(2)})`,
    });

    // 8) If price increased, record a payment (auto-collect extra)
    let extraPayment: { amount: number; method: string } | null = null;
    if (priceDiff > 0.01) {
      const method = (req.body.extraPaymentMethod as string) || "cash";
      extraPayment = { amount: priceDiff, method };
      await tx.insert(paymentsTable).values({
        billId: id,
        amount: priceDiff.toFixed(2),
        method,
        notes: `Extra charge for test swap: ${oldTestName} → ${newTest.name}`,
        recordedByName: performedBy,
      });
      const newPaid = Math.round((paidAmount + priceDiff) * 100) / 100;
      const newBalAfterPay = Math.max(0, newTotal - newPaid - refundAmount);
      const newStatAfterPay = newBalAfterPay <= 0.01 && newPaid > 0 ? "paid" : newPaid > 0 ? "partial" : "pending";
      await tx.update(billsTable).set({
        paidAmount: newPaid.toFixed(2),
        balanceAmount: newBalAfterPay.toFixed(2),
        status: newStatAfterPay,
        updatedAt: new Date(),
      }).where(eq(billsTable.id, id));

      await tx.insert(billAuditsTable).values({
        billId: id,
        editedBy: performedBy,
        reason: reason.trim(),
        changeType: "extra_payment",
        oldValue: `paid=₹${paidAmount.toFixed(2)}`,
        newValue: `paid=₹${newPaid.toFixed(2)} (+₹${priceDiff.toFixed(2)} ${method})`,
      });
    }

    // 9) If price decreased, record a refund
    let refundInfo: { amount: number; method: string } | null = null;
    if (priceDiff < -0.01) {
      const refundAmt = Math.abs(priceDiff);
      const method = (req.body.refundMethod as string) || "cash";
      refundInfo = { amount: refundAmt, method };
      await tx.insert(paymentsTable).values({
        billId: id,
        amount: `-${refundAmt.toFixed(2)}`,
        method,
        notes: `Refund for test swap: ${oldTestName} → ${newTest.name}`,
        recordedByName: performedBy,
      });
      const currentRefund = Number(bill.refundAmount);
      const newRefund = Math.round((currentRefund + refundAmt) * 100) / 100;
      const newPaidAfterRefund = Math.max(0, Math.round((paidAmount - refundAmt) * 100) / 100);
      const newBalAfterRefund = Math.max(0, newTotal - newPaidAfterRefund - newRefund);
      const newStatAfterRefund = newBalAfterRefund <= 0.01 && newPaidAfterRefund > 0 ? "paid" : newPaidAfterRefund > 0 ? "partial" : "pending";
      await tx.update(billsTable).set({
        paidAmount: newPaidAfterRefund.toFixed(2),
        refundAmount: newRefund.toFixed(2),
        balanceAmount: newBalAfterRefund.toFixed(2),
        status: newStatAfterRefund,
        updatedAt: new Date(),
      }).where(eq(billsTable.id, id));

      await tx.insert(billAuditsTable).values({
        billId: id,
        editedBy: performedBy,
        reason: reason.trim(),
        changeType: "refund",
        oldValue: `paid=₹${paidAmount.toFixed(2)}`,
        newValue: `refund=₹${refundAmt.toFixed(2)} via ${method} (test swap)`,
      });
    }

    return { billId: id, oldTestName, oldPrice, newTestName: newTest.name, newPrice, priceDiff, extraPayment, refundInfo };
  }).catch((err: Error & { httpStatus?: number }) => {
    if (err.httpStatus) {
      res.status(err.httpStatus).json({ error: err.message });
      return null;
    }
    throw err;
  });

  if (!txResult) return;

  // 10) Best-effort auto-voucher for the payment/refund
  if (txResult.extraPayment || txResult.refundInfo) {
    const [billForVoucher] = await db.select({ billNumber: billsTable.billNumber, patientId: billsTable.patientId }).from(billsTable).where(eq(billsTable.id, id));
    if (billForVoucher) {
      const [patientRow] = await db.select({ firstName: patientsTable.firstName, lastName: patientsTable.lastName }).from(patientsTable).where(eq(patientsTable.id, billForVoucher.patientId));
      const info = txResult.extraPayment || txResult.refundInfo;
      if (info) {
        autoVoucherForPayment({
          billId: id,
          amount: txResult.extraPayment ? info.amount : -info.amount,
          method: info.method,
          billNumber: billForVoucher.billNumber,
          patientName: patientRow ? `${patientRow.firstName} ${patientRow.lastName}`.trim() : null,
          performedBy: performedBy || null,
        }).catch(() => {});
      }
    }
  }

  // 11) System audit log
  await auditFromRequest(req as unknown as Request, {
    userId: req.staffSession?.subjectId ?? null,
    userName: performedBy || "system",
    role: req.staffSession?.role ?? "system",
    action: "edit",
    module: "billing",
    entityType: "bill",
    entityId: String(id),
    oldValue: JSON.stringify({ test: txResult.oldTestName, price: txResult.oldPrice }),
    newValue: JSON.stringify({ test: txResult.newTestName, price: txResult.newPrice }),
    reason: reason?.trim(),
  });

  res.json(await buildBill(await db.select().from(billsTable).where(eq(billsTable.id, id)).then(r => r[0]!)));
});

// ─── ICICI Billing Desk Gateway Integration ────────────────────────────────────
import { PaymentEngine } from "../lib/payments/PaymentEngine";
import { paymentLogsTable } from "@workspace/db/schema";
import crypto from "node:crypto";
import { logger } from "../lib/logger";

// POST /api/bills/:id/initiate-gateway-payment
billsRouter.post("/:id/initiate-gateway-payment", async (req: StaffAuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  const { amount: requestedAmount, expiryMinutes = 30 } = req.body || {};

  const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, id)).limit(1);
  if (!bill) {
    res.status(404).json({ error: "Bill not found" });
    return;
  }

  if (bill.status === "paid") {
    res.status(400).json({ error: "Bill is already fully paid" });
    return;
  }

  const collectAmount = requestedAmount !== undefined ? Number(requestedAmount) : Number(bill.balanceAmount);
  if (!collectAmount || collectAmount <= 0 || collectAmount > Number(bill.balanceAmount)) {
    res.status(400).json({ error: "Invalid payment amount requested" });
    return;
  }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, bill.patientId)).limit(1);
  const patientName = patient ? `${patient.firstName} ${patient.lastName}`.trim() : "VALUED PATIENT";
  const patientPhone = patient?.phone || "9973497200";
  const patientEmail = patient?.email || "";

  // Generate unique transaction reference
  const txnRef = `BILLPAY-${id}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  
  // Calculate expiry
  const expiryTime = expiryMinutes && expiryMinutes > 0
    ? new Date(Date.now() + expiryMinutes * 60 * 1000)
    : null;

  try {
    const base = process.env.PUBLIC_BASE_URL || process.env.BASE_URL || "https://caredeoghar.com";
    const returnUrl = `${base.replace(/\/$/, "")}/api/public/booking/icici-callback`;

    // Fetch active gateway from settings
    const [settings] = await db.select().from(clinicSettingsTable).where(eq(clinicSettingsTable.id, 1)).limit(1);
    const activeGateway = settings?.activePaymentGateway || "icici";

    // Initiate payment via payment engine
    const result = await PaymentEngine.initiatePayment(activeGateway, {
      bookingRef: txnRef,
      name: patientName,
      phone: patientPhone,
      email: patientEmail,
      amount: collectAmount,
      returnUrl,
    });

    if (!result.success) {
      res.status(400).json({ error: "Could not initiate payment gateway", details: result.errorMessage });
      return;
    }

    // Save expiryTime to the log we just generated in PaymentEngine.initiatePayment
    if (expiryTime) {
      await db.update(paymentLogsTable)
        .set({ requestPayload: JSON.stringify({ expiryTime: expiryTime.toISOString(), expiryMinutes }) })
        .where(eq(paymentLogsTable.bookingRef, txnRef));
    }

    res.json({
      success: true,
      txnRef,
      amount: collectAmount,
      redirectUrl: result.redirectUrl,
      tranCtx: result.rawResponse?.tranCtx,
      expiryTime,
    });
  } catch (err: any) {
    logger.error({ err, billId: id }, "Gateway payment initiation failed");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// GET /api/bills/gateway-payment-status/:txnRef
billsRouter.get("/gateway-payment-status/:txnRef", async (req, res): Promise<void> => {
  const txnRef = req.params.txnRef;

  const [logRecord] = await db.select()
    .from(paymentLogsTable)
    .where(eq(paymentLogsTable.bookingRef, txnRef))
    .limit(1);

  if (!logRecord) {
    res.status(404).json({ error: "Transaction log not found" });
    return;
  }

  // Check if expired
  let isExpired = false;
  try {
    const payload = JSON.parse(logRecord.requestPayload || "{}");
    if (payload.expiryTime && new Date(payload.expiryTime) < new Date()) {
      isExpired = true;
      if (logRecord.status === "initiated" || logRecord.status === "verifying") {
        await db.update(paymentLogsTable)
          .set({ status: "expired" })
          .where(eq(paymentLogsTable.id, logRecord.id));
      }
    }
  } catch (err) {
    // Two distinct failures were being swallowed here: a malformed stored
    // requestPayload, and a failed status→"expired" UPDATE. The latter leaves
    // the payment log stuck in "initiated"/"verifying" forever, so the row is
    // never reconciled. Expiry detection is still best-effort (the response
    // below is unaffected), but the failure is no longer invisible.
    req.log?.warn?.({ err, txnRef, logId: logRecord.id }, "Payment-log expiry check failed");
  }

  if (isExpired) {
    res.json({ status: "expired", amount: Number(logRecord.amount) });
    return;
  }

  if (logRecord.status === "success") {
    res.json({ status: "success", amount: Number(logRecord.amount) });
    return;
  }

  if (logRecord.status === "failed") {
    res.json({ status: "failed", amount: Number(logRecord.amount), error: logRecord.errorMessage });
    return;
  }

  // If status is initiated or verifying, query ICICI status to reconcile
  const parts = txnRef.split("-");
  const billId = Number(parts[1]);
  if (!billId || Number.isNaN(billId)) {
    res.json({ status: logRecord.status, amount: Number(logRecord.amount) });
    return;
  }

  const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, billId)).limit(1);
  if (!bill) {
    res.json({ status: logRecord.status, amount: Number(logRecord.amount) });
    return;
  }

  try {
    const gateway = logRecord.gateway || "icici";
    const provider = await PaymentEngine.getProvider(gateway);
    const verification = await PaymentEngine.verifyPayment(
      gateway,
      {
        bookingRef: txnRef,
        payload: {},
      },
      logRecord.patientName,
      Number(logRecord.amount)
    );

    if (verification.success && verification.status === "paid") {
      // Reconcile and save payment
      await db.transaction(async (tx) => {
        // F1 canonical idempotency: match our merchant reference in either
        // identifier column so a payment recorded by the S2S webhook
        // (including pre-F1 rows keyed by the provider txnID) dedupes here.
        const [existingPayment] = await tx.select()
          .from(paymentsTable)
          .where(and(
            eq(paymentsTable.billId, billId),
            or(
              eq(paymentsTable.referenceNumber, txnRef),
              eq(paymentsTable.gatewayTxnId, txnRef),
            ),
          ))
          .limit(1);

        if (!existingPayment) {
          const collectAmount = Number(logRecord.amount);
          await tx.insert(paymentsTable).values({
            billId,
            amount: collectAmount.toFixed(2),
            method: `Online (${provider.displayName})`,
            referenceNumber: txnRef,
            settlementStatus: "captured",
            notes: `Paid online via ${provider.displayName} at Billing Desk.`,
            recordedByName: "Super Admin",
          });

          const newPaid = Number(bill.paidAmount) + collectAmount;
          const refundAmount = Number(bill.refundAmount || 0);
          const newBalance = Math.max(0, Number(bill.totalAmount) - newPaid - refundAmount);
          const newStatus = newBalance <= 0.01 ? "paid" : "partial";
          await tx.update(billsTable).set({
            paidAmount: newPaid.toFixed(2),
            balanceAmount: newBalance.toFixed(2),
            status: newStatus,
            updatedAt: new Date(),
          }).where(eq(billsTable.id, billId));

          autoVoucherForPayment({
            billId,
            amount: collectAmount,
            method: "Online (ICICI Orange Pay)",
            billNumber: bill.billNumber,
            patientName: logRecord.patientName,
            performedBy: "Super Admin",
          }).catch(() => {});
        }
      });

      res.json({ status: "success", amount: Number(logRecord.amount) });
      return;
    }
  } catch (err: any) {
    logger.error({ err, txnRef }, "Error checking dynamic gateway status");
  }

  res.json({ status: logRecord.status, amount: Number(logRecord.amount) });
});

// GET /api/bills/gateway-stats
billsRouter.get("/gateway-stats", async (req, res): Promise<void> => {
  try {
    const stats = await db.select({
      status: paymentLogsTable.status,
      count: sql<number>`count(*)`,
    })
    .from(paymentLogsTable)
    .where(like(paymentLogsTable.bookingRef, "BILLPAY-%"))
    .groupBy(paymentLogsTable.status);

    const result = {
      pending: 0,
      success: 0,
      failed: 0,
      expired: 0,
    };

    for (const row of stats) {
      if (row.status === "initiated" || row.status === "verifying") result.pending += Number(row.count);
      else if (row.status === "success") result.success += Number(row.count);
      else if (row.status === "failed") result.failed += Number(row.count);
      else if (row.status === "expired") result.expired += Number(row.count);
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
