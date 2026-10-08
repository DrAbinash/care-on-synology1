/**
 * The consumption boundary, modelled: B-11's event idempotency and B-12's
 * ledger-vs-balance agreement.
 *
 * inventoryConsumption.ts imports `db` from @workspace/db, which builds a pg
 * Pool at import time and therefore throws on a machine with no DATABASE_URL.
 * `db` is replaced here by an in-memory Postgres stand-in that models the three
 * things these tickets are about:
 *
 *   1. READ COMMITTED interleaving — every read, update and insert awaits, so
 *      a second concurrent transaction can run its existence check between the
 *      first one's check and its insert. That is the real race, and it is the
 *      defect.
 *   2. pg_advisory_xact_lock — requested by tx.execute(), held for the life of
 *      the transaction, waiters queued FIFO, released on commit AND on
 *      rollback. Same convention as lib/audit.ts (AUDIT_CHAIN_XACT_LOCK), whose
 *      suite models the lock the same way.
 *   3. SELECT … FOR UPDATE — a locking read holds the row for the life of its
 *      transaction, keyed on the row the predicate names, and locks are per
 *      key: one advisory lock per reference value, one row lock per item or lot
 *      set. That per-key detail is the whole of B-12, because two DIFFERENT
 *      references must not serialise on the reference and must still serialise
 *      on the shelf.
 *
 * Query targets are resolved by drizzle table name, and bind values are read
 * through drizzle's own SQL compiler. A predicate whose bind value cannot be
 * extracted THROWS, an unmodelled lock strength or SKIP LOCKED THROWS, and a
 * FOR UPDATE on a table the stand-in cannot key THROWS — the fake can never
 * answer "nothing found" and let a test pass by accident.
 *
 * This file is a model, so it is not the decisive proof of anything: the real
 * concurrency claims are made against PostgreSQL in
 * inventoryConsumption.concurrency.request.test.ts, which runs in CI.
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
    honorResourceLock: true,
    // Locks are keyed, the way Postgres keys them: one advisory lock per
    // reference value, one row lock per (table, row). A single global flag here
    // would serialise two UNRELATED events and make the cross-event race look
    // impossible in the very place it is supposed to be reproducible.
    locks: new Map<string, { held: boolean; queue: Array<() => void> }>(),
    ops: [] as string[],
    warns: [] as Array<Record<string, unknown>>,
    nextId: 1,
  };

  // A real await boundary per statement: two Promise.all'd consumptions
  // interleave here the way two Postgres sessions would.
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  async function acquire(key: string, kind: string): Promise<() => void> {
    let slot = store.locks.get(key);
    if (!slot) {
      slot = { held: false, queue: [] };
      store.locks.set(key, slot);
    }
    if (slot.held) {
      store.ops.push(`${kind}-wait:${key}`);
      await new Promise<void>((resolve) => slot!.queue.push(resolve));
    } else {
      slot.held = true;
    }
    store.ops.push(`${kind}-held:${key}`);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = slot!.queue.shift();
      if (next) next();
      else slot!.held = false;
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

  function makeApi(releases: Array<() => void> | null): Record<string, unknown> {
    return {
      select: () => ({
        from: (table: unknown) => {
          const { name, rows } = rowsOf(table);
          const spec = { where: undefined as unknown, locking: false, limitN: 0, sorted: false };
          // Built lazily, when the caller awaits: `.where(a).for("update").limit(1)`
          // mutates one spec and runs ONE statement. Building eagerly would also
          // have taken the row lock in a wrapper that the caller throws away.
          const build = async (): Promise<Row[]> => {
            await tick();
            let out = rows.slice();
            if (spec.where !== undefined) {
              const { sql } = await compiled(spec.where);
              store.ops.push("select:" + name + ":" + sql);
              if (name === "inventory_transactions") {
                const ref = await refBind(spec.where);
                out = rows.filter((r) => String(r.reference) === ref);
              } else if (name === "inventory_items") {
                const id = await numBind(spec.where);
                out = rows.filter((r) => Number(r.id) === id);
              } else if (name === "inventory_consumption_rules") {
                const id = await numBind(spec.where);
                out = rows.filter((r) => Number(r.testId) === id);
              } else if (name === "inventory_batches") {
                const id = await numBind(spec.where);
                out = rows.filter(
                  (r) => Number(r.itemId) === id && String(r.status) === "active" && Number(r.qtyRemaining) > 0,
                );
              } else {
                out = rows.slice();
              }
              if (spec.sorted) store.ops.push("orderby:" + name);
              if (spec.locking) {
                // A FOR UPDATE read is the point of B-12, so the stand-in models
                // it as a held lock keyed on the row the predicate names. An
                // unmodelled lock strength or a locking read whose key cannot be
                // extracted THROWS rather than quietly answering.
                if (name === "inventory_items") {
                  const key = "item:" + (await numBind(spec.where));
                  if (store.honorResourceLock) releases?.push(await acquire(key, "resource"));
                  else store.ops.push("resource-ignored:" + key);
                } else if (name === "inventory_batches") {
                  const key = "lots:" + (await numBind(spec.where));
                  if (store.honorResourceLock) releases?.push(await acquire(key, "resource"));
                  else store.ops.push("resource-ignored:" + key);
                } else {
                  throw new Error("FAKE-DB: FOR UPDATE on an unmodelled table (" + name + ")");
                }
              }
            }
            if (spec.limitN) out = out.slice(0, spec.limitN);
            return out;
          };
          const wrap = () => ({
            then: (onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => build().then(onF, onR),
            catch: (onR?: (e: unknown) => unknown) => build().catch(onR),
            where: (w: unknown) => {
              spec.where = w;
              return wrap();
            },
            innerJoin: () => wrap(),
            orderBy: () => {
              spec.sorted = true;
              return wrap();
            },
            limit: (n: number) => {
              spec.limitN = n;
              return wrap();
            },
            for: (strength: string, opts?: { skipLocked?: boolean }) => {
              if (strength !== "update") {
                throw new Error("FAKE-DB: unexpected lock strength " + strength);
              }
              if (opts?.skipLocked) throw new Error("FAKE-DB: SKIP LOCKED is not modelled");
              spec.locking = true;
              return wrap();
            },
          });
          return wrap();
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
        // Every lock this transaction took — the advisory reference lock and any
        // FOR UPDATE read — is released together, on commit AND on rollback,
        // which is the property `pg_advisory_xact_lock` and row locks actually
        // have. A release list, not one slot: a FEFO line holds two keys.
        const held: Array<() => void> = [];
        const tx = {
          ...makeApi(held),
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
            if (!store.honorLock) {
              store.ops.push("lock-ignored:" + key);
              return [];
            }
            held.push(await acquire("ref:" + key, "lock"));
            return [];
          },
        };
        try {
          return await cb(tx);
        } finally {
          for (const release of held.splice(0)) release();
        }
      },
    };
  }

  const db = makeApi(null);

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
  store.honorResourceLock = true;
  store.locks = new Map();
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
    // Two ledger rows for one physical event: the dedupe failed, which is what
    // this control exists to show. Note what no longer follows from it: before
    // B-12 this control ALSO saw the balance move by only one unit, because the
    // same unserialised read produced both the double-book and the lost update.
    // The FOR UPDATE read now holds the balance even when the reference lock is
    // ignored, so the two mechanisms are separately observable — see the B12
    // controls, which disable the other one.
    const rows = consumeRows();
    expect(rows.length, "the stand-in must really interleave").toBe(2);
    const booked = rows.reduce((s, r) => s + Number(r.quantity), 0);
    expect(booked).toBe(2);
    expect(100 - stock(itemId), "the row lock still serialises the two writes").toBe(booked);
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

describe("B12-N1 — two different events spending one shelf", () => {
  it("concurrent distinct references each deduct, and the balance moves by the SUM", async () => {
    // The B-11 gap: REPORT-41 and REPORT-42 hash to different advisory keys, so
    // nothing made them wait for each other. Both read current_stock = 100 and
    // both wrote 99. The ledger said 2 units gone, the shelf said 1.
    const itemId = seedItem();
    seedRule(7, itemId);
    const results = await Promise.all([
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" }),
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-42", performedBy: "B" }),
    ]);
    expect(results.flatMap((r) => r.map((l) => l.error).filter(Boolean))).toEqual([]);
    const rows = consumeRows();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => String(r.reference))).size).toBe(2);
    expect(stock(itemId)).toBe(98);
  });

  it("NEGATIVE CONTROL — with the row lock disabled the lost update returns", async () => {
    store.honorResourceLock = false;
    const itemId = seedItem();
    seedRule(7, itemId);
    await Promise.all([
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" }),
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-42", performedBy: "B" }),
    ]);
    const rows = consumeRows();
    const booked = rows.reduce((s, r) => s + Number(r.quantity), 0);
    expect(rows).toHaveLength(2);
    expect(booked).toBe(2);
    expect(100 - stock(itemId), "ledger booked 2 units but the shelf lost this many").toBe(1);
  });

  it("five concurrent events on a two-unit rule leave the exact summed balance", async () => {
    const itemId = seedItem();
    seedRule(7, itemId, "2");
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => consumeInventoryForTest({ testId: 7, referenceKey: `REPORT-${i}`, performedBy: "A" })),
    );
    expect(results.flatMap((r) => r.map((l) => l.error).filter(Boolean))).toEqual([]);
    expect(consumeRows()).toHaveLength(5);
    expect(stock(itemId)).toBe(90);
  });

  it("one available unit is spent once, whoever asks first", async () => {
    const itemId = seedItem({ currentStock: "1" });
    seedRule(7, itemId);
    const results = await Promise.all([
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" }),
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-42", performedBy: "B" }),
    ]);
    const rows = consumeRows();
    expect(rows).toHaveLength(1);
    expect(stock(itemId)).toBe(0);
    const errors = results.flatMap((r) => r.map((l) => l.error).filter(Boolean));
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("INSUFFICIENT_STOCK");
  });

  it("a FEFO lot cannot be allocated twice by two concurrent events", async () => {
    const itemId = seedItem({ trackExpiry: true, currentStock: "50" });
    store.batches.push({ id: 1, itemId, qtyRemaining: "50", status: "active", expiryDate: new Date("2030-01-01") });
    seedRule(7, itemId, "30");
    const results = await Promise.all([
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" }),
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-42", performedBy: "B" }),
    ]);
    // 50 in the lot, 30 wanted twice: only one of them fits. Without the lot
    // lock both would read 50, both would allocate, and the lot would end at 20
    // having issued 60 units.
    expect(consumeRows()).toHaveLength(1);
    expect(Number(store.batches[0].qtyRemaining)).toBe(20);
    expect(stock(itemId)).toBe(20);
    expect(results.flatMap((r) => r.map((l) => l.error).filter(Boolean))).toHaveLength(1);
  });
  it("two concurrent FEFO events on two different lots are both honoured", async () => {
    // The over-serialisation mirror: a lock that also collapsed distinct events
    // would leave the balance perfect and the reagents uncounted. Two doses, two
    // lots, two events — both must be booked and both lots must empty.
    const itemId = seedItem({ trackExpiry: true, currentStock: "8" });
    store.batches.push({ id: 1, itemId, qtyRemaining: "4", status: "active", expiryDate: new Date("2029-01-01") });
    store.batches.push({ id: 2, itemId, qtyRemaining: "4", status: "active", expiryDate: new Date("2030-01-01") });
    seedRule(7, itemId, "4");
    const results = await Promise.all([
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" }),
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-42", performedBy: "B" }),
    ]);
    expect(results.flatMap((r) => r.map((l) => l.error).filter(Boolean))).toEqual([]);
    expect(consumeRows()).toHaveLength(2);
    expect(Number(store.batches[0].qtyRemaining)).toBe(0);
    expect(Number(store.batches[1].qtyRemaining)).toBe(0);
    expect(stock(itemId)).toBe(0);
  });
});

describe("B12-N2 — the acquisition order is the deadlock analysis, so it is pinned", () => {
  it("advisory(reference) → lot → item, with the lots read in consumption order", async () => {
    const itemId = seedItem({ trackExpiry: true, currentStock: "50" });
    store.batches.push({ id: 1, itemId, qtyRemaining: "30", status: "active", expiryDate: new Date("2029-01-01") });
    store.batches.push({ id: 2, itemId, qtyRemaining: "30", status: "active", expiryDate: new Date("2030-01-01") });
    seedRule(7, itemId, "5");
    await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" });

    const at = (prefix: string): number => store.ops.findIndex((o) => o.startsWith(prefix));
    const ref = at("lock-held:ref:");
    const order = store.ops.indexOf("orderby:inventory_batches");
    const lots = at("resource-held:lots:");
    const item = at("resource-held:item:");
    // Every one of these four must exist and be ordered. This is the property
    // that makes the design deadlock-free rather than merely working, so it is
    // asserted as an order and not as a count: an index that moved past its
    // neighbour fails, which a "was FOR UPDATE called" count would not catch.
    expect(ref, "the reference advisory lock is taken").toBeGreaterThanOrEqual(0);
    expect(order, "the lot read that takes the lock is ordered by consumption sequence").toBeGreaterThanOrEqual(0);
    expect(lots, "the lots are locked before they are allocated").toBeGreaterThanOrEqual(0);
    expect(item, "the item balance is locked too").toBeGreaterThanOrEqual(0);
    expect(lots).toBeGreaterThan(ref);
    expect(order).toBeLessThan(lots);
    expect(item).toBeGreaterThan(lots);
  });

  it("the non-batch path locks the item under the reference lock and never touches lots", async () => {
    const itemId = seedItem();
    seedRule(7, itemId);
    await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" });
    const ops = store.ops;
    const ref = ops.findIndex((o) => o.startsWith("lock-held:ref:"));
    const item = ops.findIndex((o) => o.startsWith("resource-held:item:"));
    expect(ref).toBeGreaterThanOrEqual(0);
    expect(item).toBeGreaterThan(ref);
    expect(ops.some((o) => o.startsWith("resource-held:lots:")), "simple stock has no lot lock").toBe(false);
  });

  it("a line that fails after taking both locks releases them both", async () => {
    const itemId = seedItem({ trackExpiry: true, currentStock: "50" });
    store.batches.push({ id: 1, itemId, qtyRemaining: "2", status: "active", expiryDate: new Date("2030-01-01") });
    seedRule(7, itemId, "9");
    const failed = await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" });
    expect(String(failed[0].error)).toContain("INSUFFICIENT_USABLE_STOCK");
    // Nothing is still held: the next event on the same item and the same
    // reference must both run to completion rather than queue forever.
    expect(store.locks.size, "every lock key this transaction touched").toBeGreaterThan(0);
    for (const [, slot] of store.locks) expect(slot.held, "a rolled-back line must not keep a lock").toBe(false);
    store.batches[0].qtyRemaining = "20";
    const retry = await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" });
    expect(retry[0].error).toBeUndefined();
    expect(retry[0].skipped, "a rolled-back event is not marked as already consumed").toBeFalsy();
    expect(stock(itemId)).toBe(41);
    expect(Number(store.batches[0].qtyRemaining)).toBe(11);
    const other = await consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-42", performedBy: "B" });
    expect(other[0].error).toBeUndefined();
    expect(stock(itemId)).toBe(32);
  });
});

describe("B12-N3 — what this PR decides and what it does not", () => {
  it("the balance keeps tracking the ledger even where the item total and its lots already disagree", async () => {
    // `consumeFefoTx` validates the LOTS — a shortfall throws — and then writes
    // the item balance without comparing it to the quantity, because the schema
    // treats `current_stock` as the rollup of the lots
    // (lib/db/src/schema/inventory.ts:29-31). Where a clinic's two numbers
    // already disagree, the deduction is real and the rollup can fall below
    // zero. B-12 deliberately does not choose which number is authoritative:
    // that is an inventory-model question, and it is reported, not absorbed.
    // What IS asserted here is the invariant this PR owns — the balance moves by
    // exactly what the ledger booked, so the disagreement is visible instead of
    // being masked by a lost update.
    const itemId = seedItem({ trackExpiry: true, currentStock: "1" });
    store.batches.push({ id: 1, itemId, qtyRemaining: "10", status: "active", expiryDate: new Date("2030-01-01") });
    seedRule(7, itemId, "4");
    const results = await Promise.all([
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-41", performedBy: "A" }),
      consumeInventoryForTest({ testId: 7, referenceKey: "REPORT-42", performedBy: "B" }),
    ]);
    expect(results.flatMap((r) => r.map((l) => l.error).filter(Boolean))).toEqual([]);
    const rows = consumeRows();
    expect(rows).toHaveLength(2);
    expect(Number(store.batches[0].qtyRemaining), "10 in the lot, 8 issued").toBe(2);
    const booked = rows.reduce((s, r) => s + Number(r.quantity), 0);
    expect(1 - stock(itemId), "the shelf moved by precisely what the ledger booked").toBe(booked);
  });
});
