import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  testTokensTable, testsTable, patientsTable, ordersTable,
  orderTestsTable, billsTable,
} from "@workspace/db/schema";
import { and, asc, desc, eq, isNull, ilike, or, sql } from "drizzle-orm";

export const testTokensRouter: IRouter = Router();

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ledgerScope(ledgerId: number) {
  return ledgerId === 1
    ? or(eq(testTokensTable.ledgerId, 1), isNull(testTokensTable.ledgerId))
    : eq(testTokensTable.ledgerId, ledgerId);
}

// Atomic per-(ledger, date, department) token allocator.
//
// The unique index `test_tokens_dept_date_no_uq` makes concurrent inserts safe
// at the DB level: if two transactions race and pick the same `MAX+1`, exactly
// one wins. We retry the loser a bounded number of times.
//
// We DO NOT swallow the dept-daily collision — it must retry, otherwise a
// concurrent fan-out could silently lose a token.
export async function generateTestToken(opts: {
  ledgerId: number;
  billId: number;
  orderId: number;
  orderTestId: number;
  testId: number;
  patientId: number;
  department: string;
  roomNumber: string;
  priority?: number;
  source?: string;
}): Promise<{ tokenNo: number; tokenDate: string; department: string; roomNumber: string }> {
  const tokenDate = todayISO();
  const ledgerMatch = opts.ledgerId === 1
    ? sql`(${testTokensTable.ledgerId} = 1 OR ${testTokensTable.ledgerId} IS NULL)`
    : sql`${testTokensTable.ledgerId} = ${opts.ledgerId}`;
  const nextNoExpr = sql<number>`(
    SELECT COALESCE(MAX(${testTokensTable.tokenNo}), 0) + 1
      FROM ${testTokensTable}
     WHERE ${testTokensTable.tokenDate} = ${tokenDate}
       AND ${testTokensTable.department} = ${opts.department}
       AND ${ledgerMatch}
  )`;

  const MAX_ATTEMPTS = 6;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const [row] = await db
        .insert(testTokensTable)
        .values({
          ledgerId: opts.ledgerId,
          billId: opts.billId,
          orderId: opts.orderId,
          orderTestId: opts.orderTestId,
          testId: opts.testId,
          patientId: opts.patientId,
          department: opts.department,
          roomNumber: opts.roomNumber,
          tokenNo: nextNoExpr,
          tokenDate,
          status: "waiting",
          priority: opts.priority ?? 0,
          source: opts.source ?? "walkin",
        })
        .returning({ tokenNo: testTokensTable.tokenNo });
      return { tokenNo: row.tokenNo, tokenDate, department: opts.department, roomNumber: opts.roomNumber };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Retry only on dept-daily token-no collision; bubble everything else
      // (including orderTestUq — caller decides whether to swallow).
      if (/test_tokens_dept_date_no_uq/i.test(msg)) {
        if (attempt === MAX_ATTEMPTS - 1) throw err;
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 30));
        continue;
      }
      throw err;
    }
  }
  // Unreachable — loop either returns or throws.
  throw new Error("generateTestToken: exhausted retries");
}

// GET /api/test-tokens/today?ledgerId=N&date=YYYY-MM-DD&department=USG&search=...
testTokensRouter.get("/today", async (req, res): Promise<void> => {
  const raw = req.query.ledgerId;
  const ledgerId = Number(raw);
  if (raw === undefined || raw === "" || !Number.isInteger(ledgerId) || ledgerId <= 0) {
    res.status(400).json({
      error: "Invalid request",
      details: [{ path: ["ledgerId"], message: "ledgerId is required and must be a positive integer" }],
    });
    return;
  }
  const date = (req.query.date as string) || todayISO();
  const department = (req.query.department as string) || "";
  const search = (req.query.search as string)?.trim() || "";

  const conds = [eq(testTokensTable.tokenDate, date), ledgerScope(ledgerId)];
  if (department && department !== "all") conds.push(eq(testTokensTable.department, department));

  const rows = await db
    .select({
      id: testTokensTable.id,
      tokenNo: testTokensTable.tokenNo,
      tokenDate: testTokensTable.tokenDate,
      status: testTokensTable.status,
      priority: testTokensTable.priority,
      department: testTokensTable.department,
      roomNumber: testTokensTable.roomNumber,
      billId: testTokensTable.billId,
      orderId: testTokensTable.orderId,
      orderTestId: testTokensTable.orderTestId,
      testId: testTokensTable.testId,
      patientId: testTokensTable.patientId,
      patientName: sql<string>`COALESCE(${patientsTable.firstName} || ' ' || ${patientsTable.lastName}, '')`,
      patientCode: patientsTable.patientId,
      patientPhone: patientsTable.phone,
      testCode: testsTable.code,
      testName: testsTable.name,
      testDuration: testsTable.duration,
      billNumber: billsTable.billNumber,
      calledAt: testTokensTable.calledAt,
      createdAt: testTokensTable.createdAt,
      source: testTokensTable.source,
    })
    .from(testTokensTable)
    .leftJoin(patientsTable, eq(patientsTable.id, testTokensTable.patientId))
    .leftJoin(testsTable, eq(testsTable.id, testTokensTable.testId))
    .leftJoin(billsTable, eq(billsTable.id, testTokensTable.billId))
    .where(and(...conds))
    .orderBy(desc(testTokensTable.priority), asc(testTokensTable.tokenNo));

  let filtered = rows;
  if (search) {
    const s = search.toLowerCase();
    filtered = rows.filter((r) =>
      String(r.tokenNo).includes(s) ||
      (r.patientName ?? "").toLowerCase().includes(s) ||
      (r.patientCode ?? "").toLowerCase().includes(s) ||
      (r.patientPhone ?? "").toLowerCase().includes(s) ||
      (r.testName ?? "").toLowerCase().includes(s) ||
      (r.testCode ?? "").toLowerCase().includes(s) ||
      (r.billNumber ?? "").toLowerCase().includes(s)
    );
  }
  res.json(filtered);
});

// GET /api/test-tokens/departments — unique department list with active room
testTokensRouter.get("/departments", async (_req, res) => {
  const fromTests = await db
    .selectDistinct({ department: testsTable.department, roomNumber: testsTable.roomNumber })
    .from(testsTable)
    .where(eq(testsTable.isActive, true));
  // De-dupe by department, take the first room seen for each.
  const map = new Map<string, string>();
  for (const r of fromTests) {
    if (!map.has(r.department)) map.set(r.department, r.roomNumber || "");
  }
  res.json(Array.from(map, ([department, roomNumber]) => ({ department, roomNumber })));
});

// PATCH /api/test-tokens/:id  { status?, priority? }
testTokensRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as { status?: string; priority?: number };

  const updates: Partial<typeof testTokensTable.$inferInsert> = {};
  if (body.status !== undefined) {
    if (!["waiting", "serving", "done", "skipped"].includes(body.status)) {
      res.status(400).json({ error: "Invalid status" }); return;
    }
    updates.status = body.status;
    if (body.status === "serving") updates.calledAt = new Date();
    if (body.status === "done") updates.completedAt = new Date();
  }
  if (body.priority !== undefined) {
    const p = Number(body.priority);
    if (!Number.isFinite(p) || p < 0 || p > 9) {
      res.status(400).json({ error: "priority must be 0-9" }); return;
    }
    updates.priority = p;
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" }); return;
  }

  const [row] = await db.update(testTokensTable).set(updates).where(eq(testTokensTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Token not found" }); return; }
  res.json(row);
});

// POST /api/test-tokens/:id/call — mark serving + advance previous serving in same dept to done.
// Wrapped in a transaction so two concurrent /call requests cannot both leave
// their target as "serving" in the same department.
testTokensRouter.post("/:id/call", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const updated = await db.transaction(async (tx) => {
      const [t] = await tx.select().from(testTokensTable).where(eq(testTokensTable.id, id));
      if (!t) return null;

      // Auto-complete any previous "serving" token in the same
      // department/date/ledger. Use the token's actual ledgerId; if it is
      // null, scope strictly to other null-ledger rows instead of silently
      // collapsing all unaffiliated tokens into ledger #1.
      const ledgerCondition = t.ledgerId == null
        ? isNull(testTokensTable.ledgerId)
        : eq(testTokensTable.ledgerId, t.ledgerId);
      await tx.update(testTokensTable)
        .set({ status: "done", completedAt: new Date() })
        .where(and(
          eq(testTokensTable.department, t.department),
          eq(testTokensTable.tokenDate, t.tokenDate),
          eq(testTokensTable.status, "serving"),
          ledgerCondition,
        ));

      const [u] = await tx.update(testTokensTable)
        .set({ status: "serving", calledAt: new Date() })
        .where(eq(testTokensTable.id, id)).returning();
      return u;
    });

    if (!updated) { res.status(404).json({ error: "Token not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "test-token call failed");
    res.status(500).json({ error: "Failed to call token" });
  }
});

export default testTokensRouter;

// Used by other routers (notably bills.ts) to fan out tokens for a fresh order.
export async function generateTestTokensForOrder(opts: {
  ledgerId: number;
  billId: number;
  orderId: number;
  patientId: number;
  priority?: number;
  source?: string;
}): Promise<Array<{ orderTestId: number; testName: string; department: string; roomNumber: string; floorLabel: string; tokenNo: number }>> {
  const orderTests = await db
    .select({
      orderTestId: orderTestsTable.id,
      testId: orderTestsTable.testId,
      testName: testsTable.name,
      department: testsTable.department,
      roomNumber: testsTable.roomNumber,
      floorLabel: testsTable.floorLabel,
    })
    .from(orderTestsTable)
    .innerJoin(testsTable, eq(testsTable.id, orderTestsTable.testId))
    .where(eq(orderTestsTable.orderId, opts.orderId));

  const out: Array<{ orderTestId: number; testName: string; department: string; roomNumber: string; floorLabel: string; tokenNo: number }> = [];
  for (const ot of orderTests) {
    try {
      const t = await generateTestToken({
        ledgerId: opts.ledgerId,
        billId: opts.billId,
        orderId: opts.orderId,
        orderTestId: ot.orderTestId,
        testId: ot.testId,
        patientId: opts.patientId,
        department: ot.department || "Pathology",
        roomNumber: ot.roomNumber || "",
        priority: opts.priority,
        source: opts.source,
      });
      out.push({
        orderTestId: ot.orderTestId,
        testName: ot.testName,
        department: t.department,
        roomNumber: t.roomNumber,
        floorLabel: ot.floorLabel || "",
        tokenNo: t.tokenNo,
      });
    } catch (err) {
      // orderTestUq UNIQUE prevents double-issue if this gets called twice for
      // the same bill (e.g. retry on a non-idempotent POST). That is the ONLY
      // class of "unique" error we silently skip — anything else (including
      // dept-daily collisions, which generateTestToken already retries) must
      // surface so the caller can decide.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/test_tokens_order_test_uq/i.test(msg)) throw err;
    }
  }
  return out;
}

// Avoid ilike unused-import warning while keeping it available for future search work.
void ilike;
