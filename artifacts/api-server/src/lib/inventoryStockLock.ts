/**
 * inventoryStockLock.ts — the one lock order every writer of an inventory
 * balance follows.
 *
 * `inventory_items.current_stock` and `inventory_batches.qty_remaining` are
 * written by a dozen endpoints, and until B-13 only
 * `lib/inventoryConsumption.ts` (the automatic deduction path, B-11 + B-12)
 * took any lock at all. Every other writer read the balance, did arithmetic in
 * JS, and wrote an absolute value back. Two of those interleaving is not a
 * stall or a wrong answer for one client — it is a committed movement that
 * silently disappears from the shelf while its ledger row stays. The database
 * cannot notice, because each transaction is individually well-formed.
 *
 * THE ORDER
 * ---------
 *   1. document / event key   — consumption: pg_advisory_xact_lock(hashtext(reference))
 *                               demand issue: FOR UPDATE on the demand row
 *                               invoice post: FOR UPDATE on the invoice row
 *   2. lots                   — SELECT … FROM inventory_batches
 *                               WHERE item_id = ? AND status = 'active' AND qty_remaining > 0
 *                               ORDER BY expiry_date, id  FOR UPDATE
 *   3. item                   — SELECT … FROM inventory_items WHERE id = ? FOR UPDATE
 *
 * then compute from the LOCKED rows, write, insert the ledger row, commit.
 *
 * Why this order and not the obvious one. Step 2 before step 3 is not a choice
 * made here — it is the order B-12 shipped for the FEFO deduction, and that
 * path is load-bearing in production. A protocol that put the item lock first
 * would have inverted against it and created a deadlock that did not exist
 * before. Everything else in the inventory module was then brought into the
 * order the locked path already used, which is also the order the code already
 * wrote rows in (lots, then the item, then the ledger).
 *
 * Consequences worth stating plainly:
 *
 * - A transaction that touches several items must acquire the item locks in
 *   ascending `itemId`. Only the purchase-invoice post does this; its line loop
 *   is sorted for that reason.
 * - Nothing ever takes an item lock and then waits for a lot lock, so the
 *   hierarchy cannot cycle.
 * - `FOR UPDATE` on a row a writer is about to replace is the whole mechanism.
 *   There is no second advisory scheme for balances: an advisory key that is
 *   not the row itself would have to be remembered by every future writer, and
 *   a row lock is impossible to forget because the read that computes the value
 *   is the read that takes it.
 * - A locking read is not a guard. The insufficient-stock check, the demand
 *   status check and the invoice draft check all have to run on the row AFTER
 *   it has been locked, or they simply describe a moment that has already passed.
 */
import { db } from "@workspace/db";
import { inventoryItemsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type InventoryTx = DbTx;

/**
 * Lock the item row and return it, for the transaction that is about to change
 * its `current_stock`. Step 3 of the order. Returns null when the item does not
 * exist, which every caller already maps to 404 / ITEM_NOT_FOUND.
 *
 * `current_stock` is read HERE, from the locked row, so the `before` a caller
 * computes cannot be a value another committed transaction has already replaced.
 */
export async function lockItemForStockTx(tx: DbTx, itemId: number): Promise<typeof inventoryItemsTable.$inferSelect | null> {
  const [item] = await tx
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, itemId))
    .for("update")
    .limit(1);
  return item ?? null;
}
