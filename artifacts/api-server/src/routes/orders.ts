import { Router } from "express";
import { db, ordersTable, orderTestsTable, testsTable, patientsTable, doctorsTable } from "@workspace/db";
import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
import {
  ListOrdersQueryParams,
  CreateOrderBody,
  GetOrderParams,
  UpdateOrderParams,
  UpdateOrderBody,
} from "@workspace/api-zod";
import { sanitizePatient } from "./patients";

export const ordersRouter = Router();

async function generateOrderNumber(): Promise<string> {
  const count = await db.select({ count: sql<number>`count(*)` }).from(ordersTable);
  const num = Number(count[0]?.count ?? 0) + 1;
  const date = new Date();
  const prefix = `ORD-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
  return `${prefix}-${String(num).padStart(4, "0")}`;
}

async function buildOrder(order: typeof ordersTable.$inferSelect) {
  const orderTestRows = await db
    .select({ orderTest: orderTestsTable, test: testsTable })
    .from(orderTestsTable)
    .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
    .where(eq(orderTestsTable.orderId, order.id));

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, order.patientId));
  let doctor = null;
  if (order.doctorId) {
    const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, order.doctorId));
    doctor = d ?? null;
  }

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

  const ordersWithDetails = await Promise.all(orders.map(buildOrder));
  res.json({ orders: ordersWithDetails, total: Number(countResult[0]?.count ?? 0), page, limit });
});

ordersRouter.post("/", async (req, res) => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { patientId, doctorId, testIds, tests: customTests, notes, clientRef } = parsed.data;

  // ── Idempotency check (duplicate bill / connectivity retry fix) ───────────
  // If the client sends a clientRef UUID and an order already exists with that
  // key, return the existing order immediately. This makes POST /api/orders
  // safe to retry after a network timeout — the browser gets the same order
  // back instead of creating a duplicate, which would then produce a duplicate
  // bill on the next POST /api/bills.
  if (clientRef) {
    const existing = await db.execute<{ id: number }>(
      sql\`SELECT id FROM orders WHERE client_ref = \${clientRef} LIMIT 1\`
    );
    const rows = Array.isArray(existing) ? existing : (existing as any).rows ?? [];
    const existingId: number | undefined = rows[0]?.id;
    if (existingId) {
      const [orderRow] = await db.select().from(ordersTable)
        .where(eq(ordersTable.id, existingId));
      if (orderRow) {
        res.status(200).json(await buildOrder(orderRow));
        return;
      }
    }
  }

  const [patientRow] = await db.select({ id: patientsTable.id }).from(patientsTable).where(eq(patientsTable.id, patientId));
  if (!patientRow) {
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
    const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
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

  const hasCustom = !!customTests && customTests.length > 0;
  const hasLegacy = !!testIds && testIds.length > 0;
  if (!hasCustom && !hasLegacy) {
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

  // Support two formats: custom [{testId, price}] or legacy testIds[]
  // BOTH paths must verify each test id exists AND is active, otherwise we'd
  // accept orders for discontinued/unknown tests and silently fail at insert
  // time (or, worse, mis-charge the patient).
  let lineItems: { testId: number; price: string }[] = [];
  if (hasCustom) {
    const requestedIds = customTests!.map((ct) => ct.testId);
    const foundTests = await db.select({ id: testsTable.id, isActive: testsTable.isActive })
      .from(testsTable)
      .where(inArray(testsTable.id, requestedIds));
    const foundMap = new Map(foundTests.map((t) => [t.id, t]));
    const missing = requestedIds.filter((id) => !foundMap.has(id));
    const inactive = requestedIds.filter((id) => foundMap.get(id) && !foundMap.get(id)!.isActive);
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
    lineItems = customTests!.map((ct) => ({ testId: ct.testId, price: String(ct.price) }));
  } else {
    const tests = await db.select().from(testsTable).where(
      inArray(testsTable.id, testIds!),
    );
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
  const orderNumber = await generateOrderNumber();

  // Resolve ledger from doctor (fallback: default ledger 1)
  const ledgerId = resolvedDoctor?.ledgerId ?? 1;

  const [order] = await db.insert(ordersTable).values({
    orderNumber,
    patientId,
    doctorId: doctorId ?? null,
    totalAmount: String(totalAmount),
    notes: notes ?? null,
    status: "pending",
    ledgerId,
    // Store clientRef so subsequent retries return this same order
    ...(clientRef ? { clientRef } as Record<string, unknown> : {}),
  } as any).returning();

  if (lineItems.length > 0) {
    // Resolve outsource cost for each test to store in order_tests.
    const testIds = lineItems.map((t) => t.testId);
    const testRows = testIds.length > 0
      ? await db.select().from(testsTable).where(inArray(testsTable.id, testIds))
      : [];
    const testMap = new Map(testRows.map((t) => [t.id, t]));
    await db.insert(orderTestsTable).values(
      lineItems.map((t) => {
        const test = testMap.get(t.testId);
        const oc = test?.outsourceCost != null ? String(test.outsourceCost) : null;
        return {
          orderId: order.id,
          testId: t.testId,
          price: t.price,
          outsourceCost: oc,
        };
      })
    );
  }

  const fullOrder = await buildOrder(order);
  res.status(201).json(fullOrder);
});

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
