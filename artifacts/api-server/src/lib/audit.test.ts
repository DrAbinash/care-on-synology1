import { describe, it, expect, vi, beforeEach } from "vitest";

// audit.ts imports `db` from @workspace/db, which throws at import time when
// DATABASE_URL is unset — so we mock it (same pattern as closureBoundary /
// day-close tests). Here the mock is a small in-memory Postgres stand-in that
// faithfully models `pg_advisory_xact_lock`: a transaction-scoped mutex that is
// acquired by tx.execute() and released when the transaction ends. That lets us
// prove the concurrency fix (E0.2 / CRIT-2) deterministically, with no live DB.
const h = vi.hoisted(() => {
  const store = {
    rows: [] as Array<{ id: number; previousHash: string; chainHash: string; [k: string]: unknown }>,
    nextId: 1,
    honorLock: true, // flip to false for the negative-control test
    locked: false,
    queue: [] as Array<() => void>,
    ops: [] as string[], // records lock/select/insert ordering
  };

  // Yield to the macrotask queue so concurrent auditLog() calls actually
  // interleave at read/insert points (that interleaving is what forks the chain
  // when the lock is absent).
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  // Ownership-handoff mutex (no window where `locked` is false while waiters
  // exist), modelling xact-scoped advisory-lock semantics.
  function release() {
    const next = store.queue.shift();
    if (next) next();
    else store.locked = false;
  }
  async function acquire(): Promise<() => void> {
    if (!store.honorLock) return () => {};
    if (store.locked) await new Promise<void>((resolve) => store.queue.push(resolve));
    else store.locked = true;
    return release;
  }

  function selectBuilder() {
    const orderByResult = {
      // auditLog: .limit(1) → last row; verifyAuditChain window: .limit(n) → last n desc
      limit: async (n: number) => {
        store.ops.push("select");
        await tick();
        return store.rows.slice(-n).reverse();
      },
      // verifyAuditChain full-chain: awaited directly → all rows, ascending
      then: (resolve: (v: unknown) => void) => resolve(store.rows.slice()),
    };
    return { from: () => ({ orderBy: () => orderByResult }) };
  }

  function insertBuilder() {
    return {
      values: async (v: Record<string, unknown>) => {
        store.ops.push("insert");
        await tick();
        store.rows.push({ id: store.nextId++, previousHash: "", chainHash: "", ...v } as never);
      },
    };
  }

  const db = {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      let unlock: () => void = () => {};
      const tx = {
        execute: async () => {
          store.ops.push("lock-req");
          unlock = await acquire();
          store.ops.push("lock-held");
        },
        select: () => selectBuilder(),
        insert: () => insertBuilder(),
      };
      try {
        return await cb(tx);
      } finally {
        unlock();
      }
    },
    select: () => selectBuilder(),
    insert: () => insertBuilder(),
  };

  return {
    store,
    mod: {
      db,
      auditLogsTable: { id: "id", chainHash: "chainHash", previousHash: "previousHash" },
    },
  };
});

vi.mock("@workspace/db", () => h.mod);
// Keep the real `sql` (needed to build the advisory-lock statement); the mock
// ignores ordering, so asc/desc can be reduced to identity.
vi.mock("drizzle-orm", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, asc: (c: unknown) => c, desc: (c: unknown) => c };
});

import { auditLog, verifyChainRows, verifyAuditChain, computeChainHash, type AuditChainRow } from "./audit";

beforeEach(() => {
  h.store.rows = [];
  h.store.nextId = 1;
  h.store.honorLock = true;
  h.store.locked = false;
  h.store.queue = [];
  h.store.ops = [];
});

describe("computeChainHash", () => {
  it("is deterministic, 64-hex, and collision-sensitive", () => {
    expect(computeChainHash("x")).toBe(computeChainHash("x"));
    expect(computeChainHash("x")).toMatch(/^[0-9a-f]{64}$/);
    expect(computeChainHash("x")).not.toBe(computeChainHash("y"));
    // known SHA-256("x") vector — pins the (unchanged) hashing recipe
    expect(computeChainHash("x")).toBe(
      "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
    );
  });
});

describe("verifyChainRows (pure link-continuity verifier)", () => {
  const linked = (id: number, prev: string, hash: string): AuditChainRow => ({
    id,
    previousHash: prev,
    chainHash: hash,
  });

  it("accepts an empty set and a valid linear chain", () => {
    expect(verifyChainRows([]).ok).toBe(true);
    const rows = [linked(1, "", "a"), linked(2, "a", "b"), linked(3, "b", "c")];
    expect(verifyChainRows(rows)).toEqual({ ok: true, checked: 3, firstBrokenId: null, reason: null });
  });

  it("flags a non-empty genesis previousHash", () => {
    const res = verifyChainRows([linked(1, "seeded", "a")]);
    expect(res.ok).toBe(false);
    expect(res.firstBrokenId).toBe(1);
    expect(res.reason).toMatch(/genesis/);
  });

  it("flags a fork / gap at the first mismatching row", () => {
    // rows 2 and 3 both point at "a" (the shape a concurrent double-read produces)
    const rows = [linked(1, "", "a"), linked(2, "a", "b"), linked(3, "a", "c")];
    const res = verifyChainRows(rows);
    expect(res.ok).toBe(false);
    expect(res.firstBrokenId).toBe(3);
    expect(res.checked).toBe(2);
  });

  it("accepts a tail window whose first row legitimately links to an out-of-window predecessor", () => {
    const tail = [linked(9, "h8", "h9"), linked(10, "h9", "h10")];
    expect(verifyChainRows(tail, { window: true }).ok).toBe(true);
    expect(verifyChainRows(tail).ok).toBe(false); // without window, "h8" != ""
  });
});

describe("auditLog concurrency safety (E0.2 / CRIT-2)", () => {
  it("takes the advisory lock before reading, then inserts — all in one transaction", async () => {
    await auditLog({ userId: 1, userName: "dr", role: "radiologist", action: "finalize", module: "radiology" });
    const held = h.store.ops.indexOf("lock-held");
    const read = h.store.ops.indexOf("select");
    const ins = h.store.ops.indexOf("insert");
    expect(held).toBeGreaterThanOrEqual(0);
    expect(held).toBeLessThan(read);
    expect(read).toBeLessThan(ins);
    expect(h.store.rows).toHaveLength(1);
    expect(h.store.rows[0].previousHash).toBe(""); // genesis
  });

  it("produces a single unbroken chain under 50 concurrent writers", async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        auditLog({ userId: i, userName: "u", role: "system", action: "edit", module: "reports", entityId: String(i) }),
      ),
    );
    expect(h.store.rows).toHaveLength(50);
    const rows = h.store.rows.map((r) => ({ id: r.id, previousHash: r.previousHash, chainHash: r.chainHash }));
    expect(verifyChainRows(rows)).toMatchObject({ ok: true, checked: 50 });
    // Every previousHash is distinct (one "" genesis + 49 unique predecessors) —
    // i.e. no two writers shared a previousHash, so the chain never forked.
    expect(new Set(rows.map((r) => r.previousHash)).size).toBe(50);
  });

  it("NEGATIVE CONTROL: with the lock disabled, concurrent writers fork the chain", async () => {
    h.store.honorLock = false;
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        auditLog({ userId: i, userName: "u", role: "system", action: "edit", module: "reports", entityId: String(i) }),
      ),
    );
    const rows = h.store.rows.map((r) => ({ id: r.id, previousHash: r.previousHash, chainHash: r.chainHash }));
    const res = verifyChainRows(rows);
    expect(res.ok).toBe(false); // this is exactly what the advisory lock prevents
  });

  it("is fire-and-forget and preserves the existing row format (65535-char truncation)", async () => {
    await expect(
      auditLog({ userName: "x", role: "system", action: "login", module: "system", newValue: "y".repeat(70000) }),
    ).resolves.toBeUndefined();
    // oldValue/newValue are still truncated to 65535 inside the locked transaction
    expect(String(h.store.rows[0].newValue)).toHaveLength(65535);
  });
});

describe("verifyAuditChain (db-backed wrapper)", () => {
  it("verifies the whole chain and a recent-N window", async () => {
    h.store.rows = [
      { id: 1, previousHash: "", chainHash: "a" },
      { id: 2, previousHash: "a", chainHash: "b" },
      { id: 3, previousHash: "b", chainHash: "c" },
    ];
    h.store.nextId = 4;
    expect(await verifyAuditChain()).toMatchObject({ ok: true, checked: 3 });
    expect(await verifyAuditChain({ limit: 2 })).toMatchObject({ ok: true, checked: 2 });
  });
});
