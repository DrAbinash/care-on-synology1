/**
 * Auto-deduct inventory from consumption rules (test → items).
 *
 * Idempotent per (event, item) by transaction reference key, and now serialised
 * on that key: the check-then-insert below runs inside a pg_advisory_xact_lock
 * on the reference, so concurrent firing of the same event (double-click,
 * client retry, Verify + countersign, two staff on one report) books the
 * deduction once instead of booking it twice against one stock figure.
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
import { and, eq, gt, sql } from "drizzle-orm";
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
  const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId)).limit(1);
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
  const [item] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId)).limit(1);
  if (!item) throw new Error("ITEM_NOT_FOUND");
  const batches = await tx
    .select()
    .from(inventoryBatchesTable)
    .where(and(
      eq(inventoryBatchesTable.itemId, itemId),
      eq(inventoryBatchesTable.status, "active"),
      gt(inventoryBatchesTable.qtyRemaining, "0"),
    ));
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
        // The dedupe below is a read-then-insert, and `reference` has no unique
        // index (nor can it have one: the manual stock-in/stock-out routes let
        // staff type any reference into the same column). Under READ COMMITTED
        // two sessions for one reference both read "no row" and both deduct —
        // a double-clicked Verify, a client retry after a timeout, two staff on
        // the report at once, and the legacy-verify vs structured-countersign
        // pair all reach this line together. Worse than deducting twice, both
        // write current_stock from the same stale `before`, so the ledger books
        // two units and the shelf loses one.
        //
        // A transaction-scoped advisory lock on the reference serialises them:
        // the second waiter resumes only after the first commits, then sees the
        // row and skips. Postgres releases it on commit AND rollback, so a
        // failed consumption cannot leak the lock. Same hashtext() convention
        // as AUDIT_CHAIN_XACT_LOCK in lib/audit.ts.
        //
        // The lock is only a serialisation device. A 32-bit hashtext collision
        // makes two unrelated consumptions wait for each other; it cannot make
        // either skip the check that decides, because the check runs inside it.
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
