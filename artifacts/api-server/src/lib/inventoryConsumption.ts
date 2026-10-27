/**
 * Auto-deduct inventory from consumption rules (test → items).
 *
 * Two separate races live here and they need two separate mechanisms.
 *
 * 1. ONE EVENT REPLAYED (B-11). The dedupe below is a read-then-insert on
 *    `inventory_transactions.reference`, a column that can never carry a unique
 *    index because the manual stock-in/stock-out routes let staff type any text
 *    into it. A transaction-scoped `pg_advisory_xact_lock(hashtext(reference))`
 *    is taken before the check, so a double-clicked Verify, a client retry, or
 *    two staff on one report book the deduction once.
 *
 * 2. TWO DIFFERENT EVENTS SPENDING ONE SHELF (B-12). Different references hash
 *    apart, so mechanism (1) never makes `REPORT-41` wait for `REPORT-42`. Both
 *    read `current_stock`, both write `before - qty`, and the second write
 *    silently discards the first: two units booked in the ledger, one unit off
 *    the shelf, permanently. The authoritative balance is therefore read under
 *    `FOR UPDATE` — the read that produces `before` IS the locked read, because
 *    a lock acquired after the value is already in hand would serialise the
 *    writer without serialising the number it writes.
 *
 * Lock order in every path here is: advisory(reference) → lots → item. Lots are
 * locked before the item because that is the order the writes already left this
 * function in, and the order the other batch-touching writer in the repository
 * uses (`routes/inventoryBatches.ts` updates lots at :160, then the item at
 * :166), so adding row locks introduces no inversion that could deadlock. Each
 * consumption rule runs in its own transaction, so no transaction ever holds two
 * item locks. A Postgres-detected deadlock would abort one line and surface as
 * `error` on that line — never as a silently missing deduction.
 *
 * A failed line is logged with its reference (see logger.warn below). The hooks
 * still swallow the outcome, deliberately: short stock is a purchasing
 * problem, not a reason to refuse a clinician their own report.
 */
import { db } from "@workspace/db";
import {
  inventoryBatchesTable,
  inventoryConsumptionRulesTable,
  inventoryItemsTable,
  inventoryTransactionsTable,
} from "@workspace/db/schema";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { fefoAllocate, type BatchLite } from "./inventoryReagentLogic";
import { maybeSendLowStockAlerts } from "./inventoryLowStockAlerts";
import { logger } from "./logger";

const n = (v: unknown): number => (v == null ? 0 : Number(v));
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ConsumeForTestInput = {
  testId: number;
  referenceKey: string;
  performedBy: string;
  reason?: string;
};

/**
 * An auto-consumption failure is a stock problem, not a clinical one: it must
 * never make a Verify or a Finalize fail, and it must never be retried by the
 * UI in a way that could deduct twice. So the hooks swallow.
 */
function voidPromise(p: Promise<unknown>): Promise<void> {
  return p
    .then(() => undefined)
    .catch((err) => {
      console.warn("[inventory] auto-consume threw:", err);
    });
}

export type ConsumeLineResult = {
  itemId: number;
  itemName: string;
  quantity: number;
  skipped?: boolean;
  error?: string;
};

async function referenceExists(tx: DbTx, reference: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: inventoryTransactionsTable.id })
    .from(inventoryTransactionsTable)
    .where(eq(inventoryTransactionsTable.reference, reference))
    .limit(1);
  return !!row;
}

/**
 * The ledger key that makes an auto-consumption idempotent: one line per
 * (event, item). Exported so the shape is pinned by test — every historical
 * `CONSUME-REPORT-*` / `CONSUME-STUDY-*-FINAL` / `CONSUME-SAMPLE-*` row was
 * written through this function, so changing it silently re-opens every past
 * event for a second deduction.
 */
export function consumptionReference(referenceKey: string, itemId: number): string {
  return `CONSUME-${referenceKey}-ITEM-${itemId}`;
}

async function consumeSimpleTx(
  tx: DbTx,
  itemId: number,
  quantity: number,
  reference: string,
  performedBy: string,
  reason: string,
): Promise<void> {
  // FOR UPDATE on the same statement that reads the balance. A second event on
  // this item waits here until this transaction commits, then re-reads and sees
  // the deducted figure, so `before - quantity` is computed from a balance no
  // one else is touching. This is what makes the ledger and `current_stock`
  // agree; the advisory lock above only ever made one event agree with itself.
  const [item] = await tx
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, itemId))
    .for("update")
    .limit(1);
  if (!item) throw new Error("ITEM_NOT_FOUND");
  const before = n(item.currentStock);
  if (before < quantity) throw new Error("INSUFFICIENT_STOCK");
  const after = Math.round((before - quantity) * 100) / 100;
  await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, itemId));
  await tx.insert(inventoryTransactionsTable).values({
    itemId,
    type: "out",
    quantity: String(quantity),
    stockBefore: String(before),
    stockAfter: String(after),
    reason,
    reference,
    performedBy,
  });
}

async function consumeFefoTx(
  tx: DbTx,
  itemId: number,
  quantity: number,
  reference: string,
  performedBy: string,
  reason: string,
): Promise<void> {
  // Lots before the item, in the order they are consumed in. `fefoAllocate`
  // takes earliest expiry first with an id tiebreak, so the ORDER BY here is not
  // cosmetic: two concurrent FEFO events queue on the same lots in the same
  // order, which is what keeps a row lock from becoming a deadlock. Waiting
  // transactions re-read the committed `qty_remaining`, so a lot that the first
  // event just depleted drops out of the second one's candidate set instead of
  // being spent twice.
  const batches = await tx
    .select()
    .from(inventoryBatchesTable)
    .where(and(
      eq(inventoryBatchesTable.itemId, itemId),
      eq(inventoryBatchesTable.status, "active"),
      gt(inventoryBatchesTable.qtyRemaining, "0"),
    ))
    .orderBy(asc(inventoryBatchesTable.expiryDate), asc(inventoryBatchesTable.id))
    .for("update");
  const [item] = await tx
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, itemId))
    .for("update")
    .limit(1);
  if (!item) throw new Error("ITEM_NOT_FOUND");
  const lite: BatchLite[] = batches.map((b) => ({
    id: b.id,
    expiryDate: b.expiryDate,
    qtyRemaining: n(b.qtyRemaining),
    status: b.status,
  }));
  const plan = fefoAllocate(lite, quantity);
  if (plan.shortfall > 0) throw new Error("INSUFFICIENT_USABLE_STOCK");

  for (const a of plan.allocations) {
    const b = batches.find((x) => x.id === a.batchId)!;
    const rem = Math.round((n(b.qtyRemaining) - a.qty) * 100) / 100;
    await tx.update(inventoryBatchesTable)
      .set({ qtyRemaining: String(rem), status: rem <= 0 ? "depleted" : "active" })
      .where(eq(inventoryBatchesTable.id, a.batchId));
  }
  const before = n(item.currentStock);
  const after = Math.round((before - quantity) * 100) / 100;
  await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, itemId));
  await tx.insert(inventoryTransactionsTable).values({
    itemId,
    type: "out",
    quantity: String(quantity),
    stockBefore: String(before),
    stockAfter: String(after),
    reason,
    reference,
    performedBy,
  });
}

/** Deduct consumables for a completed test. Safe to call multiple times (idempotent). */
export async function consumeInventoryForTest(
  input: ConsumeForTestInput,
  source = "direct",
): Promise<ConsumeLineResult[]> {
  const rules = await db
    .select({
      itemId: inventoryConsumptionRulesTable.itemId,
      quantity: inventoryConsumptionRulesTable.quantity,
      itemName: inventoryItemsTable.name,
      trackExpiry: inventoryItemsTable.trackExpiry,
      isActive: inventoryItemsTable.isActive,
    })
    .from(inventoryConsumptionRulesTable)
    .innerJoin(inventoryItemsTable, eq(inventoryConsumptionRulesTable.itemId, inventoryItemsTable.id))
    .where(eq(inventoryConsumptionRulesTable.testId, input.testId));

  if (rules.length === 0) return [];

  const results: ConsumeLineResult[] = [];
  let anyConsumed = false;

  for (const rule of rules) {
    const qty = n(rule.quantity);
    if (!rule.isActive || qty <= 0) {
      results.push({ itemId: rule.itemId, itemName: rule.itemName, quantity: qty, skipped: true });
      continue;
    }
    const reference = consumptionReference(input.referenceKey, rule.itemId);
    try {
      let consumed = false;
      await db.transaction(async (tx) => {
        // Two races, two mechanisms, one acquisition order.
        //
        // (a) ONE EVENT REPLAYED. The dedupe below is a read-then-insert, and
        // `reference` has no unique index (nor can it have one: the manual
        // stock-in/stock-out routes let staff type any reference into the same
        // column). Under READ COMMITTED two sessions for one reference both read
        // "no row" and both deduct — a double-clicked Verify, a client retry
        // after a timeout, two staff on the report at once, and the
        // legacy-verify vs structured-countersign pair all reach here together.
        // The advisory lock on the reference serialises them: the second waiter
        // resumes only after the first commits, then sees the row and skips.
        // Postgres releases it on commit AND rollback, so a failed consumption
        // cannot leak the lock. Same hashtext() convention as
        // AUDIT_CHAIN_XACT_LOCK in lib/audit.ts.
        //
        // (b) TWO DIFFERENT EVENTS ON ONE SHELF. Different references hash
        // apart, so (a) never makes them wait. That race is closed by the
        // FOR UPDATE reads inside consumeSimpleTx/consumeFefoTx below, which are
        // the same statements that read `current_stock` and the lot quantities —
        // the balance the ledger is written against cannot be stale.
        //
        // The advisory lock is only a serialisation device. A 32-bit hashtext
        // collision makes two unrelated consumptions wait for each other; it
        // cannot make either skip the check that decides, because the check runs
        // inside it. It is taken BEFORE any row lock and nothing here takes a
        // reference lock after touching a row, so the hierarchy cannot cycle.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${reference}))`);
        if (await referenceExists(tx, reference)) return;
        const reason = input.reason ?? `Auto-consumed for test completion (${input.referenceKey})`;
        if (rule.trackExpiry) {
          await consumeFefoTx(tx, rule.itemId, qty, reference, input.performedBy, reason);
        } else {
          await consumeSimpleTx(tx, rule.itemId, qty, reference, input.performedBy, reason);
        }
        consumed = true;
      });
      if (consumed) anyConsumed = true;
      results.push({ itemId: rule.itemId, itemName: rule.itemName, quantity: qty, skipped: !consumed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "consume failed";
      results.push({ itemId: rule.itemId, itemName: rule.itemName, quantity: qty, error: msg });
      // Swallowing this is deliberate (see voidPromise) — but swallowing it
      // *silently* meant a report could be released, its consumables never
      // deducted, and no record anywhere that the deduction was attempted.
      // Stock drift then looks like a counting error rather than an event.
      logger.warn(
        { source, referenceKey: input.referenceKey, reference, itemId: rule.itemId, itemName: rule.itemName, error: msg },
        "[inventory] auto-consume line failed",
      );
    }
  }

  if (anyConsumed) {
    void maybeSendLowStockAlerts("auto-consume");
  }

  return results;
}

/** Fire-and-forget hook after report verify. */
export function hookConsumeOnReportVerified(report: {
  id: number;
  testId: number | null;
  verifiedByName?: string | null;
}): Promise<void> {
  if (!report.testId) return Promise.resolve();
  return voidPromise(consumeInventoryForTest({
    testId: report.testId,
    referenceKey: `REPORT-${report.id}`,
    performedBy: report.verifiedByName?.trim() || "system",
    reason: `Auto-consumed on report #${report.id} verify`,
  }, "report-verify"));
}

/** Fire-and-forget hook after radiology study finalized. */
export function hookConsumeOnStudyFinalized(study: {
  id: number;
  testId: number;
  finalReportedBy?: string | null;
}): Promise<void> {
  return voidPromise(consumeInventoryForTest({
    testId: study.testId,
    referenceKey: `STUDY-${study.id}-FINAL`,
    performedBy: study.finalReportedBy?.trim() || "system",
    reason: `Auto-consumed on study #${study.id} final report`,
  }, "study-final"));
}

/** Fire-and-forget when lab sample marked completed (per order test). */
export function hookConsumeOnSampleCompleted(params: {
  sampleId: number;
  orderTestId: number;
  testId: number;
  performedBy: string;
}): Promise<void> {
  return voidPromise(consumeInventoryForTest({
    testId: params.testId,
    referenceKey: `SAMPLE-${params.sampleId}-OT-${params.orderTestId}`,
    performedBy: params.performedBy,
    reason: `Auto-consumed on sample #${params.sampleId} completed`,
  }, "sample-complete"));
}
