/**
 * Real-Postgres concurrency at the inventory consumption boundary.
 *
 * B-11 (this file's first block) proved event IDEMPOTENCY here: one physical
 * event, however many times it is replayed concurrently, books one deduction.
 * That was the double-clicked Verify. It is checked against the actual database
 * because `inventoryConsumption.test.ts` models the advisory lock in memory,
 * and a model can only ever be as right as the idea that wrote it.
 *
 * B-12 (second block) is the other half, which B-11 deliberately did not claim.
 * Serialising one event against itself says nothing about two DIFFERENT events
 * spending the same shelf: `REPORT-41` and `REPORT-42` hash to different
 * advisory keys, so both read `current_stock`, both compute `before - qty`, and
 * the second write silently discards the first. The ledger then books two units
 * while the shelf loses one — a permanently disagreeing pair of numbers, with no
 * row anywhere explaining the difference. CI found this, not anyone reasoning
 * about it: run 37790283653 asserted 50 → 48 for two concurrent distinct
 * references and Postgres answered 49.
 *
 * The invariant these tests hold the code to:
 *
 *   same reference × N concurrent attempts → one deduction
 *   N distinct valid references            → N deductions, and the stock
 *                                            balance falls by their SUM
 *
 * Requires DATABASE_URL — skipped on a machine with no database, executed in CI
 * where the test database is built by the full migration path
 * (`postgres:16-alpine`, `pnpm db:bootstrap`, files run sequentially against the
 * one shared database). The in-memory stand-in is a convenience for iterating;
 * this file is the decisive proof.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import {
  inventoryBatchesTable,
  inventoryConsumptionRulesTable,
  inventoryItemsTable,
  inventoryTransactionsTable,
  testsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";
import { consumeInventoryForTest, consumptionReference } from "./inventoryConsumption";

const marker = `B12-${randomBytes(6).toString("hex")}`;
const log = (s: string) => process.stderr.write(s + "\n");

type BatchSeed = { qty: string; expiry: string };
type Fixture = {
  testId: number;
  itemId: number;
  /** Item stock the fixture was created with — the reconciliation baseline. */
  initialStock: number;
  batchIds: number[];
  code: string;
};

const created: Fixture[] = [];

async function makeFixture(
  over: {
    trackExpiry?: boolean;
    stock?: string;
    qty?: string;
    batchQty?: string;
    /** Multiple lots for the FEFO cases; `stock` should equal their sum. */
    batches?: BatchSeed[];
  } = {},
): Promise<Fixture> {
  const code = `${marker}-${created.length}`;
  const [test] = await db
    .insert(testsTable)
    .values({ code, name: `${code} MRI contrast`, category: "Imaging", price: "8000", duration: "45" })
    .returning();
  const stock = over.stock ?? "50";
  const [item] = await db
    .insert(inventoryItemsTable)
    .values({
      name: `${code} iodinated contrast`,
      unit: "vial",
      category: "reagent",
      currentStock: stock,
      trackExpiry: Boolean(over.trackExpiry || over.batches),
      isActive: true,
    })
    .returning();
  await db.insert(inventoryConsumptionRulesTable).values({
    testId: test.id,
    itemId: item.id,
    quantity: over.qty ?? "1",
  });
  const f: Fixture = {
    testId: test.id,
    itemId: item.id,
    initialStock: Number(stock),
    batchIds: [],
    code,
  };
  const seeds: BatchSeed[] = over.batches ?? (over.trackExpiry ? [{ qty: over.batchQty ?? "50", expiry: "2030-01-01" }] : []);
  for (const s of seeds) {
    const [batch] = await db
      .insert(inventoryBatchesTable)
      .values({
        itemId: item.id,
        lotNumber: `${code}-L${f.batchIds.length + 1}`,
        expiryDate: s.expiry,
        qtyReceived: s.qty,
        qtyRemaining: s.qty,
        status: "active",
      })
      .returning();
    f.batchIds.push(batch.id);
  }
  created.push(f);
  return f;
}

/** A second consumables rule on the same test, so one event spends two items. */
async function addRule(f: Fixture, itemId: number, quantity: string): Promise<void> {
  await db.insert(inventoryConsumptionRulesTable).values({ testId: f.testId, itemId, quantity });
}

async function anotherItem(codeSuffix: string, stock = "20"): Promise<number> {
  const [item] = await db
    .insert(inventoryItemsTable)
    .values({
      name: `${marker}-${codeSuffix} syringe`,
      unit: "pcs",
      category: "consumable",
      currentStock: stock,
      trackExpiry: false,
      isActive: true,
    })
    .returning();
  extraItemIds.push(item.id);
  return item.id;
}
const extraItemIds: number[] = [];

async function ledgerRows(reference: string) {
  return db
    .select({ id: inventoryTransactionsTable.id, quantity: inventoryTransactionsTable.quantity })
    .from(inventoryTransactionsTable)
    .where(eq(inventoryTransactionsTable.reference, reference));
}

async function outRows(itemId: number) {
  return db
    .select({
      id: inventoryTransactionsTable.id,
      reference: inventoryTransactionsTable.reference,
      quantity: inventoryTransactionsTable.quantity,
    })
    .from(inventoryTransactionsTable)
    .where(and(eq(inventoryTransactionsTable.itemId, itemId), eq(inventoryTransactionsTable.type, "out")));
}

async function stockOf(itemId: number): Promise<number> {
  const [row] = await db
    .select({ currentStock: inventoryItemsTable.currentStock })
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, itemId));
  return Number(row.currentStock);
}

async function batchRemaining(batchId: number): Promise<number> {
  const [row] = await db
    .select({ qtyRemaining: inventoryBatchesTable.qtyRemaining, status: inventoryBatchesTable.status })
    .from(inventoryBatchesTable)
    .where(eq(inventoryBatchesTable.id, batchId));
  return Number(row.qtyRemaining);
}

async function batchState(batchId: number): Promise<{ qty: number; status: string }> {
  const [row] = await db
    .select({ qtyRemaining: inventoryBatchesTable.qtyRemaining, status: inventoryBatchesTable.status })
    .from(inventoryBatchesTable)
    .where(eq(inventoryBatchesTable.id, batchId));
  return { qty: Number(row.qtyRemaining), status: String(row.status) };
}

/**
 * THE DECISIVE ASSERTION, factored out so every concurrency case has to make
 * it: the units the ledger booked must equal the units the authoritative balance
 * actually lost, and the balance must never go below zero. Two sessions that
 * each spend the same shelf produce a ledger of 2 and a balance of 1 — this
 * catches exactly that, whichever of the two numbers drifted.
 */
async function assertLedgerAgreesWithBalance(f: Fixture, expectRows: number): Promise<number> {
  const rows = await outRows(f.itemId);
  const booked = rows.reduce((s, r) => s + Number(r.quantity), 0);
  const stock = await stockOf(f.itemId);
  const moved = Math.round((f.initialStock - stock) * 100) / 100;
  expect(rows.length, "one ledger row per committed deduction").toBe(expectRows);
  expect(stock, "stock must never be driven below zero by concurrent spending").toBeGreaterThanOrEqual(0);
  expect(moved, `ledger booked ${booked} but the balance moved ${moved}`).toBe(booked);
  return booked;
}

async function cleanup() {
  const itemIds = [...created.map((f) => f.itemId), ...extraItemIds];
  const testIds = created.map((f) => f.testId);
  if (itemIds.length) {
    await db
      .delete(inventoryTransactionsTable)
      .where(inArray(inventoryTransactionsTable.itemId, itemIds))
      .catch(() => undefined);
    await db.delete(inventoryBatchesTable).where(inArray(inventoryBatchesTable.itemId, itemIds)).catch(() => undefined);
    await db.delete(inventoryItemsTable).where(inArray(inventoryItemsTable.id, itemIds)).catch(() => undefined);
  }
  if (testIds.length) {
    await db
      .delete(inventoryConsumptionRulesTable)
      .where(inArray(inventoryConsumptionRulesTable.testId, testIds))
      .catch(() => undefined);
    await db.delete(testsTable).where(inArray(testsTable.id, testIds)).catch(() => undefined);
  }
  created.length = 0;
  extraItemIds.length = 0;
}

describe.skipIf(!hasDatabaseUrl())(
  "B11-R — one event, however replayed, deducts once (real Postgres)",
  () => {
    afterAll(cleanup);

    it("POSITIVE CONTROL: the harness can see a real double-book if the dedupe is bypassed", async () => {
      // Not a mutation of production code — a demonstration that this file
      // would report a failure if it could. Two inserts of the same reference
      // written directly (no lock, no check) must produce two rows, because
      // `inventory_transactions.reference` carries NO unique index. That is
      // precisely why the guard cannot be replaced by a hope.
      const f = await makeFixture();
      const reference = `CONSUME-${marker}-direct-ITEM-${f.itemId}`;
      await Promise.all([
        db.insert(inventoryTransactionsTable).values({
          itemId: f.itemId,
          type: "out",
          quantity: "1",
          stockBefore: "50",
          stockAfter: "49",
          reason: "control",
          reference,
          performedBy: marker,
        }),
        db.insert(inventoryTransactionsTable).values({
          itemId: f.itemId,
          type: "out",
          quantity: "1",
          stockBefore: "50",
          stockAfter: "49",
          reason: "control",
          reference,
          performedBy: marker,
        }),
      ]);
      const rows = await ledgerRows(reference);
      log(`  [control] direct concurrent inserts of one reference -> ${rows.length} rows`);
      expect(rows.length).toBe(2);
      await db.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.reference, reference));
    });

    it("two concurrent consumptions of one reference deduct exactly once", async () => {
      const f = await makeFixture();
      const referenceKey = `REPORT-${marker}`;
      const [a, b] = await Promise.all([
        consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "A" }),
        consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "B" }),
      ]);
      const reference = consumptionReference(referenceKey, f.itemId);
      const rows = await ledgerRows(reference);
      expect(rows.length, "one physical event must produce one ledger row").toBe(1);
      expect(await stockOf(f.itemId)).toBe(49);
      expect([a, b].filter((r) => r[0]?.skipped)).toHaveLength(1);
      await assertLedgerAgreesWithBalance(f, 1);
    });

    it("three concurrent consumptions of one reference also deduct once", async () => {
      const f = await makeFixture();
      const referenceKey = `STUDY-${marker}-FINAL`;
      const out = await Promise.all([
        consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "A" }),
        consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "B" }),
        consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "C" }),
      ]);
      const rows = await ledgerRows(consumptionReference(referenceKey, f.itemId));
      expect(rows.length).toBe(1);
      expect(await stockOf(f.itemId)).toBe(49);
      expect(out.filter((r) => r[0]?.skipped)).toHaveLength(2);
      await assertLedgerAgreesWithBalance(f, 1);
    });

    it("a retry after a completed consumption is a no-op (sequential replay)", async () => {
      const f = await makeFixture();
      const referenceKey = `REPORT-${marker}`;
      const first = await consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "A" });
      const retry = await consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "A" });
      expect(first[0].skipped).toBeFalsy();
      expect(retry[0].skipped).toBe(true);
      expect(await stockOf(f.itemId)).toBe(49);
      await assertLedgerAgreesWithBalance(f, 1);
    });

    it("distinct references for distinct events are NOT collapsed by the lock", async () => {
      // The mirror-image defect: a serialisation device that also deduplicated
      // across events would silently stop consuming. Two reports' verifies for
      // the same item must both deduct.
      const f = await makeFixture();
      await consumeInventoryForTest({ testId: f.testId, referenceKey: `REPORT-1-${marker}`, performedBy: "A" });
      await consumeInventoryForTest({ testId: f.testId, referenceKey: `REPORT-2-${marker}`, performedBy: "A" });
      expect((await outRows(f.itemId)).length).toBe(2);
      expect(await stockOf(f.itemId)).toBe(48);
      await assertLedgerAgreesWithBalance(f, 2);
    });

    it("the FEFO branch is serialised the same way (batch decremented once)", async () => {
      const f = await makeFixture({ trackExpiry: true, stock: "40", batchQty: "40" });
      const referenceKey = `REPORT-${marker}`;
      await Promise.all([
        consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "A" }),
        consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "B" }),
      ]);
      const rows = await ledgerRows(consumptionReference(referenceKey, f.itemId));
      expect(rows.length).toBe(1);
      expect(await stockOf(f.itemId)).toBe(39);
      expect(await batchRemaining(f.batchIds[0])).toBe(39);
      await assertLedgerAgreesWithBalance(f, 1);
    });

    it("an insufficient-stock line is reported, not swallowed, and stock is untouched", async () => {
      const f = await makeFixture({ stock: "0" });
      const lines = await consumeInventoryForTest({
        testId: f.testId,
        referenceKey: `REPORT-${marker}`,
        performedBy: "A",
      });
      expect(lines).toHaveLength(1);
      expect(lines[0].error, "the caller must learn the line failed").toBeTruthy();
      expect(await stockOf(f.itemId)).toBe(0);
      expect((await ledgerRows(consumptionReference(`REPORT-${marker}`, f.itemId))).length).toBe(0);
    });

    it("nothing is consumed for a test with no rules (unrelated report actions stay unrelated)", async () => {
      const [test] = await db
        .insert(testsTable)
        .values({
          code: `${marker}-norules`,
          name: `${marker} unconfigured test`,
          category: "Imaging",
          price: "100",
          duration: "10",
        })
        .returning();
      created.push({ testId: test.id, itemId: 0, initialStock: 0, batchIds: [], code: `${marker}-norules` });
      const lines = await consumeInventoryForTest({
        testId: test.id,
        referenceKey: `REPORT-${marker}-empty`,
        performedBy: "A",
      });
      expect(lines).toEqual([]);
    });
  },
);

describe.skipIf(!hasDatabaseUrl())(
  "B12-R — the ledger and the authoritative balance agree under real concurrency",
  () => {
    afterAll(cleanup);

    it("B12-01 two concurrent distinct references on one item take both units off the shelf", async () => {
      // THE reproduction. B-11's advisory lock is keyed on the reference, so
      // these two transactions never wait for each other; before B-12 both read
      // current_stock = 50 and both wrote 49, booking 2 units and moving 1.
      // This is the case CI caught on run 37790283653 (`expected 49 to be 48`).
      const f = await makeFixture({ stock: "50" });
      const results = await Promise.all([
        consumeInventoryForTest({ testId: f.testId, referenceKey: `REPORT-A-${marker}`, performedBy: "A" }),
        consumeInventoryForTest({ testId: f.testId, referenceKey: `REPORT-B-${marker}`, performedBy: "B" }),
      ]);
      expect(results.flatMap((r) => r.map((l) => l.error).filter(Boolean)), "neither event may fail").toEqual([]);
      expect(await stockOf(f.itemId)).toBe(48);
      await assertLedgerAgreesWithBalance(f, 2);
    });

    it("B12-02 the same reference under concurrency still deducts once (B-11 guard)", async () => {
      // Cross-reference serialisation must not become cross-event deduplication:
      // locking the item row cannot be allowed to swallow a replay of one event.
      const f = await makeFixture({ stock: "50" });
      const referenceKey = `REPORT-${marker}`;
      await Promise.all([
        consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "A" }),
        consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "B" }),
        consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "C" }),
      ]);
      expect(await ledgerRows(consumptionReference(referenceKey, f.itemId))).toHaveLength(1);
      expect(await stockOf(f.itemId)).toBe(49);
      await assertLedgerAgreesWithBalance(f, 1);
    });

    it("B12-03 five concurrent distinct references leave the exact summed balance", async () => {
      const f = await makeFixture({ stock: "50", qty: "2" });
      const keys = [1, 2, 3, 4, 5].map((i) => `REPORT-${i}-${marker}`);
      const results = await Promise.all(
        keys.map((referenceKey, i) => consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: `P${i}` })),
      );
      expect(results.flatMap((r) => r.map((l) => l.error).filter(Boolean)), "no line may fail").toEqual([]);
      // 5 events × 2 units: the balance must be 40, not anything a lost update
      // can produce (48 / 46 / 44 would each mean a silent overwrite).
      expect(await stockOf(f.itemId)).toBe(40);
      await assertLedgerAgreesWithBalance(f, 5);
    });

    it("B12-04 one available unit cannot be spent twice by two different events", async () => {
      const f = await makeFixture({ stock: "1" });
      const results = await Promise.all([
        consumeInventoryForTest({ testId: f.testId, referenceKey: `REPORT-X-${marker}`, performedBy: "A" }),
        consumeInventoryForTest({ testId: f.testId, referenceKey: `REPORT-Y-${marker}`, performedBy: "B" }),
      ]);
      const stock = await stockOf(f.itemId);
      expect(stock, "the shelf held one unit").toBe(0);
      const booked = await assertLedgerAgreesWithBalance(f, 1);
      expect(booked).toBe(1);
      // Exactly one of the two events was honoured; the other must surface as a
      // failure the caller can see, never as a silent second row.
      const errors = results.flatMap((r) => r.map((l) => l.error).filter(Boolean));
      expect(errors).toHaveLength(1);
      expect(String(errors[0])).toContain("INSUFFICIENT_STOCK");
    });

    it("B12-05 a line that fails inside the transaction leaves no stock write and no ledger row", async () => {
      // INSUFFICIENT_STOCK is thrown inside the transaction, AFTER the advisory
      // lock has been taken, so this is the rollback proof: the UPDATE and the
      // INSERT are one unit of work or neither is.
      const f = await makeFixture({ stock: "0" });
      const referenceKey = `REPORT-${marker}`;
      const lines = await consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "A" });
      expect(lines[0].error).toBeTruthy();
      expect(await stockOf(f.itemId)).toBe(0);
      expect(await outRows(f.itemId)).toHaveLength(0);

      // FEFO: the shortfall is detected from the lots, so the item must keep its
      // stock AND its batches must keep their quantity.
      const g = await makeFixture({ batches: [{ qty: "2", expiry: "2030-01-01" }], stock: "2", qty: "5" });
      const gLines = await consumeInventoryForTest({ testId: g.testId, referenceKey: `REPORT-${marker}-fefo`, performedBy: "A" });
      expect(String(gLines[0].error)).toContain("INSUFFICIENT_USABLE_STOCK");
      expect(await stockOf(g.itemId)).toBe(2);
      expect(await batchRemaining(g.batchIds[0])).toBe(2);
      expect(await outRows(g.itemId)).toHaveLength(0);
    });

    it("B12-06 a rolled-back line releases its locks and a later retry of that event succeeds", async () => {
      const f = await makeFixture({ stock: "0" });
      const referenceKey = `REPORT-${marker}`;
      const reference = consumptionReference(referenceKey, f.itemId);
      const failed = await consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "A" });
      expect(failed[0].error).toBeTruthy();

      // The lock this file's whole design rests on is TRANSACTION scoped: a
      // rolled-back consumption must not leave the reference locked for the next
      // session, or a shortage in October would silently disable November's
      // deduction. `pg_try_advisory_xact_lock` answers false only if someone
      // still holds that key.
      const probe = (await db.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${reference})) AS acquired`,
      )) as unknown as { rows: Array<{ acquired: boolean | string }> };
      const acquired = probe.rows?.[0]?.acquired;
      expect(String(acquired), "a failed transaction must not keep the reference locked").toBe("true");

      // Restock, then replay the SAME event: it must deduct now, exactly once.
      await db
        .update(inventoryItemsTable)
        .set({ currentStock: "5" })
        .where(eq(inventoryItemsTable.id, f.itemId));
      f.initialStock = 5;
      const retry = await consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "A" });
      expect(retry[0].skipped, "a previously failed event is not marked as already consumed").toBeFalsy();
      expect(await stockOf(f.itemId)).toBe(4);
      await assertLedgerAgreesWithBalance(f, 1);

      // ...and a second replay of the now-successful event is still a no-op.
      const again = await consumeInventoryForTest({ testId: f.testId, referenceKey, performedBy: "A" });
      expect(again[0].skipped).toBe(true);
      expect(await stockOf(f.itemId)).toBe(4);
    });

    it("B12-07 concurrent FEFO consumers cannot allocate one lot's quantity twice", async () => {
      // One lot of 2, two different events taking 1 each. Before B-12 both read
      // qty_remaining = 2 and both wrote 1: the lot reported 1 unit left after
      // 2 units were issued, and the item's balance moved by 1 for a ledger of 2.
      const f = await makeFixture({ batches: [{ qty: "2", expiry: "2030-01-01" }], stock: "10" });
      const results = await Promise.all([
        consumeInventoryForTest({ testId: f.testId, referenceKey: `REPORT-P-${marker}`, performedBy: "A" }),
        consumeInventoryForTest({ testId: f.testId, referenceKey: `REPORT-Q-${marker}`, performedBy: "B" }),
      ]);
      expect(results.flatMap((r) => r.map((l) => l.error).filter(Boolean)), "both events fit in the lot").toEqual([]);
      const lot = await batchState(f.batchIds[0]);
      expect(lot.qty, "2 units were issued from a lot of 2 — nothing may remain").toBe(0);
      expect(lot.status).toBe("depleted");
      expect(await stockOf(f.itemId)).toBe(8);
      await assertLedgerAgreesWithBalance(f, 2);
    });

    it("B12-07b two events that fit in two different lots are both honoured, and neither lot is spent twice", async () => {
      // The other half of the FEFO question: the lots must not collide either.
      // Lot A (earliest expiry) holds exactly one event's dose and lot B holds
      // exactly the other's, so the only correct outcome is two deductions and
      // both lots empty. Without the lot lock both events allocated from A,
      // wrote its zero twice, left B's four units untouched, and moved the
      // balance by four of the eight units the ledger booked.
      const f = await makeFixture({
        batches: [
          { qty: "4", expiry: "2029-01-01" },
          { qty: "4", expiry: "2030-01-01" },
        ],
        stock: "8",
        qty: "4",
      });
      const results = await Promise.all([
        consumeInventoryForTest({ testId: f.testId, referenceKey: `REPORT-L-${marker}`, performedBy: "A" }),
        consumeInventoryForTest({ testId: f.testId, referenceKey: `REPORT-M-${marker}`, performedBy: "B" }),
      ]);
      expect(results.flatMap((r) => r.map((l) => l.error).filter(Boolean)), "each event fits a whole lot").toEqual([]);
      expect((await batchState(f.batchIds[0])).qty, "first-expiry lot issued its whole quantity once").toBe(0);
      expect((await batchState(f.batchIds[1])).qty, "the second lot issued its whole quantity once").toBe(0);
      expect(await stockOf(f.itemId)).toBe(0);
      await assertLedgerAgreesWithBalance(f, 2);
    });

    it("B12-08 FEFO lots stay internally consistent with the item balance across a concurrent sweep", async () => {
      // Earliest-expiry-first across two lots (3 + 5 = 8, and the item balance
      // starts equal to that sum). Three events want 4 each = 12 against 8
      // available: exactly two may be honoured, the lots must never go negative,
      // and the item balance must fall by precisely what was booked.
      const f = await makeFixture({
        batches: [
          { qty: "3", expiry: "2029-01-01" },
          { qty: "5", expiry: "2030-01-01" },
        ],
        stock: "8",
        qty: "4",
      });
      const results = await Promise.all(
        [1, 2, 3].map((i) =>
          consumeInventoryForTest({ testId: f.testId, referenceKey: `REPORT-${i}-${marker}`, performedBy: `P${i}` }),
        ),
      );
      const errors = results.flatMap((r) => r.map((l) => l.error).filter(Boolean));
      expect(errors, "the third event must fail visibly, not spend stock twice").toHaveLength(1);
      expect(String(errors[0])).toContain("INSUFFICIENT_USABLE_STOCK");

      const first = await batchState(f.batchIds[0]);
      const second = await batchState(f.batchIds[1]);
      expect(first.qty).toBeGreaterThanOrEqual(0);
      expect(second.qty).toBeGreaterThanOrEqual(0);
      // 8 available, 4-unit events, two honoured: both lots are drained.
      expect(first.qty + second.qty, "no lot quantity may survive what the ledger spent").toBe(0);
      expect(await stockOf(f.itemId)).toBe(0);
      await assertLedgerAgreesWithBalance(f, 2);
      // The existing model: the item balance is authoritative and should
      // reconcile to the usable lots. Both started consistent; they must end it.
      const remainingLots = (await batchState(f.batchIds[0])).qty + (await batchState(f.batchIds[1])).qty;
      expect(remainingLots, "sum(lot qty_remaining) must track current_stock").toBe(await stockOf(f.itemId));
    });

    it("B12-09 the reference keys written to the ledger keep their historical shapes", async () => {
      // Every CONSUME-REPORT-* / CONSUME-STUDY-*-FINAL / CONSUME-SAMPLE-* row in
      // the clinic's history was written by consumptionReference(). If a
      // concurrency fix changed the key — including converting a STUDY key into a
      // REPORT key — every past event would silently reopen for a second
      // deduction, and the existing rows would stop matching anything.
      expect(consumptionReference("REPORT-41", 5)).toBe("CONSUME-REPORT-41-ITEM-5");
      expect(consumptionReference("STUDY-12-FINAL", 5)).toBe("CONSUME-STUDY-12-FINAL-ITEM-5");
      expect(consumptionReference("SAMPLE-3-OT-9", 5)).toBe("CONSUME-SAMPLE-3-OT-9-ITEM-5");

      const f = await makeFixture({ stock: "30" });
      await consumeInventoryForTest({ testId: f.testId, referenceKey: `STUDY-77-FINAL`, performedBy: "A" });
      await consumeInventoryForTest({ testId: f.testId, referenceKey: `REPORT-77`, performedBy: "B" });
      const refs = (await outRows(f.itemId)).map((r) => String(r.reference)).sort();
      expect(refs).toEqual([
        `CONSUME-REPORT-77-ITEM-${f.itemId}`,
        `CONSUME-STUDY-77-FINAL-ITEM-${f.itemId}`,
      ]);
      expect(await stockOf(f.itemId)).toBe(28);
      await assertLedgerAgreesWithBalance(f, 2);
    });

    it("B12-10 one event spending two items concurrently with another event deadlocks in neither", async () => {
      // Two rules on one test, two items. Lock order is documented as
      // reference → lots → item, and each rule runs in its own transaction, so
      // no transaction ever holds two item locks. A Postgres deadlock would
      // abort one side and surface here as a line error (SQLSTATE 40P01) — a
      // missing deduction that nobody would otherwise ever see.
      const a = await makeFixture({ stock: "20", qty: "1" });
      const secondItem = await anotherItem("second", "20");
      await addRule(a, secondItem, "3");

      const results = await Promise.all([
        consumeInventoryForTest({ testId: a.testId, referenceKey: `REPORT-1-${marker}`, performedBy: "A" }),
        consumeInventoryForTest({ testId: a.testId, referenceKey: `REPORT-2-${marker}`, performedBy: "B" }),
        consumeInventoryForTest({ testId: a.testId, referenceKey: `REPORT-3-${marker}`, performedBy: "C" }),
      ]);
      const errors = results.flatMap((r) => r.map((l) => l.error).filter(Boolean));
      expect(errors, "concurrent multi-rule events must not deadlock or fail").toEqual([]);
      // Three events × two rules: every call must report both of its lines.
      expect(results.map((r) => r.length)).toEqual([2, 2, 2]);

      for (const itemId of [a.itemId, secondItem]) {
        const rows = await outRows(itemId);
        const booked = rows.reduce((s, r) => s + Number(r.quantity), 0);
        expect(20 - (await stockOf(itemId)), `item ${itemId}: ledger booked ${booked} units`).toBe(booked);
      }
      expect((await outRows(a.itemId)).length).toBe(3);
      expect((await outRows(secondItem)).length).toBe(3);
    });
  },
);

