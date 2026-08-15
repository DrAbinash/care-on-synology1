import { Router, type Response } from "express";
import { db, ordersTable, orderTestsTable, testsTable, patientsTable, doctorsTable, clinicSettingsTable } from "@workspace/db";
import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
import {
  ListOrdersQueryParams,
  CreateOrderBody,
  GetOrderParams,
  UpdateOrderParams,
  UpdateOrderBody,
} from "@workspace/api-zod";
import { sanitizePatient } from "./patients";
import { getSlowThresholdMs } from "../lib/requestMetrics";
import { nextDocumentCounter, istYearMonth, syncOrderNumberSeqForward } from "../lib/documentNumberCounters";
import { FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

export const ordersRouter = Router();

/**
 * Allocate the next ORD-YYYYMM-#### via monthly SEQUENCE (next_order_number_seq).
 * No process-wide advisory lock — nextval is concurrent across desk saves.
 * Month bucket is Asia/Kolkata (matches SQL seed in zzzz_document_number_counters).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateOrderNumber(dbHandle: any = db): Promise<string> {
  const yyyymm = istYearMonth();
  const prefix = `ORD-${yyyymm}`;
  const num = await nextDocumentCounter(dbHandle, "order", yyyymm);
  return `${prefix}-${String(num).padStart(4, "0")}`;
}

function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const e = cur as { code?: string; message?: string; cause?: unknown };
    if (e.code === "23505") return true;
    if (/duplicate key value violates unique constraint|orders_order_number_unique/i.test(e.message ?? "")) {
      return true;
    }
    cur = e.cause;
  }
  return false;
}

function isClientRefUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const e = cur as { constraint?: string; message?: string; cause?: unknown };
    const constraint = e.constraint ?? "";
    const message = e.message ?? "";
    if (/client_ref|orders_client_ref/i.test(constraint) || /Key \(client_ref\)=/i.test(message)) {
      return true;
    }
    cur = e.cause;
  }
  return false;
}

// Preloaded rows a caller may already hold (e.g. POST / just validated the
// patient/doctor and inserted the order tests) so buildOrder can skip its
// lookups on the hot save-and-print path while remaining the ONE place that
// defines this endpoint family's response shape.
interface BuildOrderPreloaded {
  orderTestRows: Array<{
    orderTest: typeof orderTestsTable.$inferSelect;
    test: typeof testsTable.$inferSelect | null;
  }>;
  patient: typeof patientsTable.$inferSelect | null;
  doctor: typeof doctorsTable.$inferSelect | null;
}

async function buildOrder(order: typeof ordersTable.$inferSelect, preloaded?: BuildOrderPreloaded) {
  // Hot path: runs on every order create at the billing desk — batch the
  // independent lookups instead of awaiting them one by one, and skip them
  // entirely when the caller already holds the rows.
  const [orderTestRows, [patient], doctorRows] = preloaded
    ? [preloaded.orderTestRows, [preloaded.patient ?? undefined], preloaded.doctor ? [preloaded.doctor] : []]
    : await Promise.all([
        db
          .select({ orderTest: orderTestsTable, test: testsTable })
          .from(orderTestsTable)
          .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
          .where(eq(orderTestsTable.orderId, order.id)),
        db.select().from(patientsTable).where(eq(patientsTable.id, order.patientId)),
        order.doctorId
          ? db.select().from(doctorsTable).where(eq(doctorsTable.id, order.doctorId))
          : Promise.resolve([] as (typeof doctorsTable.$inferSelect)[]),
      ]);
  const doctor = doctorRows[0] ?? null;

  return {
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

ordersRouter.get("/", async (req, res) => {
  const parsed = ListOrdersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { status, patientId, page = 1, limit = 20, dateFrom, dateTo } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions: ReturnType<typeof eq>[] = [];
  if (status) conditions.push(eq(ordersTable.status, status));
  if (patientId) conditions.push(eq(ordersTable.patientId, patientId));
  if (dateFrom) conditions.push(gte(ordersTable.createdAt, new Date(dateFrom)) as ReturnType<typeof eq>);
  if (dateTo) conditions.push(lte(ordersTable.createdAt, new Date(dateTo)) as ReturnType<typeof eq>);

  const [orders, countResult] = await Promise.all([
    db.select().from(ordersTable).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(ordersTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(ordersTable).where(conditions.length > 0 ? and(...conditions) : undefined),
  ]);

  const ordersWithDetails = await Promise.all(orders.map((o) => buildOrder(o)));
  res.json({ orders: ordersWithDetails, total: Number(countResult[0]?.count ?? 0), page, limit });
});

ordersRouter.post("/", createOrderHandler);

export async function createOrderHandler(req: StaffAuthRequest, res: Response): Promise<void> {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { patientId, doctorId, testIds, tests: customTests, notes, clientRef } = parsed.data;
  const startedAt = Date.now();

  const probeByClientRef = () =>
    db.select().from(ordersTable).where(eq(ordersTable.clientRef, clientRef!)).limit(1);

  const hasCustom = !!customTests && customTests.length > 0;
  const hasLegacy = !!testIds && testIds.length > 0;
  if (!hasCustom && !hasLegacy) {
    // Idempotency still wins over body validation (matching the original
    // check order): a retry carrying a known clientRef but a degraded body
    // must replay the existing order, not 400.
    if (clientRef) {
      const [orderRow] = await probeByClientRef();
      if (orderRow) {
        res.status(200).json(await buildOrder(orderRow));
        return;
      }
    }
    res.status(400).json({
      error: "Invalid request",
      details: [
        {
          path: ["tests"],
          message: "At least one of `tests` or `testIds` must be provided with one or more items.",
        },
      ],
    });
    return;
  }

  // The idempotency probe, patient/doctor/test validation lookups, and the
  // order-number sequence are all independent — batch them into one
  // round-trip wave. This POST is the first half of every billing-desk save,
  // so serial awaits here directly delay the receipt print. The idempotency
  // result is checked first, then validation results in the original order
  // (patient → doctor → tests), so error precedence is unchanged.
  const requestedTestIds = hasCustom ? customTests!.map((ct) => ct.testId) : testIds!;
  const [existingByRef, patientRows, doctorRows, testRows] = await Promise.all([
    // ── Idempotency probe (duplicate bill / connectivity retry fix) ────────
    // If the client sent a clientRef UUID and an order already exists with
    // that key, return the existing order instead of creating a duplicate,
    // which would then produce a duplicate bill on the next POST /api/bills.
    clientRef ? probeByClientRef() : Promise.resolve([] as (typeof ordersTable.$inferSelect)[]),
    db.select().from(patientsTable).where(eq(patientsTable.id, patientId)),
    doctorId !== undefined && doctorId !== null
      ? db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId))
      : Promise.resolve([] as (typeof doctorsTable.$inferSelect)[]),
    db.select().from(testsTable).where(inArray(testsTable.id, requestedTestIds)),
  ]);
  // orderNumber is now generated inside the insert transaction under an
  // advisory lock (see below) — no longer part of this parallel wave.

  if (existingByRef[0]) {
    res.status(200).json(await buildOrder(existingByRef[0]));
    return;
  }

  if (!patientRows[0]) {
    res.status(400).json({
      error: "Invalid request",
      details: [
        {
          path: ["patientId"],
          message: `Patient with id ${patientId} does not exist.`,
        },
      ],
    });
    return;
  }

  let resolvedDoctor: typeof doctorsTable.$inferSelect | null = null;
  if (doctorId !== undefined && doctorId !== null) {
    const d = doctorRows[0];
    if (!d) {
      res.status(400).json({
        error: "Invalid request",
        details: [
          {
            path: ["doctorId"],
            message: `Doctor with id ${doctorId} does not exist.`,
          },
        ],
      });
      return;
    }
    resolvedDoctor = d;
  }

  // One id→row map over the fetched catalog rows, shared by validation, the
  // outsource-cost resolution at insert time, and the response build below.
  const testMap = new Map(testRows.map((t) => [t.id, t]));

  // Support two formats: custom [{testId, price}] or legacy testIds[]
  // BOTH paths must verify each test id exists AND is active, otherwise we'd
  // accept orders for discontinued/unknown tests and silently fail at insert
  // time (or, worse, mis-charge the patient).
  let lineItems: { testId: number; price: string }[] = [];
  if (hasCustom) {
    const requestedIds = requestedTestIds;
    const missing = requestedIds.filter((id) => !testMap.has(id));
    const inactive = requestedIds.filter((id) => testMap.get(id) && !testMap.get(id)!.isActive);
    if (missing.length > 0 || inactive.length > 0) {
      res.status(400).json({
        error: "Invalid request",
        details: [
          {
            path: ["tests"],
            message:
              missing.length > 0
                ? `One or more testIds do not refer to an existing test: ${missing.join(", ")}`
                : `One or more testIds refer to discontinued (inactive) tests: ${inactive.join(", ")}`,
          },
        ],
      });
      return;
    }
    // PRICE OVERRIDE GUARD: admin/super_admin may set any price. Regular staff
    // may bill at/below catalog (package line splits) and, when isVip is true,
    // up to catalog × (1 + clinic vip%). Markup above that ceiling is rejected.
    const isFullAccess = FULL_ACCESS_ROLES.has(req.staffSession?.role ?? "");
    if (!isFullAccess) {
      const rawIsVip = !!(req.body as { isVip?: unknown })?.isVip;
      let vipPct = 0;
      if (rawIsVip) {
        const [cfg] = await db
          .select({ vipPercentage: clinicSettingsTable.vipPercentage })
          .from(clinicSettingsTable)
          .limit(1);
        vipPct = Number(cfg?.vipPercentage ?? 50);
        if (!Number.isFinite(vipPct) || vipPct < 0) vipPct = 50;
      }
      const mismatched = customTests!.filter((ct) => {
        const catalogPrice = Number(testMap.get(ct.testId)?.price ?? NaN);
        if (!Number.isFinite(catalogPrice)) return false;
        const requested = Number(ct.price);
        if (!Number.isFinite(requested) || requested < 0) return true;
        const maxAllowed = catalogPrice * (1 + (rawIsVip ? vipPct : 0) / 100);
        return requested - maxAllowed > 0.01;
      });
      if (mismatched.length > 0) {
        res.status(403).json({
          error: "Invalid request",
          details: [
            {
              path: ["tests"],
              message:
                "Only admin/super-admin may bill a test above its catalog price" +
                (rawIsVip ? ` (VIP ceiling ${vipPct}%)` : "") +
                ". " +
                mismatched
                  .map((ct) => `testId=${ct.testId} requested=₹${Number(ct.price).toFixed(2)} catalog=₹${Number(testMap.get(ct.testId)?.price ?? 0).toFixed(2)}`)
                  .join("; "),
            },
          ],
        });
        return;
      }
    }
    lineItems = customTests!.map((ct) => ({ testId: ct.testId, price: String(ct.price) }));
  } else {
    const tests = testRows;
    if (tests.length !== testIds!.length) {
      res.status(400).json({
        error: "Invalid request",
        details: [
          {
            path: ["testIds"],
            message: "One or more testIds do not refer to an existing test.",
          },
        ],
      });
      return;
    }
    const inactive = tests.filter((t) => !t.isActive).map((t) => t.id);
    if (inactive.length > 0) {
      res.status(400).json({
        error: "Invalid request",
        details: [
          {
            path: ["testIds"],
            message: `One or more testIds refer to discontinued (inactive) tests: ${inactive.join(", ")}`,
          },
        ],
      });
      return;
    }
    lineItems = tests.map((t) => ({ testId: t.id, price: t.price }));
  }

  const totalAmount = lineItems.reduce((sum, t) => sum + Number(t.price), 0);

  // Resolve ledger from doctor (fallback: default ledger 1)
  const ledgerId = resolvedDoctor?.ledgerId ?? 1;

  // Insert the order and its line items in ONE transaction: a single commit
  // (one WAL fsync) instead of two, and a crash between the two inserts can
  // no longer leave an order with no line items. Order numbers come from
  // document_number_counters (row UPSERT) — no process-wide advisory lock.
  // Retry a few times on 23505 in case a legacy race still surfaces.
  let order: typeof ordersTable.$inferSelect | undefined;
  let orderTestRows: (typeof orderTestsTable.$inferSelect)[] = [];
  let lastUniqueErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await db.transaction(async (tx) => {
        const orderNumber = await generateOrderNumber(tx);
        const [orderRow] = await tx.insert(ordersTable).values({
          orderNumber,
          patientId,
          doctorId: doctorId ?? null,
          totalAmount: String(totalAmount),
          notes: notes ?? null,
          status: "pending",
          ledgerId,
          // Store clientRef so subsequent retries return this same order
          clientRef: clientRef ?? null,
        }).returning();

        let insertedTests: (typeof orderTestsTable.$inferSelect)[] = [];
        if (lineItems.length > 0) {
          // Resolve outsource cost for each test to store in order_tests — reuses
          // the test rows already fetched for validation instead of re-querying.
          insertedTests = await tx.insert(orderTestsTable).values(
            lineItems.map((t) => {
              const test = testMap.get(t.testId);
              const oc = test?.outsourceCost != null ? String(test.outsourceCost) : null;
              return {
                orderId: orderRow.id,
                testId: t.testId,
                price: t.price,
                outsourceCost: oc,
              };
            })
          ).returning();
        }

        return { order: orderRow, orderTestRows: insertedTests };
      });
      order = result.order;
      orderTestRows = result.orderTestRows;
      lastUniqueErr = undefined;
      break;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Concurrent retries with the same clientRef: winner inserted; loser
      // must return the existing order (not burn 5 allocation retries).
      if (clientRef && isClientRefUniqueViolation(err)) {
        const again = await probeByClientRef();
        if (again[0]) {
          res.status(200).json(await buildOrder(again[0]));
          return;
        }
      }
      lastUniqueErr = err;
      req.log?.warn?.({ attempt, err }, "order_number unique violation — reseeding sequence and retrying");
      await syncOrderNumberSeqForward(db, istYearMonth());
    }
  }
  if (!order) {
    const message = lastUniqueErr instanceof Error ? lastUniqueErr.message : "Could not allocate a unique order number";
    res.status(500).json({ error: message, message });
    return;
  }

  // Build the response through buildOrder — the single owner of this
  // endpoint family's response shape — feeding it the rows already in hand
  // (validated patient and doctor rows, catalog test rows, inserted
  // order/order_tests rows) so it makes zero extra round-trips here.
  const fullOrder = await buildOrder(order, {
    orderTestRows: orderTestRows.map((ot) => ({ orderTest: ot, test: testMap.get(ot.testId) ?? null })),
    patient: patientRows[0],
    doctor: resolvedDoctor,
  });

  const totalMs = Date.now() - startedAt;
  if (totalMs > getSlowThresholdMs()) {
    req.log?.warn?.({ totalMs, orderId: order.id }, "slow order create");
  }

  res.status(201).json(fullOrder);
}

ordersRouter.get("/:id", async (req, res) => {
  const parsed = GetOrderParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(await buildOrder(order));
});

ordersRouter.put("/:id", async (req, res) => {
  const paramsParsed = UpdateOrderParams.safeParse({ id: Number(req.params.id) });
  const bodyParsed = UpdateOrderBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    const details = [
      ...(paramsParsed.success ? [] : paramsParsed.error.issues),
      ...(bodyParsed.success ? [] : bodyParsed.error.issues),
    ];
    res.status(400).json({ error: "Invalid request", details });
    return;
  }
  const { status, notes } = bodyParsed.data;
  const updateData: Record<string, unknown> = { status };
  if (notes !== undefined) updateData.notes = notes;
  if (status === "collected") updateData.collectedAt = new Date();
  if (status === "completed") updateData.completedAt = new Date();

  const [updated] = await db
    .update(ordersTable)
    .set(updateData)
    .where(eq(ordersTable.id, paramsParsed.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(await buildOrder(updated));
});

// ── Update display name on an individual order-test line item ──────────────────
ordersRouter.patch("/:orderId/tests/:testId", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const testId = Number(req.params.testId);
  const { displayName } = req.body;

  if (!Number.isFinite(orderId) || !Number.isFinite(testId)) {
    res.status(400).json({ error: "Invalid order or test id" });
    return;
  }

  const [updated] = await db
    .update(orderTestsTable)
    .set({ displayName: typeof displayName === "string" && displayName.trim() ? displayName.trim() : null })
    .where(and(eq(orderTestsTable.orderId, orderId), eq(orderTestsTable.id, testId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Order test not found" });
    return;
  }

  res.json({ id: updated.id, displayName: updated.displayName });
});
