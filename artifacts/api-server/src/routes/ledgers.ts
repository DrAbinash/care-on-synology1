import { Router } from "express";
import {
  db,
  ledgersTable,
  doctorsTable,
  patientsTable,
  ordersTable,
  orderTestsTable,
  billsTable,
  paymentsTable,
  appointmentsTable,
  superAdminSessionsTable,
  billAuditsTable,
} from "@workspace/db";
import { eq, and, sql, isNull, or, inArray } from "drizzle-orm";
import {
  CreateLedgerBody,
  UpdateLedgerParams,
  UpdateLedgerBody,
  DeleteLedgerParams,
  DeleteLedgerBody,
  AssignDoctorsToLedgerParams,
  AssignDoctorsToLedgerBody,
  ResetLedgerParams,
  ResetLedgerBody,
} from "@workspace/api-zod";

export const ledgersRouter = Router();

// ── Helper: ensure default ledger (id=1) exists + run column migrations ───────
export async function ensureDefaultLedger(): Promise<void> {
  // Idempotent column migration — safe to run every startup
  await db.execute(sql`
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS is_walk_in BOOLEAN NOT NULL DEFAULT false
  `);
  // Auto-detect walk-in book by name pattern if none is marked yet
  await db.execute(sql`
    UPDATE ledgers SET is_walk_in = true
    WHERE id = (
      SELECT id FROM ledgers
      WHERE (LOWER(name) LIKE '%walk%' OR LOWER(name) LIKE '%self%referral%')
        AND is_default = false
      ORDER BY id DESC
      LIMIT 1
    )
    AND NOT EXISTS (SELECT 1 FROM ledgers WHERE is_walk_in = true)
  `);

  const [existing] = await db.select().from(ledgersTable).where(eq(ledgersTable.id, 1));
  if (existing) return;
  await db.execute(sql`
    INSERT INTO ledgers (id, name, is_default, created_at)
    VALUES (1, 'Default / Walk-in', true, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    SELECT setval(pg_get_serial_sequence('ledgers', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM ledgers), 1))
  `);
}

// ── Helper: get the walk-in ledger id (falls back to 1 if none tagged) ────────
export async function getWalkInLedgerId(): Promise<number> {
  const [wl] = await db.select({ id: ledgersTable.id }).from(ledgersTable).where(eq(ledgersTable.isWalkIn, true)).limit(1);
  return wl?.id ?? 1;
}

// id=1 (default) also matches NULL (legacy rows)
function matchLedger<T extends { ledgerId: import("drizzle-orm/pg-core").PgColumn }>(
  table: T,
  ledgerId: number,
) {
  return ledgerId === 1
    ? or(eq(table.ledgerId, 1), isNull(table.ledgerId))!
    : eq(table.ledgerId, ledgerId);
}

// ── Helper: verify super admin token ──────────────────────────────────────────
export async function verifySuperAdmin(token: string): Promise<{ valid: boolean; userName: string }> {
  if (!token) return { valid: false, userName: "" };
  const [s] = await db.select().from(superAdminSessionsTable).where(eq(superAdminSessionsTable.token, token));
  if (!s || !s.isActive || new Date(s.expiresAt) < new Date()) return { valid: false, userName: "" };
  return { valid: true, userName: s.userName };
}

// ── GET /api/ledgers — list books with stats ──────────────────────────────────
ledgersRouter.get("/", async (_req, res) => {
  await ensureDefaultLedger();
  const ledgers = await db.select().from(ledgersTable).orderBy(ledgersTable.id);

  const result = await Promise.all(
    ledgers.map(async (l) => {
      const [doctorCount, patientCount, billCount, orderCount, appointmentCount] = await Promise.all([
        db.select({ c: sql<number>`count(*)` }).from(doctorsTable).where(matchLedger(doctorsTable, l.id)),
        db.select({ c: sql<number>`count(*)` }).from(patientsTable).where(matchLedger(patientsTable, l.id)),
        db.select({ c: sql<number>`count(*)` }).from(billsTable).where(matchLedger(billsTable, l.id)),
        db.select({ c: sql<number>`count(*)` }).from(ordersTable).where(matchLedger(ordersTable, l.id)),
        db.select({ c: sql<number>`count(*)` }).from(appointmentsTable).where(matchLedger(appointmentsTable, l.id)),
      ]);
      return {
        ...l,
        doctorCount: Number(doctorCount[0]?.c ?? 0),
        patientCount: Number(patientCount[0]?.c ?? 0),
        billCount: Number(billCount[0]?.c ?? 0),
        orderCount: Number(orderCount[0]?.c ?? 0),
        appointmentCount: Number(appointmentCount[0]?.c ?? 0),
      };
    }),
  );

  res.json(result);
});

// ── POST /api/ledgers — create new book (super admin) ─────────────────────────
ledgersRouter.post("/", async (req, res) => {
  const bodyParsed = CreateLedgerBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request", details: bodyParsed.error.issues });
    return;
  }
  const { token, name } = bodyParsed.data;
  const { valid } = await verifySuperAdmin(token);
  if (!valid) {
    res.status(403).json({ error: "Super admin session expired or invalid." });
    return;
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const [created] = await db.insert(ledgersTable).values({ name: trimmedName, isDefault: false }).returning();
    res.status(201).json(created);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to create ledger";
    if (msg.includes("unique")) {
      res.status(409).json({ error: "A book with that name already exists" });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

// ── PATCH /api/ledgers/:id — rename ───────────────────────────────────────────
ledgersRouter.patch("/:id", async (req, res) => {
  const paramsParsed = UpdateLedgerParams.safeParse(req.params);
  const bodyParsed = UpdateLedgerBody.safeParse(req.body);
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
  const { token, name } = bodyParsed.data;
  const { valid } = await verifySuperAdmin(token);
  if (!valid) {
    res.status(403).json({ error: "Super admin session expired or invalid." });
    return;
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const [updated] = await db.update(ledgersTable).set({ name: trimmedName }).where(eq(ledgersTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    res.json(updated);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to rename";
    if (msg.includes("unique")) {
      res.status(409).json({ error: "A book with that name already exists" });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

// ── DELETE /api/ledgers/:id — delete book (must be empty, cannot be default) ─
ledgersRouter.delete("/:id", async (req, res) => {
  const paramsParsed = DeleteLedgerParams.safeParse(req.params);
  const bodyParsed = DeleteLedgerBody.safeParse(req.body);
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
  const { token } = bodyParsed.data;
  const { valid } = await verifySuperAdmin(token);
  if (!valid) {
    res.status(403).json({ error: "Super admin session expired or invalid." });
    return;
  }

  const [ledger] = await db.select().from(ledgersTable).where(eq(ledgersTable.id, id));
  if (!ledger) {
    res.status(404).json({ error: "Book not found" });
    return;
  }
  if (ledger.isDefault) {
    res.status(400).json({ error: "Cannot delete the default book" });
    return;
  }

  // Move any doctors assigned to this book back to the default book
  await db.update(doctorsTable).set({ ledgerId: 1 }).where(eq(doctorsTable.ledgerId, id));

  // Refuse if there is any patient/bill/order/appointment data
  const [bc] = await db.select({ c: sql<number>`count(*)` }).from(billsTable).where(eq(billsTable.ledgerId, id));
  const [pc] = await db.select({ c: sql<number>`count(*)` }).from(patientsTable).where(eq(patientsTable.ledgerId, id));
  if (Number(bc?.c ?? 0) > 0 || Number(pc?.c ?? 0) > 0) {
    res.status(400).json({ error: "Book is not empty — reset it first before deleting" });
    return;
  }

  await db.delete(ledgersTable).where(eq(ledgersTable.id, id));
  res.json({ success: true });
});

// ── POST /api/ledgers/:id/assign-doctors — set doctor list for this book ─────
ledgersRouter.post("/:id/assign-doctors", async (req, res) => {
  const paramsParsed = AssignDoctorsToLedgerParams.safeParse(req.params);
  const bodyParsed = AssignDoctorsToLedgerBody.safeParse(req.body);
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
  const { token, doctorIds } = bodyParsed.data;
  const { valid } = await verifySuperAdmin(token);
  if (!valid) {
    res.status(403).json({ error: "Super admin session expired or invalid." });
    return;
  }

  const [ledger] = await db.select().from(ledgersTable).where(eq(ledgersTable.id, id));
  if (!ledger) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  // Move all currently-in-this-book doctors that are NOT in the new list back to default
  await db.update(doctorsTable)
    .set({ ledgerId: 1 })
    .where(and(eq(doctorsTable.ledgerId, id), doctorIds.length > 0 ? sql`${doctorsTable.id} NOT IN (${sql.join(doctorIds.map((d: number) => sql`${d}`), sql`, `)})` : sql`true`));

  // Set the requested doctors to this book
  if (doctorIds.length > 0) {
    await db.update(doctorsTable).set({ ledgerId: id }).where(inArray(doctorsTable.id, doctorIds));
  }

  res.json({ assigned: doctorIds.length });
});

// ── POST /api/ledgers/:id/reset — wipe all data for this book ────────────────
ledgersRouter.post("/:id/reset", async (req, res) => {
  const paramsParsed = ResetLedgerParams.safeParse(req.params);
  const bodyParsed = ResetLedgerBody.safeParse(req.body);
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
  if (!reason || reason.trim().length < 3) {
    res.status(400).json({ error: "A reason of at least 3 characters is required" });
    return;
  }
  const { valid, userName } = await verifySuperAdmin(token);
  if (!valid) {
    res.status(403).json({ error: "Super admin session expired or invalid." });
    return;
  }

  const [ledger] = await db.select().from(ledgersTable).where(eq(ledgersTable.id, id));
  if (!ledger) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  // Find rows that belong to this ledger (id=1 also includes NULL)
  const isDefault = id === 1;
  const billRows = await db.select({ id: billsTable.id }).from(billsTable).where(
    isDefault ? or(eq(billsTable.ledgerId, 1), isNull(billsTable.ledgerId)) : eq(billsTable.ledgerId, id),
  );
  const billIds = billRows.map(r => r.id);

  const orderRows = await db.select({ id: ordersTable.id }).from(ordersTable).where(
    isDefault ? or(eq(ordersTable.ledgerId, 1), isNull(ordersTable.ledgerId)) : eq(ordersTable.ledgerId, id),
  );
  const orderIds = orderRows.map(r => r.id);

  const patientRows = await db.select({ id: patientsTable.id }).from(patientsTable).where(
    isDefault ? or(eq(patientsTable.ledgerId, 1), isNull(patientsTable.ledgerId)) : eq(patientsTable.ledgerId, id),
  );
  const patientIds = patientRows.map(r => r.id);

  // ── Orphan guard — refuse to wipe patients who have accounting vouchers ──────
  // Deleting a patient with linked vouchers breaks the Trial Balance because
  // the voucher rows (patient_id FK) point to a non-existent patient.
  // We check bills (which cascade into vouchers via auto-voucher) and block
  // only if paid or finalised bills exist. Empty/cancelled-only bills are safe.
  if (patientIds.length > 0) {
    const [financiallyActive] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(billsTable)
      .where(
        and(
          inArray(billsTable.patientId, patientIds),
          sql`${billsTable.status} IN ('paid','partial')`,
        ),
      );

    if ((financiallyActive?.count ?? 0) > 0) {
      res.status(409).json({
        error: "Cannot wipe ledger: patients have settled bills and accounting vouchers. " +
          "Deleting them would break the Trial Balance. " +
          "Archive the ledger instead, or contact the finance team.",
        patientsWithBills: financiallyActive.count,
      });
      return;
    }
  }

  // Wipe in dependency-safe order
  if (billIds.length) {
    await db.delete(paymentsTable).where(inArray(paymentsTable.billId, billIds));
    await db.delete(billAuditsTable).where(inArray(billAuditsTable.billId, billIds));
    await db.delete(billsTable).where(inArray(billsTable.id, billIds));
  }
  if (orderIds.length) {
    await db.delete(orderTestsTable).where(inArray(orderTestsTable.orderId, orderIds));
    await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds));
  }
  // Appointments tied directly to ledger OR to one of the wiped patients
  await db.delete(appointmentsTable).where(
    isDefault
      ? or(eq(appointmentsTable.ledgerId, 1), isNull(appointmentsTable.ledgerId))
      : eq(appointmentsTable.ledgerId, id),
  );
  if (patientIds.length) {
    await db.delete(appointmentsTable).where(inArray(appointmentsTable.patientId, patientIds));
    await db.delete(patientsTable).where(inArray(patientsTable.id, patientIds));
  }

  res.json({
    ok: true,
    book: ledger.name,
    by: userName,
    reason,
    wiped: {
      bills: billIds.length,
      orders: orderIds.length,
      patients: patientIds.length,
    },
  });
});
