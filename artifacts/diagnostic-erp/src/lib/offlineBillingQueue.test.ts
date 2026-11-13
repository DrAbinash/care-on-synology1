import { describe, expect, it, vi, afterEach } from "vitest";
import {
  appendToQueue,
  removeFromQueue,
  updateInQueue,
  sortQueueForReplay,
  replayQueue,
  announceQueuedBills,
  announceWithdrawnBills,
  deskAnnouncementManifest,
  discardQueuedBill,
  enqueueBill,
  flushQueuedBills,
  getQueuedBills,
  OFFLINE_BILL_QUEUE_KEY,
  QUARANTINED_QUEUE_PREFIX,
  type QueuedBill,
} from "./offlineBillingQueue";
import { api } from "./fetchApi";

function bill(clientRef: string, queuedAt: string, overrides: Partial<QueuedBill> = {}): QueuedBill {
  return {
    clientRef,
    queuedAt,
    stage: "order",
    orderBody: { patientId: 1 },
    billBody: { discount: 0 },
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

describe("appendToQueue / removeFromQueue / updateInQueue", () => {
  it("appends without mutating the input array", () => {
    const queue = [bill("a", "2026-01-01T00:00:00.000Z")];
    const next = appendToQueue(queue, bill("b", "2026-01-01T00:01:00.000Z"));
    expect(queue).toHaveLength(1);
    expect(next).toHaveLength(2);
  });

  it("removes only the matching clientRef", () => {
    const queue = [bill("a", "t1"), bill("b", "t2")];
    expect(removeFromQueue(queue, "a").map((q) => q.clientRef)).toEqual(["b"]);
  });

  it("patches only the matching entry, leaving others untouched", () => {
    const queue = [bill("a", "t1"), bill("b", "t2")];
    const next = updateInQueue(queue, "a", { attempts: 3, lastError: "boom" });
    expect(next.find((q) => q.clientRef === "a")).toMatchObject({ attempts: 3, lastError: "boom" });
    expect(next.find((q) => q.clientRef === "b")).toMatchObject({ attempts: 0, lastError: null });
  });
});

describe("sortQueueForReplay", () => {
  it("orders oldest queuedAt first regardless of input order", () => {
    const queue = [bill("c", "2026-01-03T00:00:00.000Z"), bill("a", "2026-01-01T00:00:00.000Z"), bill("b", "2026-01-02T00:00:00.000Z")];
    expect(sortQueueForReplay(queue).map((q) => q.clientRef)).toEqual(["a", "b", "c"]);
  });
});

describe("replayQueue", () => {
  it("returns the queue unchanged when empty", async () => {
    const postFn = vi.fn();
    const result = await replayQueue([], postFn);
    expect(result).toEqual({ queue: [], synced: 0, syncedBills: [], authFailed: false });
    expect(postFn).not.toHaveBeenCalled();
  });

  it("replays a single order-stage entry through /api/billing/save and removes it on success", async () => {
    const postFn = vi.fn(async (path: string) => {
      if (path === "/api/billing/save") {
        return { id: 900, billNumber: "BILL-900", orderId: 501, orderNumber: "ORD-501" };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const queue = [bill("ref-1", "2026-01-01T00:00:00.000Z")];
    const { queue: after, synced, syncedBills } = await replayQueue(queue, postFn as any);

    expect(synced).toBe(1);
    expect(syncedBills).toEqual([
      { clientRef: "ref-1", billId: 900, billNumber: "BILL-900", orderNumber: "ORD-501" },
    ]);
    expect(after).toEqual([]);
    expect(postFn).toHaveBeenCalledTimes(1);
    expect(postFn).toHaveBeenCalledWith(
      "/api/billing/save",
      expect.objectContaining({ patientId: 1, discount: 0, clientRef: "ref-1" }),
    );
  });

  it("falls back to legacy two-POST when /api/billing/save is missing", async () => {
    const postFn = vi.fn(async (path: string) => {
      if (path === "/api/billing/save") throw new Error("Cannot POST /api/billing/save (404)");
      if (path === "/api/orders") return { id: 501, orderNumber: "ORD-501" };
      if (path === "/api/bills?fast=1") return { id: 900, billNumber: "BILL-900" };
      throw new Error(`unexpected path ${path}`);
    });

    const queue = [bill("ref-1", "2026-01-01T00:00:00.000Z")];
    const { queue: after, synced } = await replayQueue(queue, postFn as any);
    expect(synced).toBe(1);
    expect(after).toEqual([]);
    expect(postFn).toHaveBeenNthCalledWith(1, "/api/billing/save", expect.any(Object));
    expect(postFn).toHaveBeenNthCalledWith(2, "/api/orders", expect.any(Object));
    expect(postFn).toHaveBeenNthCalledWith(3, "/api/bills?fast=1", expect.objectContaining({ orderId: 501 }));
  });

  it("skips one-shot for an entry already at the bill stage with a known orderId", async () => {
    const postFn = vi.fn(async (path: string) => {
      if (path === "/api/bills?fast=1") return { id: 900, billNumber: "BILL-900" };
      throw new Error(`unexpected path ${path}`);
    });

    const queue = [bill("ref-1", "2026-01-01T00:00:00.000Z", { stage: "bill", orderId: 501, orderNumber: "ORD-501" })];
    const { queue: after, synced } = await replayQueue(queue, postFn as any);

    expect(synced).toBe(1);
    expect(after).toEqual([]);
    expect(postFn).toHaveBeenCalledTimes(1);
    expect(postFn).toHaveBeenCalledWith("/api/bills?fast=1", expect.objectContaining({ orderId: 501, clientRef: "ref-1" }));
  });

  it("replays multiple entries in FIFO (queuedAt) order via one-shot save", async () => {
    const calls: string[] = [];
    const postFn = vi.fn(async (path: string, body: any) => {
      if (path === "/api/billing/save") {
        calls.push(`save:${body.clientRef}`);
        return { id: 1, billNumber: "B", orderId: 1, orderNumber: "O" };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const queue = [
      bill("second", "2026-01-02T00:00:00.000Z"),
      bill("first", "2026-01-01T00:00:00.000Z"),
    ];
    const { synced } = await replayQueue(queue, postFn as any);

    expect(synced).toBe(2);
    expect(calls).toEqual(["save:first", "save:second"]);
  });

  it("BUG SCENARIO: stops at the first failure, preserving FIFO order for untried later entries", async () => {
    const postFn = vi.fn(async (path: string, body: any) => {
      if (path === "/api/billing/save") {
        if (body.clientRef === "third") throw new Error("should never be called");
        if (body.clientRef === "first") {
          return { id: 10, billNumber: "B-first", orderId: 1, orderNumber: "O-first" };
        }
        throw new Error("NAS unreachable");
      }
      throw new Error(`unexpected path ${path}`);
    });

    const queue = [
      bill("first", "2026-01-01T00:00:00.000Z"),
      bill("second", "2026-01-02T00:00:00.000Z"),
      bill("third", "2026-01-03T00:00:00.000Z"),
    ];
    const { queue: after, synced } = await replayQueue(queue, postFn as any);

    expect(synced).toBe(1);
    expect(after.map((q) => q.clientRef)).toEqual(["second", "third"]);

    const second = after.find((q) => q.clientRef === "second")!;
    expect(second.stage).toBe("order");
    expect(second.attempts).toBe(1);
    expect(second.lastError).toBe("NAS unreachable");

    const third = after.find((q) => q.clientRef === "third")!;
    expect(third.stage).toBe("order");
    expect(third.attempts).toBe(0);
    expect(third.lastError).toBeNull();
  });

  it("a department-independent replay never reorders — later entries keep their original queuedAt even after a partial flush", async () => {
    const postFn = vi.fn(async (_path: string, body: any) => {
      if (body.clientRef === "b") throw new Error("still offline");
      return { id: 1, billNumber: "B", orderId: 1, orderNumber: "O" };
    });

    const queue = [bill("a", "t1"), bill("b", "t2"), bill("c", "t3")];
    const { queue: after } = await replayQueue(queue, postFn as any);
    expect(after.map((q) => q.clientRef)).toEqual(["b", "c"]);
    expect(after.map((q) => q.queuedAt)).toEqual(["t2", "t3"]);
  });

  it("marks authFailed on HttpError 401 so callers can pause instead of treating the API as down", async () => {
    const { HttpError } = await import("./fetchApi");
    const postFn = vi.fn(async () => {
      throw new HttpError("Staff authentication required", 401);
    });
    const queue = [bill("ref-1", "2026-01-01T00:00:00.000Z")];
    const { queue: after, synced, authFailed } = await replayQueue(queue, postFn as any);
    expect(synced).toBe(0);
    expect(authFailed).toBe(true);
    expect(after[0]?.lastError).toBe("Staff authentication required");
  });
});

/**
 * The witness announcement — the half that decides whether the clinic ever
 * learns that a desk printed a bill the ledger has not received.
 */

/**
 * A minimal browser for the storage-backed half: the queue key, a hostname for
 * the workstation field, and the two event types the module dispatches. The
 * root vitest config runs this file under `environment: "node"`, so `window`
 * has to be installed rather than assumed.
 */
function installFakeBrowser(opts: { storageFails?: boolean } = {}) {
  const store = new Map<string, string>();
  const dispatched: Array<{ type: string }> = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        if (opts.storageFails) throw new Error("QuotaExceededError: this browser will not take the write");
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
    location: { hostname: "billing-pc-1", origin: "http://billing-pc-1:8888" },
    dispatchEvent: (event: { type: string }) => {
      dispatched.push(event);
      return true;
    },
  });
  vi.stubGlobal(
    "StorageEvent",
    class {
      type: string;
      key: string | null;
      newValue: string | null;
      constructor(type: string, init: { key?: string | null; newValue?: string | null } = {}) {
        this.type = type;
        this.key = init.key ?? null;
        this.newValue = init.newValue ?? null;
      }
    },
  );
  vi.stubGlobal(
    "CustomEvent",
    class {
      type: string;
      detail: unknown;
      constructor(type: string, init: { detail?: unknown } = {}) {
        this.type = type;
        this.detail = init.detail ?? null;
      }
    },
  );
  return { store, dispatched };
}

/** The announce route, spelled out once so a renamed path shows up as a failure here. */
const ANNOUNCE_PATH = "/api/desk-bills/announcements";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deskAnnouncementManifest", () => {
  it("carries the printed totals the replay payload does not contain", () => {
    const queue = [
      bill("ref-1", "2026-01-01T00:00:00.000Z", {
        provisionalBillNumber: "OFF-20261113-1",
        orderBody: { patientId: 42, tests: [1, 2, 3] },
        // The grand total is the desk's React state, not something the saved
        // request bodies can be re-derived from.
        witness: { patientId: 42, testCount: 3, totalAmount: 1250 },
        lastError: "Failed to fetch",
      }),
    ];
    expect(deskAnnouncementManifest(queue, "billing-pc-1")).toEqual([
      {
        clientRef: "ref-1",
        state: "pending",
        provisionalBillNumber: "OFF-20261113-1",
        patientId: 42,
        testCount: 3,
        totalAmount: 1250,
        workstation: "billing-pc-1",
        lastError: "Failed to fetch",
      },
    ]);
  });

  // Entries queued by an older build have no `witness`. Falling back to the
  // request bodies is honest for what they actually hold and says nothing at
  // all for the money — an invented amount would misreport the drawer.
  it("falls back to what the bodies really contain and reports no amount rather than a guessed one", () => {
    const [item] = deskAnnouncementManifest(
      [bill("ref-1", "t1", { orderBody: { patientId: 7, testIds: [11, 12] }, billBody: { discount: 0 } })],
      "billing-pc-1",
    );
    expect(item).toMatchObject({ patientId: 7, testCount: 2, totalAmount: 0, state: "pending" });
  });

  it("says 0 tests rather than undefined when a body has neither shape", () => {
    const [item] = deskAnnouncementManifest([bill("ref-1", "t1", { orderBody: {} })], null);
    expect(item.testCount).toBe(0);
    expect(item.workstation).toBeNull();
  });

  it("is oldest-first, like the replay it precedes", () => {
    const queue = [
      bill("third", "2026-01-03T00:00:00.000Z"),
      bill("first", "2026-01-01T00:00:00.000Z"),
      bill("second", "2026-01-02T00:00:00.000Z"),
    ];
    expect(deskAnnouncementManifest(queue, null).map((i) => i.clientRef)).toEqual(["first", "second", "third"]);
  });

  it("calls a half-replayed bill pending too — only a real bill closes a witness", () => {
    const [item] = deskAnnouncementManifest(
      [bill("ref-1", "t1", { stage: "bill", orderId: 501, orderNumber: "ORD-501" })],
      null,
    );
    expect(item.state).toBe("pending");
  });
});

describe("announceQueuedBills / announceWithdrawnBills", () => {
  it("posts the manifest to the witness route", async () => {
    const postFn = vi.fn(async () => ({ ok: true, accepted: 1 }));
    await announceQueuedBills([bill("ref-1", "t1", { provisionalBillNumber: "OFF-1" })], postFn as any);
    expect(postFn).toHaveBeenCalledTimes(1);
    expect(postFn.mock.calls[0][0]).toBe(ANNOUNCE_PATH);
    expect(postFn.mock.calls[0][1]).toMatchObject({
      items: [expect.objectContaining({ clientRef: "ref-1", provisionalBillNumber: "OFF-1" })],
    });
  });

  it("announces nothing at all for an empty queue, so an idle desk does not POST every 5 seconds", async () => {
    const postFn = vi.fn(async () => ({ ok: true, accepted: 0 }));
    await announceQueuedBills([], postFn as any);
    expect(postFn).not.toHaveBeenCalled();
  });

  // This runs on the tick that then replays real bills, so it must never become
  // a reason to stop — and it must not surface as a desk error either.
  it("swallows a failed announcement instead of breaking the workflow", async () => {
    const postFn = vi.fn(async () => {
      throw new Error("503 Service Unavailable");
    });
    await expect(announceQueuedBills([bill("ref-1", "t1")], postFn as any)).resolves.toBeUndefined();
  });

  it("withdraws by clientRef, including one the desk has already thrown away", async () => {
    const postFn = vi.fn(async () => ({ ok: true, accepted: 2 }));
    await announceWithdrawnBills(["gone-1", "gone-2"], postFn as any);
    const body = postFn.mock.calls[0][1] as { items: Array<{ clientRef: string; state: string }> };
    expect(body.items.map((i) => i.clientRef)).toEqual(["gone-1", "gone-2"]);
    expect(body.items.every((i) => i.state === "withdrawn")).toBe(true);
  });

  it("a failed withdrawal does not throw back at the Discard button", async () => {
    const postFn = vi.fn(async () => {
      throw new Error("NetworkError");
    });
    await expect(announceWithdrawnBills(["gone-1"], postFn as any)).resolves.toBeUndefined();
  });
});

describe("flushQueuedBills — the announcement comes first", () => {
  it("announces before it replays, and leaves the queue empty afterwards", async () => {
    const { store } = installFakeBrowser();
    store.set(
      OFFLINE_BILL_QUEUE_KEY,
      JSON.stringify([bill("ref-1", "2026-01-01T00:00:00.000Z", { witness: { totalAmount: 400, testCount: 1 } })]),
    );
    const paths: string[] = [];
    const postFn = vi.fn(async (path: string) => {
      paths.push(path);
      return { id: 900, billNumber: "BILL-900", orderId: 501, orderNumber: "ORD-501" };
    });

    const res = await flushQueuedBills(postFn as any);

    // The order is the whole feature: announcing after the replay would record
    // nothing on precisely the tick that fails.
    expect(paths).toEqual([ANNOUNCE_PATH, "/api/billing/save"]);
    expect(res.synced).toBe(1);
    expect(res.remaining).toBe(0);
    expect(JSON.parse(store.get(OFFLINE_BILL_QUEUE_KEY)!)).toEqual([]);
  });

  // The case this exists for: the replay fails, so the bill stays queued — and
  // the witness is now on the server even though nothing was ever delivered.
  it("still announces first when the replay fails, and keeps the entry queued", async () => {
    const { store } = installFakeBrowser();
    store.set(OFFLINE_BILL_QUEUE_KEY, JSON.stringify([bill("ref-1", "2026-01-01T00:00:00.000Z")]));
    const paths: string[] = [];
    const postFn = vi.fn(async (path: string) => {
      paths.push(path);
      if (path === ANNOUNCE_PATH) return { ok: true, accepted: 1 };
      throw new Error("NAS unreachable");
    });

    const res = await flushQueuedBills(postFn as any);

    expect(paths[0]).toBe(ANNOUNCE_PATH);
    expect(res.remaining).toBe(1);
    const queued = JSON.parse(store.get(OFFLINE_BILL_QUEUE_KEY)!) as QueuedBill[];
    expect(queued[0]).toMatchObject({ clientRef: "ref-1", attempts: 1, lastError: "NAS unreachable" });
  });

  it("an announcement the server refused does not stop the bills from being replayed", async () => {
    const { store } = installFakeBrowser();
    store.set(OFFLINE_BILL_QUEUE_KEY, JSON.stringify([bill("ref-1", "2026-01-01T00:00:00.000Z")]));
    const postFn = vi.fn(async (path: string) => {
      if (path === ANNOUNCE_PATH) throw new Error("NetworkError");
      return { id: 900, billNumber: "BILL-900", orderId: 501, orderNumber: "ORD-501" };
    });

    const res = await flushQueuedBills(postFn as any);
    expect(res.synced).toBe(1);
    expect(res.remaining).toBe(0);
  });
});

describe("queue durability", () => {
  it("reports stored:true and survives a reload with its witness intact", () => {
    const { store } = installFakeBrowser();
    const queued = enqueueBill({
      clientRef: "ref-1",
      orderBody: { patientId: 42, tests: [1] },
      billBody: { discount: 0 },
      provisionalBillNumber: "OFF-20261113-1",
      witness: { patientId: 42, testCount: 1, totalAmount: 400 },
    });

    expect(queued.stored).toBe(true);
    expect(getQueuedBills().map((q) => q.clientRef)).toEqual(["ref-1"]);
    expect(JSON.parse(store.get(OFFLINE_BILL_QUEUE_KEY)!)[0].witness).toEqual({
      patientId: 42,
      testCount: 1,
      totalAmount: 400,
    });
  });

  // The fail-closed door: `stored:false` is what tells the desk it may NOT print
  // a provisional receipt, because nothing will ever replay it.
  it("reports stored:false when the browser will not take the write", () => {
    installFakeBrowser({ storageFails: true });
    const queued = enqueueBill({
      clientRef: "ref-1",
      orderBody: { patientId: 42 },
      billBody: { discount: 0 },
      witness: { patientId: 42, testCount: 1, totalAmount: 400 },
    });
    expect(queued.stored).toBe(false);
  });

  // readQueue used to answer [] and the next write overwrote the unreadable
  // text, so an outage's worth of bills vanished with no bytes left behind.
  it("keeps an unparseable queue blob instead of letting the next write destroy it", () => {
    const { store } = installFakeBrowser();
    const garbage = '{"not":"a queue"';
    store.set(OFFLINE_BILL_QUEUE_KEY, garbage);

    expect(getQueuedBills()).toEqual([]);
    expect(store.has(OFFLINE_BILL_QUEUE_KEY)).toBe(false);
    const kept = [...store.keys()].find((k) => k.startsWith(QUARANTINED_QUEUE_PREFIX));
    expect(kept).toBeTruthy();
    expect(store.get(kept!)).toBe(garbage);
  });

  it("quarantines a blob that parses but is not a queue", () => {
    const { store } = installFakeBrowser();
    store.set(OFFLINE_BILL_QUEUE_KEY, JSON.stringify({ bills: [] }));

    expect(getQueuedBills()).toEqual([]);
    expect([...store.keys()].some((k) => k.startsWith(QUARANTINED_QUEUE_PREFIX))).toBe(true);
  });

  // The control for the two cases above: a normal empty queue must not be
  // treated as damage.
  it("leaves a valid empty queue exactly where it is", () => {
    const { store } = installFakeBrowser();
    store.set(OFFLINE_BILL_QUEUE_KEY, "[]");

    expect(getQueuedBills()).toEqual([]);
    expect([...store.keys()]).toEqual([OFFLINE_BILL_QUEUE_KEY]);
  });

  // Left in place, every 5-second sync tick would quarantine another copy of
  // the same text until the quota filled up.
  it("quarantines once, not on every sync tick", () => {
    const { store } = installFakeBrowser();
    store.set(OFFLINE_BILL_QUEUE_KEY, "not json at all");

    getQueuedBills();
    getQueuedBills();
    getQueuedBills();

    expect([...store.keys()].filter((k) => k.startsWith(QUARANTINED_QUEUE_PREFIX))).toHaveLength(1);
  });

  it("discard removes the entry and withdraws its witness on the real API path", async () => {
    installFakeBrowser();
    enqueueBill({ clientRef: "ref-1", orderBody: { patientId: 1 }, billBody: {} });
    enqueueBill({ clientRef: "ref-2", orderBody: { patientId: 2 }, billBody: {} });
    const post = vi.spyOn(api, "post").mockImplementation(async () => ({}) as never);

    discardQueuedBill("ref-1");
    expect(getQueuedBills().map((q) => q.clientRef)).toEqual(["ref-2"]);

    // Fire-and-forget by design, so the click does not wait on the network —
    // which means the call is only observable a microtask later.
    await new Promise((r) => setTimeout(r, 0));
    const call = post.mock.calls.find(([path]) => path === ANNOUNCE_PATH);
    expect(call).toBeTruthy();
    expect((call![1] as { items: Array<{ clientRef: string; state: string }> }).items).toEqual([
      expect.objectContaining({ clientRef: "ref-1", state: "withdrawn" }),
    ]);
    // The remaining queue is NOT re-announced by a discard, and the discarded
    // ref is named even though it is no longer in the queue.
    expect((call![1] as { items: unknown[] }).items).toHaveLength(1);
  });
});
