import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tokensTable, patientsTable } from "@workspace/db/schema";
import { and, desc, eq, isNull, max, or, sql } from "drizzle-orm";

export const tokensRouter: IRouter = Router();

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ledgerScope(ledgerId: number) {
  return ledgerId === 1
    ? or(eq(tokensTable.ledgerId, 1), isNull(tokensTable.ledgerId))
    : eq(tokensTable.ledgerId, ledgerId);
}

export async function generateTokenForBill(opts: {
  ledgerId: number;
  billId: number;
  patientId: number;
  priority?: number;
  source?: string;
}): Promise<{ tokenNo: number; tokenDate: string }> {
  const tokenDate = todayISO();
  // Atomic insert: compute next token number inside the INSERT itself so two
  // concurrent bills can never receive the same token. A unique index on
  // (ledger_id, token_date, token_no) provides a final safety net.
  const ledgerMatch =
    opts.ledgerId === 1
      ? sql`(${tokensTable.ledgerId} = 1 OR ${tokensTable.ledgerId} IS NULL)`
      : sql`${tokensTable.ledgerId} = ${opts.ledgerId}`;
  const nextNoExpr = sql<number>`(
    SELECT COALESCE(MAX(${tokensTable.tokenNo}), 0) + 1
      FROM ${tokensTable}
     WHERE ${tokensTable.tokenDate} = ${tokenDate}
       AND ${ledgerMatch}
  )`;
  const [row] = await db
    .insert(tokensTable)
    .values({
      ledgerId: opts.ledgerId,
      billId: opts.billId,
      patientId: opts.patientId,
      tokenNo: nextNoExpr,
      tokenDate,
      status: "waiting",
      priority: opts.priority ?? 0,
      source: opts.source ?? "walkin",
    })
    .returning({ tokenNo: tokensTable.tokenNo });
  return { tokenNo: row.tokenNo, tokenDate };
}

// GET /api/tokens/today?ledgerId=N (required)
tokensRouter.get("/today", async (req, res): Promise<void> => {
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
  const rows = await db
    .select({
      id: tokensTable.id,
      tokenNo: tokensTable.tokenNo,
      tokenDate: tokensTable.tokenDate,
      status: tokensTable.status,
      billId: tokensTable.billId,
      patientId: tokensTable.patientId,
      patientName: sql<string>`${patientsTable.firstName} || ' ' || ${patientsTable.lastName}`,
      patientCode: patientsTable.patientId,
      priority: tokensTable.priority,
      createdAt: tokensTable.createdAt,
    })
    .from(tokensTable)
    .leftJoin(patientsTable, eq(patientsTable.id, tokensTable.patientId))
    .where(and(eq(tokensTable.tokenDate, date), ledgerScope(ledgerId)))
    .orderBy(desc(tokensTable.priority), desc(tokensTable.tokenNo));
  res.json(rows);
});

// PATCH /api/tokens/:id  { status?, priority? }
tokensRouter.patch("/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { status, priority } = req.body as { status?: string; priority?: number };
  const updates: Partial<typeof tokensTable.$inferInsert> = {};
  if (status !== undefined) {
    if (!["waiting", "serving", "done", "skipped"].includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    updates.status = status;
  }
  if (priority !== undefined) {
    const p = Number(priority);
    if (!Number.isFinite(p) || p < 0 || p > 9) {
      res.status(400).json({ error: "priority must be 0-9" });
      return;
    }
    updates.priority = p;
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }
  const [row] = await db.update(tokensTable).set(updates).where(eq(tokensTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Token not found" });
    return;
  }
  res.json(row);
});

export default tokensRouter;
