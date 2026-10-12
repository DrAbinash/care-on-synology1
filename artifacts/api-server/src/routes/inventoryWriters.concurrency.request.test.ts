/**
 * B-13 — real-Postgres concurrency across EVERY inventory balance writer.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * B-11 made one consumption EVENT agree with itself (advisory lock on the
 * ledger reference). B-12 made two different EVENTS spending the same shelf
 * agree with each other (`SELECT … FOR UPDATE` on the row whose value the
 * ledger is written against). Both of those live in
 * `lib/inventoryConsumption.ts` — the automatic deduction path.
 *
 * Those three `FOR UPDATE` reads are the only row locks on any inventory table
 * in this server. The manual store screens and the lot endpoints are separate
 * writers of the same two columns:
 *
 *   POST /api/inventory/:id/stock-in            read → +qty → write absolute
 *   POST /api/inventory/:id/stock-out           read → guard → -qty → write absolute
 *   POST /api/inventory/:id/adjust              read → write target, TWO bare statements
 *   POST /api/inventory/batches                 lot INSERT + item bump + ledger
 *   POST /api/inventory/items/:id/consume-fefo  lots then item, no locks
 *   POST /api/inventory/demands/:id/issue       status guard outside the transaction
 *   POST /api/purchase-invoices/:id/post        one transaction, N items, no locks
 *
 * Every one of them is a read-compute-write on `current_stock`, so any two
 * running together can silently discard a committed movement, oversell a shelf
 * that showed enough stock, double-post an invoice, or leave
 * `inventory_transactions` and `inventory_batches` describing a balance the
 * item row does not have.
 *
 * THE INVARIANT EVERY CASE CHECKS
 * -------------------------------
 * `assertChain` is the decisive one, and it is stronger than "the final number
 * is right": read the item's ledger in serial `id` order and require
 *
 *   row[i].stock_before == row[i-1].stock_after            (no movement lost)
 *   row[last].stock_after == inventory_items.current_stock (books agree with shelf)
 *   current_stock >= 0                                     (never oversold)
 *
 * `id` is a serial allocated at INSERT, and every writer inserts its ledger row
 * inside the same transaction that moves the balance, so once the writers are
 * serialised id order IS commit order. A broken link is therefore not a
 * formatting complaint — it proves two committed transactions each wrote a
 * balance derived from a value the other had already replaced. The positive
 * control at the top of this file demonstrates that drift with raw SQL, and
 * B13-A6 demonstrates that `assertChain` reports it, so neither the race nor
 * the canary is being assumed.
 *
 * Requires DATABASE_URL: skipped on a machine without a database, executed in
 * CI against `postgres:16-alpine` built by the full migration path, with files
 * run sequentially (`--no-file-parallelism`) so these are the only concurrent
 * sessions on the cluster.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { Express } from "express";
import request, { type Response } from "supertest";
import { db, pool } from "@workspace/db";
import {
  inventoryBatchesTable,
  inventoryConsumptionRulesTable,
  inventoryDemandRequestsTable,
  inventoryItemsTable,
  inventoryReorderRequestsTable,
  inventoryTransactionsTable,
  portalSessionsTable,
  purchaseInvoiceLineItemsTable,
  purchaseInvoicesTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { consumeInventoryForTest, consumptionReference, type ConsumeLineResult } from "../lib/inventoryConsumption";

const marker = `B13-${randomBytes(5).toString("hex")}`;
const token = `vitest-b13-${randomBytes(6).toString("hex")}`;
const AUTH = `Bearer ${token}`;

const r2 = (v: number) => Math.round(v * 100) / 100;

// Marker-scoped ids, drained by afterAll.
const itemIds: number[] = [];
const testIds: number[] = [];
const ruleIds: number[] = [];
const demandIds: number[] = [];
const invoiceIds: number[] = [];
const userIds: number[] = [];
let app: Express;

type Lot = { qty: string; expiry: string };
type Item = { id: number; initial: number };

async function mkItem(over: { stock?: string; lots?: Lot[] } = {}): Promise<Item> {
  const lots: Lot[] = over.lots ?? [];
  const stock = over.stock ?? lots.reduce((s, l) => r2(s + Number(l.qty)), 0).toFixed(2);
  const [item] = await db
    .insert(inventoryItemsTable)
    .values({
      name: `${marker} item ${itemIds.length}`,
      unit: "vial",
      category: "reagent",
      currentStock: stock,
      trackExpiry: lots.length > 0,
      isActive: true,
    })
    .returning();
  itemIds.push(item.id);
  for (const [i, l] of lots.entries()) {
    await db.insert(inventoryBatchesTable).values({
      itemId: item.id,
      lotNumber: `${marker}-L${i}`,
      expiryDate: l.expiry,
      qtyReceived: l.qty,
      qtyRemaining: l.qty,
      status: "active",
    });
  }
  return { id: item.id, initial: Number(stock) };
}

/** A test + consumption rule: the automatic-deduction side of every race. */
async function mkAutoRule(item: Item, quantity: string): Promise<number> {
  const [test] = await db
    .insert(testsTable)
    .values({
      code: `${marker}T${testIds.length}`,
      name: `${marker} auto-consumed test`,
      category: "Imaging",
      price: "8000",
      duration: "45",
    })
    .returning();
  testIds.push(test.id);
  const [rule] = await db
    .insert(inventoryConsumptionRulesTable)
    .values({ testId: test.id, itemId: item.id, quantity })
    .returning();
  ruleIds.push(rule.id);
  return test.id;
}

async function mkDemand(item: Item, quantity: string): Promise<number> {
  const [row] = await db
    .insert(inventoryDemandRequestsTable)
    .values({
      itemId: item.id,
      itemName: `${marker} demand`,
      quantity,
      unit: "vial",
      department: "Imaging",
      status: "approved",
      requestedBy: `${marker} requester`,
    })
    .returning();
  demandIds.push(row.id);
  return row.id;
}

/** Lines are inserted in the order given, which is the order the post loop reads them. */
async function mkInvoice(lines: { item: Item; qty: string }[]): Promise<number> {
  const [invoice] = await db
    .insert(purchaseInvoicesTable)
    .values({
      invoiceNumber: `${marker}-INV-${invoiceIds.length}`,
      invoiceDate: "2026-01-05",
      status: "draft",
      subtotal: "0",
      gstAmount: "0",
      totalAmount: "0",
      createdBy: `${marker} clerk`,
    })
    .returning();
  invoiceIds.push(invoice.id);
  for (const l of lines) {
    await db.insert(purchaseInvoiceLineItemsTable).values({
      invoiceId: invoice.id,
      itemId: l.item.id,
      descriptionRaw: `${marker} line`,
      quantity: l.qty,
      unitCost: "10",
      lineTotal: l.qty,
      lotNumber: `${marker}-LOT`,
    });
  }
  return invoice.id;
}

async function stockOf(itemId: number): Promise<number> {
  const [row] = await db
    .select({ s: inventoryItemsTable.currentStock })
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, itemId));
  return Number(row.s);
}

async function lotsState(itemId: number): Promise<{ total: number; rows: { id: number; qty: number; status: string }[] }> {
  const rows = await db
    .select({ id: inventoryBatchesTable.id, qty: inventoryBatchesTable.qtyRemaining, status: inventoryBatchesTable.status })
    .from(inventoryBatchesTable)
    .where(eq(inventoryBatchesTable.itemId, itemId));
  let total = 0;
  for (const r of rows) total += Number(r.qty);
  return { total: r2(total), rows: rows.map((r) => ({ id: r.id, qty: Number(r.qty), status: r.status })) };
}

async function ledger(itemId: number) {
  return db
    .select({
      id: inventoryTransactionsTable.id,
      type: inventoryTransactionsTable.type,
      quantity: inventoryTransactionsTable.quantity,
      stockBefore: inventoryTransactionsTable.stockBefore,
      stockAfter: inventoryTransactionsTable.stockAfter,
      reference: inventoryTransactionsTable.reference,
    })
    .from(inventoryTransactionsTable)
    .where(eq(inventoryTransactionsTable.itemId, itemId))
    .orderBy(inventoryTransactionsTable.id);
}

/**
 * THE DECISIVE ASSERTION. Contiguous ledger chain, books agreeing with the
 * shelf, never negative. Called by every concurrency case below.
 */
async function assertChain(itemId: number, baseline: number): Promise<Awaited<ReturnType<typeof ledger>>> {
  const rows = await ledger(itemId);
  let cursor = r2(baseline);
  for (const r of rows) {
    expect(
      r2(Number(r.stockBefore)),
      `ledger row #${r.id} (${r.type} ${r.quantity} ref=${r.reference}) opens at ${r.stockBefore} ` +
        `but the committed row before it closed at ${cursor} — a movement was lost`,
    ).toBe(cursor);
    cursor = r2(Number(r.stockAfter));
  }
  const stock = r2(await stockOf(itemId));
  expect(stock, "no path may drive current_stock below zero").toBeGreaterThanOrEqual(0);
  expect(cursor, `ledger closes at ${cursor} but current_stock is ${stock}`).toBe(stock);
  return rows;
}

/**
 * Only for fixtures whose seeded lots EQUAL the opening balance: no movement
 * through a locked writer may make the lots and the total disagree. An item
 * that was seeded with loose stock and later received a lot is deliberately not
 * checked this way — that difference is pre-existing business semantics, not a
 * race, and inventing a lot-reconciliation rule for it would be a redesign.
 */
async function assertLotsReconcile(itemId: number): Promise<void> {
  const [item] = await db
    .select({ stock: inventoryItemsTable.currentStock, track: inventoryItemsTable.trackExpiry })
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, itemId));
  if (!item.track) return;
  const { total } = await lotsState(itemId);
  expect(total, `lot quantities sum to ${total} but current_stock is ${item.stock}`).toBe(r2(Number(item.stock)));
}

const ok = (res: Response) => res.status >= 200 && res.status < 300;
const countOk = (res: Response[]) => res.filter(ok).length;

/** Fire `n` calls at once — that simultaneity is the thing under test. */
function burst<T>(n: number, make: (i: number) => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: n }, (_unused, i) => make(i)));
}

const stockIn = (id: number, body: Record<string, unknown>) =>
  request(app).post(`/api/inventory/${id}/stock-in`).set("Authorization", AUTH).send(body);
const stockOut = (id: number, body: Record<string, unknown>) =>
  request(app).post(`/api/inventory/${id}/stock-out`).set("Authorization", AUTH).send(body);
const adjust = (id: number, body: Record<string, unknown>) =>
  request(app).post(`/api/inventory/${id}/adjust`).set("Authorization", AUTH).send(body);
const receiveBatch = (body: Record<string, unknown>) =>
  request(app).post("/api/inventory/batches").set("Authorization", AUTH).send(body);
const consumeFefo = (id: number, body: Record<string, unknown>) =>
  request(app).post(`/api/inventory/items/${id}/consume-fefo`).set("Authorization", AUTH).send(body);
const issueDemand = (id: number) => request(app).post(`/api/inventory/demands/${id}/issue`).set("Authorization", AUTH).send({});
const postInvoice = (id: number) => request(app).post(`/api/purchase-invoices/${id}/post`).set("Authorization", AUTH).send({});

/** An auto-consume line that failed carries `error`; a skipped (idempotent) one carries `skipped`. */
const consumed = (res: ConsumeLineResult[][]) => res.flat().filter((l) => !l.skipped && !l.error).length;

const dbAvailable = hasDatabaseUrl();

/**
 * B-13 found that no file in migrations/ or lib/db/drizzle/ created the two
 * purchase-invoice tables, so a database built by the migration path — every real
 * deployment, CI's test database included — answered every /api/purchase-invoices/*
 * request with 42P01. It reported that defect and worked around it by creating the
 * tables in this harness, which is exactly the thing that hides a missing migration:
 * the suite stayed green while the clinic stayed broken.
 *
 * zzzzzzzzzzzzzzzzzzz_schema_parity_columns_never_migrated.sql now delivers them, so
 * the harness asserts instead of repairing. If that file ever stops working, this
 * suite fails with the reason in its message.
 */
async function assertPurchaseInvoiceTablesExist(): Promise<void> {
  const found = rowsOf(
    await db.execute(sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('purchase_invoices', 'purchase_invoice_line_items')
    `),
  );
  expect(
    found.length,
    "purchase_invoices and purchase_invoice_line_items must arrive through migrations/*.sql, "
      + "not be repaired by this test harness",
  ).toBe(2);
}

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  const withRows = res as { rows?: Array<Record<string, unknown>> };
  if (Array.isArray(withRows.rows)) return withRows.rows;
  return Array.isArray(res) ? (res as Array<Record<string, unknown>>) : [];
}

describe.skipIf(!dbAvailable)("B-13 inventory writers — real Postgres concurrency", () => {
  beforeAll(async () => {
    app = await createTestApp();
    await assertPurchaseInvoiceTablesExist();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `B13 Store ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/inventory"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userIds.push(user.id);
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  }, 120_000);

  afterAll(async () => {
    const drain = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch {
        /* marker-scoped rows may already be gone; cleanup is best-effort */
      }
    };
    if (itemIds.length) {
      await drain(() => db.delete(inventoryTransactionsTable).where(inArray(inventoryTransactionsTable.itemId, itemIds)));
      await drain(() => db.delete(inventoryBatchesTable).where(inArray(inventoryBatchesTable.itemId, itemIds)));
      await drain(() => db.delete(inventoryReorderRequestsTable).where(inArray(inventoryReorderRequestsTable.itemId, itemIds)));
      await drain(() => db.delete(inventoryDemandRequestsTable).where(inArray(inventoryDemandRequestsTable.itemId, itemIds)));
    }
    if (invoiceIds.length) {
      await drain(() => db.delete(purchaseInvoiceLineItemsTable).where(inArray(purchaseInvoiceLineItemsTable.invoiceId, invoiceIds)));
      await drain(() => db.delete(purchaseInvoicesTable).where(inArray(purchaseInvoicesTable.id, invoiceIds)));
    }
    if (ruleIds.length) await drain(() => db.delete(inventoryConsumptionRulesTable).where(inArray(inventoryConsumptionRulesTable.id, ruleIds)));
    if (testIds.length) await drain(() => db.delete(testsTable).where(inArray(testsTable.id, testIds)));
    if (itemIds.length) await drain(() => db.delete(inventoryItemsTable).where(inArray(inventoryItemsTable.id, itemIds)));
    await drain(() => db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)));
    if (userIds.length) await drain(() => db.delete(usersTable).where(inArray(usersTable.id, userIds)));
  }, 180_000);

  // ── POSITIVE CONTROL ───────────────────────────────────────────────────────
  // Not a production path: raw SQL showing what Postgres actually does to two
  // unlocked read-compute-writes on one row. If this did NOT lose an update, the
  // chain assertions below would be measuring nothing.
  it("POSITIVE CONTROL: two unlocked read-modify-writes on current_stock really do lose one", async () => {
    const item = await mkItem({ stock: "50" });
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      // The classic lost update, one statement at a time: both sessions read 50,
      // then each writes the 45 it computed for itself. c2's UPDATE has to wait
      // for c1 to commit — that row lock is real — but waiting is not
      // re-reading, so it overwrites 45 with its own stale 45.
      await c1.query("BEGIN");
      await c2.query("BEGIN");
      const a = await c1.query<{ current_stock: string }>("SELECT current_stock FROM inventory_items WHERE id = $1", [item.id]);
      const b = await c2.query<{ current_stock: string }>("SELECT current_stock FROM inventory_items WHERE id = $1", [item.id]);
      await c1.query("UPDATE inventory_items SET current_stock = $1 WHERE id = $2", [String(Number(a.rows[0].current_stock) - 5), item.id]);
      await c1.query("COMMIT");
      await c2.query("UPDATE inventory_items SET current_stock = $1 WHERE id = $2", [String(Number(b.rows[0].current_stock) - 5), item.id]);
      await c2.query("COMMIT");
    } finally {
      c1.release();
      c2.release();
    }
    // Both read 50, both wrote 45: two transactions each committed a five-unit
    // withdrawal and the shelf moved by five.
    expect(r2(await stockOf(item.id)), "an unlocked read-compute-write must lose an update here, or the cases below prove nothing").toBe(45);
  }, 60_000);

  // ── GROUP 1: manual writers vs the automatic deduction ─────────────────────
  it("B13-01 automatic consumption + manual stock-out", async () => {
    const item = await mkItem({ stock: "50" });
    const testId = await mkAutoRule(item, "1");
    const [auto, manual] = await Promise.all([
      burst(4, (i) => consumeInventoryForTest({ testId, referenceKey: `${marker}-01-${i}`, performedBy: marker })),
      burst(4, (i) => stockOut(item.id, { quantity: 5, reference: `${marker}-01-OUT-${i}` })),
    ]);
    expect(consumed(auto), "a legitimate concurrent deduction must not fail").toBe(4);
    expect(countOk(manual), "a legitimate concurrent withdrawal must not fail").toBe(4);
    expect(r2(await stockOf(item.id)), "50 - 4 auto - 20 manual").toBe(26);
    const rows = await assertChain(item.id, item.initial);
    expect(rows.length).toBe(8);
  }, 60_000);

  it("B13-02 automatic consumption + manual stock-in", async () => {
    const item = await mkItem({ stock: "50" });
    const testId = await mkAutoRule(item, "1");
    const [auto, manual] = await Promise.all([
      burst(4, (i) => consumeInventoryForTest({ testId, referenceKey: `${marker}-02-${i}`, performedBy: marker })),
      burst(4, (i) => stockIn(item.id, { quantity: 10, reference: `${marker}-02-IN-${i}` })),
    ]);
    expect(consumed(auto)).toBe(4);
    expect(countOk(manual)).toBe(4);
    expect(r2(await stockOf(item.id)), "50 - 4 consumed + 40 received").toBe(86);
    const rows = await assertChain(item.id, item.initial);
    expect(rows.length).toBe(8);
  }, 60_000);

  it("B13-03 automatic consumption + adjustment", async () => {
    // `adjust` writes an ABSOLUTE counted quantity, so WHICH target wins is not
    // determined by the test and must not be pinned. The chain is: a lost update
    // here means a real deducted consumable vanished from the balance while
    // staying in the ledger.
    const item = await mkItem({ stock: "50" });
    const testId = await mkAutoRule(item, "1");
    const [auto, manual] = await Promise.all([
      burst(4, (i) => consumeInventoryForTest({ testId, referenceKey: `${marker}-03-${i}`, performedBy: marker })),
      burst(4, (i) => adjust(item.id, { newQuantity: 40 + i, reason: `${marker} physical count` })),
    ]);
    expect(consumed(auto)).toBe(4);
    expect(countOk(manual)).toBe(4);
    const rows = await assertChain(item.id, item.initial);
    expect(rows.length).toBe(8);
    const stock = r2(await stockOf(item.id));
    // The last writer is either a counted target (40..43) or a deduction that
    // followed one; nothing else is a legal balance for this burst.
    expect(stock, `balance ${stock} is not reachable from targets 40-43 and four 1-unit deductions`).toBeGreaterThanOrEqual(36);
    expect(stock).toBeLessThanOrEqual(43);
  }, 60_000);

  // ── GROUP 2: manual writers against each other ─────────────────────────────
  it("B13-04 concurrent manual stock-outs with sufficient combined stock", async () => {
    const item = await mkItem({ stock: "50" });
    const res = await burst(8, (i) => stockOut(item.id, { quantity: 5, reference: `${marker}-04-${i}` }));
    expect(countOk(res), "8 x 5 fits in 50, so all 8 must be accepted").toBe(8);
    expect(r2(await stockOf(item.id))).toBe(10);
    const rows = await assertChain(item.id, item.initial);
    expect(rows.length).toBe(8);
  }, 60_000);

  it("B13-05 concurrent manual stock-outs with insufficient combined stock", async () => {
    const item = await mkItem({ stock: "50" });
    const res = await burst(8, (i) => stockOut(item.id, { quantity: 8, reference: `${marker}-05-${i}` }));
    // 6 x 8 = 48 fits; the 7th sees only 2. The guard must be re-evaluated
    // against the LOCKED balance, so exactly 6 succeed and nothing oversells.
    expect(countOk(res), `oversold: ${countOk(res)} of 8 withdrawals of 8 were accepted against a balance of 50`).toBe(6);
    expect(res.filter((r) => r.status === 400).length).toBe(2);
    expect(r2(await stockOf(item.id))).toBe(2);
    const rows = await assertChain(item.id, item.initial);
    expect(rows.length).toBe(6);
  }, 60_000);

  it("B13-06 stock-in + stock-out", async () => {
    const item = await mkItem({ stock: "50" });
    const [ins, outs] = await Promise.all([
      burst(4, (i) => stockIn(item.id, { quantity: 7, reference: `${marker}-06-IN-${i}` })),
      burst(4, (i) => stockOut(item.id, { quantity: 3, reference: `${marker}-06-OUT-${i}` })),
    ]);
    expect(countOk(ins)).toBe(4);
    expect(countOk(outs)).toBe(4);
    expect(r2(await stockOf(item.id)), "50 + 28 - 12").toBe(66);
    const rows = await assertChain(item.id, item.initial);
    expect(rows.length).toBe(8);
  }, 60_000);

  it("B13-15 no tested path drives current_stock negative", async () => {
    const item = await mkItem({ stock: "3" });
    const res = await burst(8, (i) => stockOut(item.id, { quantity: 2, reference: `${marker}-15-${i}` }));
    expect(countOk(res), "only one 2-unit withdrawal fits in 3").toBe(1);
    const stock = r2(await stockOf(item.id));
    expect(stock).toBeGreaterThanOrEqual(0);
    expect(stock).toBe(1);
    await assertChain(item.id, item.initial);
  }, 60_000);

  it("B13-16 every movement a route accepts writes exactly one ledger row", async () => {
    // `/adjust` is the writer that updates stock and inserts the ledger row as
    // two separate bare statements, so a burst is how a missing row shows up.
    const item = await mkItem({ stock: "20" });
    const pairs = await burst(6, async (i) => {
      const a = await adjust(item.id, { newQuantity: 10 + i, reason: `${marker} physical count` });
      const b = await stockIn(item.id, { quantity: 1, reference: `${marker}-16-${i}` });
      return [a, b] as [Response, Response];
    });
    const calls = pairs.flat();
    const accepted = countOk(calls);
    expect(accepted).toBe(12);
    const rows = await assertChain(item.id, item.initial);
    expect(rows.length, `${accepted} accepted movements but ${rows.length} ledger rows`).toBe(accepted);
  }, 60_000);

  // ── GROUP 3: batches / FEFO ────────────────────────────────────────────────
  it("B13-07 automatic FEFO + manual batch consumption", async () => {
    const item = await mkItem({ lots: [{ qty: "10", expiry: "2029-01-01" }, { qty: "10", expiry: "2030-01-01" }] });
    const testId = await mkAutoRule(item, "2");
    const [auto, manual] = await Promise.all([
      burst(3, (i) => consumeInventoryForTest({ testId, referenceKey: `${marker}-07-A${i}`, performedBy: marker })),
      burst(3, (i) => consumeFefo(item.id, { quantity: 3, reference: `${marker}-07-M${i}` })),
    ]);
    expect(consumed(auto)).toBe(3);
    expect(countOk(manual)).toBe(3);
    expect(r2(await stockOf(item.id)), "20 - 6 auto - 9 manual").toBe(5);
    await assertChain(item.id, item.initial);
    await assertLotsReconcile(item.id);
  }, 60_000);

  it("B13-08 concurrent manual consumers competing for one lot", async () => {
    const item = await mkItem({ lots: [{ qty: "10", expiry: "2029-01-01" }] });
    const res = await burst(4, (i) => consumeFefo(item.id, { quantity: 3, reference: `${marker}-08-${i}` }));
    // 3 x 3 = 9 fits in a 10-unit lot; the 4th must be refused, not half-applied.
    expect(countOk(res), `lot oversold: ${countOk(res)} of 4 withdrawals of 3 were accepted from a 10-unit lot`).toBe(3);
    expect(res.filter((r) => r.status === 409).length).toBe(1);
    const { total } = await lotsState(item.id);
    expect(total, "the lot must show nine units taken, not three competing writes of the same subtraction").toBe(1);
    await assertChain(item.id, item.initial);
    await assertLotsReconcile(item.id);
  }, 60_000);

  it("B13-09 concurrent manual consumers spanning lots", async () => {
    const item = await mkItem({ lots: [{ qty: "6", expiry: "2029-01-01" }, { qty: "6", expiry: "2030-01-01" }] });
    const res = await burst(4, (i) => consumeFefo(item.id, { quantity: 5, reference: `${marker}-09-${i}` }));
    expect(countOk(res), "12 usable, 5 each: exactly two may succeed").toBe(2);
    const rows = await assertChain(item.id, item.initial);
    expect(rows.length).toBe(2);
    const { rows: lots, total } = await lotsState(item.id);
    expect(total).toBe(2);
    // FEFO ORDER is not to be changed by this pass: the earlier lot drains first.
    expect(lots.filter((l) => l.qty === 0).length, "the first-expiry lot must empty before the later one is touched").toBeGreaterThanOrEqual(1);
    await assertLotsReconcile(item.id);
  }, 60_000);

  it("B13-A1 batch receive concurrent with FEFO consumption on the same item", async () => {
    const item = await mkItem({ lots: [{ qty: "20", expiry: "2029-01-01" }] });
    const [cons, recv] = await Promise.all([
      burst(3, (i) => consumeFefo(item.id, { quantity: 2, reference: `${marker}-A1-C${i}` })),
      burst(3, (i) => receiveBatch({ itemId: item.id, lotNumber: `${marker}-A1-R${i}`, quantity: 10, expiryDate: "2031-01-01" })),
    ]);
    expect(countOk(cons)).toBe(3);
    expect(countOk(recv)).toBe(3);
    expect(r2(await stockOf(item.id)), "20 - 6 + 30").toBe(44);
    await assertChain(item.id, item.initial);
    await assertLotsReconcile(item.id);
  }, 60_000);

  // ── GROUP 4: demand issuance ───────────────────────────────────────────────
  it("B13-10 demand issuance deducts once, and races automatic consumption safely", async () => {
    const item = await mkItem({ stock: "50" });
    const testId = await mkAutoRule(item, "1");
    const demandId = await mkDemand(item, "5");
    const [issue, auto] = await Promise.all([
      burst(2, () => issueDemand(demandId)),
      burst(4, (i) => consumeInventoryForTest({ testId, referenceKey: `${marker}-10-${i}`, performedBy: marker })),
    ]);
    expect(countOk(issue), "issuing the same demand twice from one click must deduct once").toBe(1);
    expect(consumed(auto)).toBe(4);
    const rows = await assertChain(item.id, item.initial);
    expect(rows.filter((r) => r.reference === `DEMAND-${demandId}`).length).toBe(1);
    expect(r2(await stockOf(item.id)), "50 - 5 issued - 4 auto").toBe(41);
    const [demand] = await db
      .select({ status: inventoryDemandRequestsTable.status })
      .from(inventoryDemandRequestsTable)
      .where(eq(inventoryDemandRequestsTable.id, demandId));
    expect(demand.status).toBe("issued");
  }, 60_000);

  // ── GROUP 5: purchase invoice post ────────────────────────────────────────
  it("B13-A2 a draft invoice is posted once however many times the button is clicked", async () => {
    const a = await mkItem({ stock: "10" });
    const b = await mkItem({ stock: "10" });
    const invoiceId = await mkInvoice([{ item: a, qty: "5" }, { item: b, qty: "5" }]);
    const res = await burst(3, () => postInvoice(invoiceId));
    expect(countOk(res), "double-posted invoice: the same purchase arrived on the shelf more than once").toBe(1);
    const [inv] = await db
      .select({ status: purchaseInvoicesTable.status })
      .from(purchaseInvoicesTable)
      .where(eq(purchaseInvoicesTable.id, invoiceId));
    expect(inv.status).toBe("posted");
    for (const item of [a, b]) {
      expect(r2(await stockOf(item.id))).toBe(15);
      await assertChain(item.id, item.initial);
    }
  }, 60_000);

  it("B13-17 cross-path deadlock: two multi-item invoices sharing items in opposite line order", async () => {
    const a = await mkItem({ stock: "0" });
    const b = await mkItem({ stock: "0" });
    const inv1 = await mkInvoice([{ item: a, qty: "10" }, { item: b, qty: "10" }]);
    const inv2 = await mkInvoice([{ item: b, qty: "10" }, { item: a, qty: "10" }]);
    const res = await Promise.all([postInvoice(inv1), postInvoice(inv2)]);
    for (const r of res) {
      expect(r.status, `a cross-path lock cycle reached the client: ${JSON.stringify(r.body)}`).not.toBe(500);
      expect(ok(r)).toBe(true);
    }
    expect(r2(await stockOf(a.id))).toBe(20);
    expect(r2(await stockOf(b.id))).toBe(20);
    await assertChain(a.id, a.initial);
    await assertChain(b.id, b.initial);
    // Both invoices carrying the same two reagents in opposite line order
    // committed their full stock-in. If the item locks had been taken in line
    // order instead of ascending itemId, Postgres would have aborted one of them
    // with 40P02 and the assertion above would have failed as a 500.
    expect(res.map((r) => r.body.invoice?.status)).toEqual(["posted", "posted"]);

    // Phase 2 is the inversion the shared lock order exists to prevent: the
    // automatic FEFO deduction and the manual FEFO endpoint contending for the
    // SAME lots and item from two code paths. With lots-before-item on both sides
    // no cycle is reachable. If either side takes the item first, Postgres kills
    // one of them with 40P02, which surfaces as a 500 from the route or a
    // deadlock error string from the library — never as a silent shortage.
    const f = await mkItem({
      lots: [{ qty: "20", expiry: "2029-01-01" }, { qty: "20", expiry: "2030-01-01" }, { qty: "20", expiry: "2031-01-01" }],
    });
    const fTest = await mkAutoRule(f, "2");
    const [autoFefo, manualFefo] = await Promise.all([
      burst(6, (i) => consumeInventoryForTest({ testId: fTest, referenceKey: `${marker}-17b-${i}`, performedBy: marker })),
      burst(6, (i) => consumeFefo(f.id, { quantity: 2, reference: `${marker}-17b-M${i}` })),
    ]);
    const errors = autoFefo.flat().filter((l) => l.error).map((l) => String(l.error));
    expect(errors.filter((e) => /deadlock|could not serialize/i.test(e)), `lock-order inversion reached a client: ${errors.join("; ")}`).toEqual([]);
    const serverErrors = manualFefo.filter((r) => r.status === 500);
    expect(serverErrors.length, `consume-fefo 500ed ${serverErrors.length} times under contention — an aborted lock cycle, not a shortage`).toBe(0);
    // 12 withdrawals of 2 against 60 usable units: all of them must land. A pair
    // lost to a deadlock would halve this number without any 500 reaching us.
    expect(consumed(autoFefo) + countOk(manualFefo)).toBe(12);
    expect(r2(await stockOf(f.id))).toBe(36);
    await assertChain(f.id, f.initial);
    await assertLotsReconcile(f.id);
  }, 60_000);

  it("B13-A3 invoice post concurrent with a manual stock-out on the same item", async () => {
    const item = await mkItem({ stock: "20" });
    const invoiceId = await mkInvoice([{ item, qty: "30" }]);
    const [posted, out] = await Promise.all([postInvoice(invoiceId), stockOut(item.id, { quantity: 5, reference: `${marker}-A3` })]);
    expect(ok(posted)).toBe(true);
    expect(ok(out)).toBe(true);
    expect(r2(await stockOf(item.id)), "20 + 30 - 5").toBe(45);
    await assertChain(item.id, item.initial);
  }, 60_000);

  // ── GROUP 6: rollback, retry, and the B-11 / B-12 boundaries ──────────────
  it("B13-11 a failed consumption releases every inventory lock it took", async () => {
    const item = await mkItem({ stock: "2" });
    const testId = await mkAutoRule(item, "5");
    const failed = await consumeInventoryForTest({ testId, referenceKey: `${marker}-11-fail`, performedBy: marker });
    expect(failed[0].error, "insufficient stock must fail, not silently under-deduct").toContain("INSUFFICIENT_STOCK");
    await assertChain(item.id, item.initial); // the rolled-back attempt wrote nothing

    // If a lock survived the rollback these queue behind a holder that never
    // exists, so this test times out rather than failing an assertion — a
    // detection either way, but a slow one, hence the settle. The functional
    // check is the point: a rolled-back deduction must leave the shelf usable by
    // the very next writer, on both the row lock and the reference advisory lock.
    await new Promise((res) => setTimeout(res, 50));
    const res = await burst(2, (i) => stockOut(item.id, { quantity: 1, reference: `${marker}-11-after-${i}` }));
    expect(countOk(res), "the balance after a rolled-back deduction must be usable again").toBe(2);
    expect(r2(await stockOf(item.id))).toBe(0);
    await assertChain(item.id, item.initial);

    // The advisory half: the failed attempt's reference lock must be gone, so a
    // retry of that same event now books normally instead of waiting forever.
    const retry = await consumeInventoryForTest({ testId, referenceKey: `${marker}-11-fail`, performedBy: marker });
    await stockIn(item.id, { quantity: 10, reference: `${marker}-11-topup` });
    const retryAfterTopUp = await consumeInventoryForTest({ testId, referenceKey: `${marker}-11-fail`, performedBy: marker });
    expect(retry[0].error ?? "leaked", "a rolled-back advisory lock must not outlive its transaction").toContain("INSUFFICIENT_STOCK");
    expect(retryAfterTopUp[0].error ?? null).toBeNull();
  }, 60_000);

  it("B13-12 retry after rollback succeeds exactly once for the same reference", async () => {
    const item = await mkItem({ stock: "1" });
    const testId = await mkAutoRule(item, "2");
    const key = `${marker}-12`;
    const first = await consumeInventoryForTest({ testId, referenceKey: key, performedBy: marker });
    expect(first[0].error).toContain("INSUFFICIENT_STOCK");
    await stockIn(item.id, { quantity: 5, reference: `${marker}-12-restock` });
    const retry = await consumeInventoryForTest({ testId, referenceKey: key, performedBy: marker });
    expect(retry[0].error ?? null, `retry after rollback was refused: ${JSON.stringify(retry)}`).toBeNull();
    const rows = await assertChain(item.id, item.initial);
    expect(rows.filter((r) => r.reference === consumptionReference(key, item.id)).length, "a rolled-back deduction must neither block the retry nor duplicate it").toBe(1);
    expect(r2(await stockOf(item.id))).toBe(4);
  }, 60_000);

  it("B13-13 B-11 same-reference idempotency still holds", async () => {
    const item = await mkItem({ stock: "50" });
    const testId = await mkAutoRule(item, "1");
    const res = await burst(5, () => consumeInventoryForTest({ testId, referenceKey: `${marker}-13`, performedBy: marker }));
    expect(consumed(res)).toBe(1);
    expect(r2(await stockOf(item.id))).toBe(49);
    await assertChain(item.id, item.initial);
  }, 60_000);

  it("B13-14 B-12 distinct-reference correctness still holds", async () => {
    const item = await mkItem({ stock: "50" });
    const testId = await mkAutoRule(item, "1");
    const res = await burst(5, (i) => consumeInventoryForTest({ testId, referenceKey: `${marker}-14-${i}`, performedBy: marker }));
    expect(consumed(res), "five distinct events must take five units").toBe(5);
    expect(r2(await stockOf(item.id))).toBe(45);
    await assertChain(item.id, item.initial);
  }, 60_000);

  it("B13-A4 seven writers on one item at once leave a contiguous ledger", async () => {
    // The mixed burst is the realistic shape of a busy morning at the store
    // counter, and it is the only case that puts every writer on one row.
    const item = await mkItem({ stock: "40" });
    const testId = await mkAutoRule(item, "1");
    const demandId = await mkDemand(item, "3");
    const invoiceId = await mkInvoice([{ item, qty: "10" }]);
    const [auto, outs, ins, fefo, issued, adj, posted] = await Promise.all([
      burst(2, (i) => consumeInventoryForTest({ testId, referenceKey: `${marker}-A4-${i}`, performedBy: marker })),
      burst(2, (i) => stockOut(item.id, { quantity: 2, reference: `${marker}-A4-OUT-${i}` })),
      burst(2, (i) => stockIn(item.id, { quantity: 4, reference: `${marker}-A4-IN-${i}` })),
      // This item has no lots, so manual FEFO must refuse rather than deduct
      // from stock it cannot attribute to a lot. That refusal is asserted below.
      burst(2, (i) => consumeFefo(item.id, { quantity: 1, reference: `${marker}-A4-FEFO-${i}` })),
      issueDemand(demandId),
      burst(2, (i) => adjust(item.id, { newQuantity: 30 + i, reason: `${marker} physical count` })),
      postInvoice(invoiceId),
    ]);
    expect(consumed(auto)).toBe(2);
    expect(countOk(outs)).toBe(2);
    expect(countOk(ins)).toBe(2);
    expect(countOk(fefo)).toBe(0);
    expect(fefo.every((r) => r.status === 409)).toBe(true);
    expect(ok(issued)).toBe(true);
    expect(countOk(adj)).toBe(2);
    expect(ok(posted)).toBe(true);
    const rows = await assertChain(item.id, item.initial);
    // Which of the two counted targets ends up being the balance depends on who
    // committed last, and that is not the invariant. What is fixed is who
    // contributed a row: two auto deductions, two withdrawals and one issue as
    // `out`; two stock-ins and the invoice lot as `in`; two adjustments. The
    // refused FEFO attempts and nothing else may appear.
    expect(rows.filter((r) => r.type === "out").length).toBe(5);
    expect(rows.filter((r) => r.type === "in").length).toBe(3);
    expect(rows.filter((r) => r.type === "adjustment").length).toBe(2);
    expect(rows.length).toBe(10);
    expect(rows.filter((r) => r.reference === `DEMAND-${demandId}`).length).toBe(1);
  }, 60_000);

  it("B13-A5 no ledger row is recorded against a balance it did not produce", async () => {
    // Guards the arithmetic itself under load: every row must satisfy
    // before ± quantity == after for its own type.
    const item = await mkItem({ stock: "100" });
    const testId = await mkAutoRule(item, "3");
    const [auto, ins, outs] = await Promise.all([
      burst(6, (i) => consumeInventoryForTest({ testId, referenceKey: `${marker}-A5-${i}`, performedBy: marker })),
      burst(6, (i) => stockIn(item.id, { quantity: 5, reference: `${marker}-A5-IN-${i}` })),
      burst(6, (i) => stockOut(item.id, { quantity: 2, reference: `${marker}-A5-OUT-${i}` })),
    ]);
    expect(consumed(auto)).toBe(6);
    expect(countOk(ins)).toBe(6);
    expect(countOk(outs)).toBe(6);
    const rows = await assertChain(item.id, item.initial);
    for (const r of rows) {
      const before = Number(r.stockBefore);
      const after = Number(r.stockAfter);
      const qty = Number(r.quantity);
      const delta = r.type === "in" ? qty : r.type === "out" ? -qty : qty;
      expect(r2(before + delta), `row #${r.id} ${r.type}: ${before} ${r.quantity} -> ${after} does not add up`).toBe(r2(after));
    }
    expect(r2(await stockOf(item.id)), "100 - 18 + 30 - 12").toBe(100);
  }, 60_000);

  it("B13-A6 assertChain actually detects a broken chain", async () => {
    // Non-vacuity check on the helper itself: two hand-written rows that do not
    // link must be reported, otherwise every case above is free.
    const item = await mkItem({ stock: "10" });
    await db.insert(inventoryTransactionsTable).values([
      { itemId: item.id, type: "out", quantity: "2", stockBefore: "10", stockAfter: "8", reference: `${marker}-A6-1` },
      { itemId: item.id, type: "out", quantity: "3", stockBefore: "9", stockAfter: "6", reference: `${marker}-A6-2` },
    ]);
    let caught = "";
    try {
      await assertChain(item.id, item.initial);
    } catch (e) {
      caught = e instanceof Error ? e.message : String(e);
    }
    expect(caught, "assertChain accepted a ledger whose rows do not link").toContain("a movement was lost");
  }, 60_000);
});
