/**
 * B-11 — the idempotency boundary of auto-consumption.
 *
 * inventoryConsumption.ts imports `db` from @workspace/db, which builds a pg
 * Pool at import time and therefore throws on a machine with no DATABASE_URL.
 * `db` is replaced here by an in-memory Postgres stand-in that models the two
 * things this ticket is about:
 *
 *   1. READ COMMITTED interleaving — every read, update and insert awaits, so
 *      a second concurrent transaction can run its existence check between the
 *      first one's check and its insert. That is the real race, and it is the
 *      defect.
 *   2. pg_advisory_xact_lock — requested by tx.execute(), held for the life of
 *      the transaction, waiters queued FIFO, released on commit AND on
 *      rollback. Same convention as lib/audit.ts (AUDIT_CHAIN_XACT_LOCK), whose
 *      suite models the lock the same way.
 *
 * Query targets are resolved by drizzle table name, and bind values are read
 * through drizzle's own SQL compiler. A predicate whose bind value cannot be
 * extracted THROWS — the fake can never answer "nothing found" and let a test
 * pass by accident.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const store = {
    items: [] as Row[],
    batches: [] as Row[],
    rules: [] as Row[],
    transactions: [] as Row[],
    honorLock: true,
    locked: false,
    queue: [] as Array<() => void>,
    ops: [] as string[],
    warns: [] as Array<Record<string, unknown>>,
    nextId: 1,
  };

  // A real await boundary per statement: two Promise.all'd consumptions
  // interleave here the way two Postgres sessions would.
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  async function acquire(key: string): Promise<() => void> {
    if (!store.honorLock) {
      store.ops.push("lock-ignored:" + key);
      return () => {};
    }
    if (store.locked) {
      store.ops.push("lock-wait:" + key);
      await new Promise<void>((resolve) => store.queue.push(resolve));
    } else {
      store.locked = true;
    }
    store.ops.push("lock-held:" + key);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = store.queue.shift();
      if (next) next();
      else store.locked = false;
    };
  }

  let dialect: { sqlToQuery: (q: unknown) => { sql: string; params: unknown[] } } | null = null;
  async function compiled(expr: unknown): Promise<{ sql: string; params: unknown[] }> {
    if (!dialect) {
      const mod = (await import("drizzle-orm/pg-core")) as unknown as { PgDialect: new () => typeof dialect };
      dialect = new mod.PgDialect();
    }
    const out = dialect!.sqlToQuery(expr as never) as { sql: string; params: unknown[] };
    return { sql: String(out.sql), params: out.params ?? [] };
  }
  async function numBind(expr: unknown): Promise<number> {
    const { params } = await compiled(expr);
    const v = params.find((x) => typeof x === "number");
    if (v === undefined) throw new Error("FAKE-DB: no numeric bind value in this predicate");
    return v;
  }
  async function refBind(expr: unknown): Promise<string> {
    const { params } = await compiled(expr);
    const v = params.find((x) => typeof x === "string" && x.startsWith("CONSUME-"));
    if (v === undefined) throw new Error("FAKE-DB: no CONSUME- reference bind value in this predicate");
    return String(v);
  }

  const ARRAY: Record<string, () => Row[]> = {
    inventory_items: () => store.items,
    inventory_batches: () => store.batches,
    inventory_consumption_rules: () => store.rules,
    inventory_transactions: () => store.transactions,
  };
  const DRIZZLE_NAME = Symbol.for("drizzle:Name");
  const rowsOf = (table: unknown): { name: string; rows: Row[] } => {
    // `.name` on a drizzle table is its first COLUMN, not its own name — the
    // real name lives behind Symbol.for("drizzle:Name").
    const name = String((table as Record<symbol, unknown> | null)?.[DRIZZLE_NAME] ?? "");
    const f = ARRAY[name];
    if (!f) throw new Error("FAKE-DB: query against an unknown table (" + name + ")");
    return { name, rows: f() };
  };

  function makeApi(): Record<string, unknown> {
    return {
      select: () => ({
        from: (table: unknown) => {
          const { name, rows } = rowsOf(table);
          const resolve = async (where?: unknown): Promise<Row[]> => {
            await tick();
            if (!where) return rows.slice();
            const { sql } = await compiled(where);
            store.ops.push("select:" + name + ":" + sql);
            if (name === "inventory_transactions") {
              const ref = await refBind(where);
              return rows.filter((r) => String(r.reference) === ref);
            }
            if (name === "inventory_items") {
              const id = await numBind(where);
              return rows.filter((r) => Number(r.id) === id);
            }
            if (name === "inventory_consumption_rules") {
              const id = await numBind(where);
              return rows.filter((r) => Number(r.testId) === id);
            }
            if (name === "inventory_batches") {
              const id = await numBind(where);
              return rows.filter((r) => Number(r.itemId) === id && String(r.status) === "active" && Number(r.qtyRemaining) > 0);
            }
            return rows.slice();
          };
          const wrap = (p: Promise<Row[]>) => ({
            then: (onF?: (v: unknown) => unknown) => p.then(onF),
            catch: (onR?: (e: unknown) => unknown) => p.catch(onR),
            where: (w: unknown) => wrap(resolve(w)),
            innerJoin: () => wrap(p),
            limit: (n: number) => wrap(p.then((r) => r.slice(0, n))),
          });
          return wrap(resolve());
        },
      }),
      update: (table: unknown) => ({
        set: (vals: Row) => ({
          where: async (w: unknown) => {
            await tick();
            const { name, rows } = rowsOf(table);
            const id = await numBind(w);
            for (const r of rows) if (Number(r.id) === id) Object.assign(r, vals);
            store.ops.push("update:" + name);
            return [];
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (v: Row) => {
          const p = (async () => {
            await tick();
            const { name, rows } = rowsOf(table);
            const row = { id: store.nextId++, ...v };
            rows.push(row);
            store.ops.push("insert:" + name + ":" + String(v.reference ?? ""));
            return [row];
          })();
          return {
            then: (onF?: (x: unknown) => unknown) => p.then(onF),
            returning: () => ({ then: (onF?: (x: unknown) => unknown) => p.then(onF) }),
          };
        },
      }),
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        let release: () => void = () => {};
        const tx = {
          ...makeApi(),
          execute: async (expr: unknown) => {
            const { sql, params } = await compiled(expr);
            // Transaction-scoped is the load-bearing word: a session-scoped
            // pg_advisory_lock taken on a pooled client that never unlocks it
            // leaks the lock into the next request that borrows that client.
            if (!/pg_advisory_xact_lock/i.test(sql)) {
              throw new Error("FAKE-DB: tx.execute() is not a transaction-scoped advisory lock");
            }
            // The key is whatever the code locks on — a bound value or an SQL
            // literal — because Postgres keys advisory locks on the value, not
            // on its provenance. A global literal key is still correct, merely
            // slower, and the suite must not pretend otherwise.
            const literal = sql.match(/hashtext\('([^']*)'\)/);
            const key = String(params[0] ?? (literal ? literal[1] : "") ?? "");
            if (!key) throw new Error("FAKE-DB: advisory lock taken with no key");
            release = await acquire(key);
            return [];
          },
        };
        try {
          return await cb(tx);
        } finally {
          release();
        }
      },
    };
  }

  const db = makeApi();
  return { store, tick, db, mod: { db } };
});

vi.mock("@workspace/db", () => h.mod);
vi.mock("./inventoryLowStockAlerts", () => ({ maybeSendLowStockAlerts: () => undefined }));
vi.mock("./logger", () => ({
  logger: {
    warn: (obj: unknown) => h.store.warns.push(obj as Record<string, unknown>),
    info: () => undefined,
    error: (obj: unknown) => h.store.warns.push(obj as Record<string, unknown>),
  },
}));

import {
  consumeInventoryForTest,
  consumptionReference,
  hookConsumeOnReportVerified,
  hookConsumeOnStudyFinalized,
} from "./inventoryConsumption";

const { store, tick } = h;
type Row = Record<string, unknown>;
const stock = (itemId: number): number => Number(store.items.find((r) => Number(r.id) === itemId)!.currentStock);
const consumeRows = (reference?: string): Row[] =>
  store.transactions.filter(
    (r) => String(r.reference ?? "").startsWith("CONSUME-") && (reference === undefined || String(r.reference) === reference),
  );

function seedItem(over: Partial<Row> = {}): number {
  const id = 100 + store.items.length;
  store.items.push({ id, name: "Iodinated contrast 100ml", currentStock: "100", trackExpiry: false, isActive: true, ...over });
  return id;
}
function seedRule(testId: number, itemId: number, quantity = "1"): void {
  const item = store.items.find((r) => Number(r.id) === itemId)!;
  // The SUT branches on the ITEM's isActive/trackExpiry, which the real query
  // reads through a join. A fake that hardcoded these would let a test pass
  // for the wrong reason, so both are read off the seeded item.
  store.rules.push({
    testId,
    itemId,
    quantity,
    itemName: String(item.name),
    trackExpiry: Boolean(item.trackExpiry),
    isActive: Boolean(item.isActive),
  });
}
const settle = async () => {
  for (let i = 0; i < 15; i++) await tick();
};

beforeEach(() => {
  store.items = [];
  store.batches = [];
  store.rules = [];
  store.transactions = [];
  store.ops = [];
  store.warns = [];
  store.honorLock = true;
  store.locked = false;
  store.queue = [];
  store.nextId = 1;
});

describe("B11-01 — the canonical release event consumes exactly once", () => {
  it("one verify deducts the rule quantity once and writes one ledger row", async () => {
    const itemId = seedItem();
    seedRule(7, itemId, "2");
    const lines = await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "Dr X" });
    expect(lines).toHaveLength(1);
    expect(lines[0].skipped).toBeFalsy();
    expect(consumeRows()).toHaveLength(1);
    expect(stock(itemId)).toBe(98);
  });

  it("the ledger row is attributable: reference, actor, reason, before/after", async () => {
    const itemId = seedItem();
    seedRule(7, itemId);
    await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "Dr X" });
    const row = consumeRows()[0];
    expect(row.reference).toBe(`CONSUME-REPORT-41-ITEM-${itemId}`);
    expect(row.type).toBe("out");
    expect(row.performedBy).toBe("Dr X");
    expect(String(row.reason)).toContain("REPORT-41");
    expect(row.stockBefore).toBe("100");
    expect(row.stockAfter).toBe("99");
  });
});

describe("B11-02 — repeating the same operation never consumes twice", () => {
  it("a second call with the same referenceKey is skipped and stock is untouched", async () => {
    const itemId = seedItem();
    seedRule(7, itemId);
    const first = await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "Dr X" });
    const second = await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "Dr Y" });
    expect(first[0].skipped).toBeFalsy();
    expect(second[0].skipped).toBe(true);
    expect(consumeRows()).toHaveLength(1);
    expect(stock(itemId)).toBe(99);
  });

  it("a refreshed screen that replays the request five times deducts once", async () => {
    const itemId = seedItem();
    seedRule(7, itemId);
    for (let i = 0; i < 5; i++) await consumeInventoryForTest({ testId: 7, referenceKey: "STUDY-12-FINAL", performedBy: "Dr X" });
    expect(consumeRows()).toHaveLength(1);
    expect(stock(itemId)).toBe(99);
  });
});

describe("B11-03 — concurrent execution cannot double-consume", () => {
  it("two overlapping calls for one reference produce ONE ledger row", async () => {
    const itemId = seedItem();
    seedRule(7, itemId);
    const [a, b] = await Promise.all([
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "Dr X" }),
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "Dr Y" }),
    ]);
    expect(consumeRows(`CONSUME-REPORT-41-ITEM-${itemId}`)).toHaveLength(1);
    expect(stock(itemId)).toBe(99);
    expect([a, b].filter((r) => r[0].skipped)).toHaveLength(1);
    const held = store.ops.findIndex((o) => o.startsWith("lock-held:"));
    const checked = store.ops.findIndex((o) => o.startsWith("select:inventory_transactions"));
    expect(held, "the lock must actually be taken").toBeGreaterThanOrEqual(0);
    expect(checked, "the lock must be taken BEFORE the existence check").toBeGreaterThan(held);
  });

  it("three staff clicking Verify at once still deduct once", async () => {
    const itemId = seedItem();
    seedRule(7, itemId);
    await Promise.all([
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" }),
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "B" }),
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "C" }),
    ]);
    expect(consumeRows()).toHaveLength(1);
    expect(stock(itemId)).toBe(99);
  });

  it("NEGATIVE CONTROL — with the advisory lock disabled the same race double-books", async () => {
    store.honorLock = false;
    const itemId = seedItem();
    seedRule(7, itemId);
    await Promise.all([
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" }),
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "B" }),
    ]);
    // Two ledger rows for one physical event: the dedupe failed. And the stock
    // is worse than double-booked — both transactions read current_stock=100
    // and wrote 99, so the second UPDATE overwrote the first (a lost update).
    // Two units are recorded as gone and only one came off the shelf: the
    // ledger and the stock figure now disagree, which is the failure this
    // ticket exists to prevent.
    const rows = consumeRows();
    expect(rows.length, "the stand-in must really interleave").toBe(2);
    const booked = rows.reduce((s, r) => s + Number(r.quantity), 0);
    expect(booked).toBe(2);
    expect(100 - stock(itemId), "stock moved by less than the ledger booked").toBe(1);
  });
});

describe("B11-04 — two reporting endpoints for one report share one key", () => {
  it("verify and structured countersign of the same report deduct once in total", async () => {
    const itemId = seedItem();
    seedRule(7, itemId);
    await Promise.all([
      hookConsumeOnReportVerified({ id: 41, testId: 7, verifiedByName: "Dr X" }),
      hookConsumeOnReportVerified({ id: 41, testId: 7, verifiedByName: "Dr Y" }),
    ]);
    await settle();
    expect(consumeRows(`CONSUME-REPORT-41-ITEM-${itemId}`)).toHaveLength(1);
    expect(stock(itemId)).toBe(99);
  });
});

describe("B11-05 — reference keys stay distinguishable and interpretable", () => {
  it("pins the per-line reference format", () => {
    expect(consumptionReference("REPORT-41", 5)).toBe("CONSUME-REPORT-41-ITEM-5");
    expect(consumptionReference("STUDY-12-FINAL", 5)).toBe("CONSUME-STUDY-12-FINAL-ITEM-5");
    expect(consumptionReference("SAMPLE-3-OT-9", 5)).toBe("CONSUME-SAMPLE-3-OT-9-ITEM-5");
  });

  it("the three historical families are unchanged: REPORT- / STUDY- / SAMPLE-", async () => {
    const itemId = seedItem();
    seedRule(7, itemId);
    await hookConsumeOnReportVerified({ id: 41, testId: 7, verifiedByName: "A" });
    await hookConsumeOnStudyFinalized({ id: 12, testId: 7, finalReportedBy: "B" });
    await settle();
    const refs = consumeRows().map((r) => String(r.reference));
    expect(refs).toContain(`CONSUME-REPORT-41-ITEM-${itemId}`);
    expect(refs).toContain(`CONSUME-STUDY-12-FINAL-ITEM-${itemId}`);
  });

  it("two DIFFERENT reports of the same test both deduct — no over-dedup", async () => {
    // The mirror-image failure: a dedupe key that ignores which event it came
    // from keeps stock perfectly and silently stops charging for it. Two
    // separate MRIs of the same protocol must take two doses.
    //
    // Sequential, deliberately. B-11 serialises one *event*; it does not make
    // two concurrent distinct events agree on the running balance — CI proved
    // that on real Postgres (see the KNOWN GAP case in
    // inventoryConsumption.concurrency.request.test.ts, which is where that
    // behaviour is recorded). Asserting a concurrent total here would claim a
    // guarantee this PR does not make, and would depend on fake scheduling.
    const itemId = seedItem();
    seedRule(7, itemId);
    await hookConsumeOnReportVerified({ id: 41, testId: 7, verifiedByName: "A" });
    await settle();
    await hookConsumeOnReportVerified({ id: 42, testId: 7, verifiedByName: "A" });
    await settle();
    expect(consumeRows().length).toBe(2);
    expect(stock(itemId)).toBe(98);
  });

  it("two CONCURRENT different events are each booked once (balance not asserted — follow-up)", async () => {
    const itemId = seedItem();
    seedRule(7, itemId);
    await Promise.all([
      hookConsumeOnReportVerified({ id: 41, testId: 7, verifiedByName: "A" }),
      hookConsumeOnReportVerified({ id: 42, testId: 7, verifiedByName: "B" }),
    ]);
    await settle();
    const rows = consumeRows();
    expect(rows.length, "each distinct event books exactly once").toBe(2);
    expect(new Set(rows.map((r) => String(r.reference))).size).toBe(2);
  });
});

describe("B11-06 — actions that are not a release do not consume", () => {
  it("verify of a report with no billed test touches the database not at all", async () => {
    const itemId = seedItem();
    seedRule(7, itemId);
    await hookConsumeOnReportVerified({ id: 41, testId: null });
    await settle();
    expect(store.ops).toEqual([]);
    expect(consumeRows()).toHaveLength(0);
    expect(stock(itemId)).toBe(100);
  });

  it("a test with no consumption rules consumes nothing", async () => {
    seedItem();
    const lines = await consumeInventoryForTest({ testId: 999, referenceKey: "REPORT-1", performedBy: "A" });
    expect(lines).toEqual([]);
    expect(consumeRows()).toHaveLength(0);
  });

  it("an inactive item is skipped, not deducted", async () => {
    const itemId = seedItem({ isActive: false });
    seedRule(7, itemId);
    const lines = await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" });
    expect(lines[0].skipped).toBe(true);
    expect(consumeRows()).toHaveLength(0);
    expect(stock(itemId)).toBe(100);
  });
});

describe("B11-07 — a failed deduction is attributable and never blocks the release", () => {
  it("an insufficient-stock line is logged against its reference instead of vanishing", async () => {
    const itemId = seedItem({ currentStock: "0" });
    seedRule(7, itemId);
    const lines = await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" });
    expect(lines[0].error).toBeTruthy();
    await hookConsumeOnReportVerified({ id: 41, testId: 7, verifiedByName: "A" });
    await settle();
    const hit = store.warns.find((w) => String(w.referenceKey ?? "").includes("REPORT-41"));
    expect(hit, "a failed auto-consume must leave an attributable record").toBeTruthy();
    expect(String(hit!.error)).toContain("INSUFFICIENT_STOCK");
  });

  it("the hook resolves even when stock is short, so verify cannot fail on inventory", async () => {
    const itemId = seedItem({ currentStock: "0" });
    seedRule(7, itemId);
    await expect(hookConsumeOnReportVerified({ id: 41, testId: 7, verifiedByName: "A" })).resolves.toBeUndefined();
  });
});

describe("B11-08 — the FEFO branch is under the same discipline", () => {
  it("a batch-tracked item deducts once and its lot is decremented", async () => {
    const itemId = seedItem({ trackExpiry: true });
    store.batches.push({ id: 1, itemId, qtyRemaining: "50", status: "active", expiryDate: new Date("2030-01-01") });
    seedRule(7, itemId, "3");
    const first = await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" });
    const again = await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" });
    expect(first[0].skipped).toBeFalsy();
    expect(again[0].skipped).toBe(true);
    expect(consumeRows()).toHaveLength(1);
    expect(stock(itemId)).toBe(97);
    expect(Number(store.batches[0].qtyRemaining)).toBe(47);
  });

  it("two concurrent FEFO consumptions of one reference produce one ledger row", async () => {
    const itemId = seedItem({ trackExpiry: true });
    store.batches.push({ id: 1, itemId, qtyRemaining: "50", status: "active", expiryDate: new Date("2030-01-01") });
    seedRule(7, itemId, "2");
    await Promise.all([
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" }),
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "B" }),
    ]);
    expect(consumeRows()).toHaveLength(1);
    expect(Number(store.batches[0].qtyRemaining)).toBe(48);
  });

  it("multi-item rules keep per-item idempotency: one short line does not undo the other", async () => {
    const good = seedItem({ name: "Syringe 10ml" });
    const short = seedItem({ name: "Cannula", currentStock: "0" });
    seedRule(7, good);
    seedRule(7, short);
    const lines = await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" });
    expect(lines).toHaveLength(2);
    expect(stock(good)).toBe(99);
    expect(consumeRows(`CONSUME-REPORT-41-ITEM-${good}`)).toHaveLength(1);
    expect(consumeRows(`CONSUME-REPORT-41-ITEM-${short}`)).toHaveLength(0);
  });
});
