import { describe, it, expect } from "vitest";
import {
  withClientRef, buildEntry, enqueue, pendingEntries, countPending,
  replayOutbox, submitWithOutbox, createMemoryOutboxStore,
  type OutboxEntry, type OutboxStore,
} from "./offlineOutbox";

let seq = 0;
const refGen = () => `cr_${++seq}`;
const clock = (t: number) => () => t;

function makeStore(seed: OutboxEntry[] = []): OutboxStore {
  return createMemoryOutboxStore(seed);
}

describe("withClientRef", () => {
  it("keeps an existing clientRef, else generates one", () => {
    expect(withClientRef({ amount: 300, clientRef: "keep" }).clientRef).toBe("keep");
    const gen = withClientRef({ amount: 300 }, () => "new-ref");
    expect(gen.clientRef).toBe("new-ref");
    expect(gen.body.clientRef).toBe("new-ref");
  });
  it("wraps a non-object payload", () => {
    const r = withClientRef(42, () => "x");
    expect(r.body).toEqual({ value: 42, clientRef: "x" });
  });
});

describe("buildEntry", () => {
  it("uses the clientRef as the id and embeds it in the payload", () => {
    const e = buildEntry({ endpoint: "/api/bills", payload: { amount: 300 }, label: "Bill", now: clock(1000), newRef: () => "cr_1" });
    expect(e.id).toBe("cr_1");
    expect((e.payload as any).clientRef).toBe("cr_1");
    expect(e.createdAt).toBe(1000);
    expect(e.status).toBe("pending");
    expect(e.method).toBe("POST");
  });
});

describe("enqueue / pendingEntries / countPending", () => {
  it("orders pending entries FIFO by createdAt and ignores failed", async () => {
    const store = makeStore();
    await enqueue(store, buildEntry({ endpoint: "/api/bills", payload: {}, label: "B", now: clock(300), newRef: () => "c" }));
    await enqueue(store, buildEntry({ endpoint: "/api/bills", payload: {}, label: "A", now: clock(100), newRef: () => "a" }));
    await enqueue(store, buildEntry({ endpoint: "/api/bills", payload: {}, label: "M", now: clock(200), newRef: () => "m" }));
    await store.put({ ...buildEntry({ endpoint: "/api/bills", payload: {}, label: "F", newRef: () => "f" }), status: "failed" });
    const order = (await pendingEntries(store)).map((e) => e.label);
    expect(order).toEqual(["A", "M", "B"]);
    expect(await countPending(store)).toBe(3);
  });
});

describe("replayOutbox", () => {
  const mk = (id: string, t: number): OutboxEntry => buildEntry({ endpoint: "/api/bills", payload: { n: id }, label: id, now: clock(t), newRef: () => id });

  it("sends FIFO and removes on success", async () => {
    const store = makeStore([mk("b", 200), mk("a", 100)]);
    const sent: string[] = [];
    const res = await replayOutbox(store, async (e) => { sent.push(e.id); });
    expect(sent).toEqual(["a", "b"]); // FIFO
    expect(res.synced).toBe(2);
    expect(res.remaining).toBe(0);
    expect(await countPending(store)).toBe(0);
  });

  it("stops on a transient error, leaving that and later entries queued", async () => {
    const store = makeStore([mk("a", 100), mk("b", 200), mk("c", 300)]);
    const res = await replayOutbox(store, async (e) => {
      if (e.id === "b") throw new Error("Failed to fetch"); // transient
    }, { now: clock(999) });
    expect(res.synced).toBe(1);          // only "a"
    expect(res.stoppedTransient).toBe(true);
    expect(res.remaining).toBe(2);       // b and c still pending
    const b = (await store.getAll()).find((e) => e.id === "b")!;
    expect(b.status).toBe("pending");
    expect(b.attempts).toBe(1);
    expect(b.lastError).toMatch(/failed to fetch/i);
  });

  it("marks a permanent (4xx) failure as failed and continues past it", async () => {
    const store = makeStore([mk("a", 100), mk("b", 200), mk("c", 300)]);
    const sent: string[] = [];
    const res = await replayOutbox(store, async (e) => {
      if (e.id === "b") throw new Error("Invalid request: amount must be positive"); // permanent
      sent.push(e.id);
    });
    expect(sent).toEqual(["a", "c"]);     // b skipped, c still processed
    expect(res.synced).toBe(2);
    expect(res.failedPermanent).toBe(1);
    expect(res.remaining).toBe(0);        // b is "failed", not pending
    const b = (await store.getAll()).find((e) => e.id === "b")!;
    expect(b.status).toBe("failed");
  });

  it("respects the max cap", async () => {
    const store = makeStore([mk("a", 100), mk("b", 200), mk("c", 300)]);
    const res = await replayOutbox(store, async () => {}, { max: 2 });
    expect(res.synced).toBe(2);
    expect(res.remaining).toBe(1);
  });
});

describe("submitWithOutbox", () => {
  it("returns sent on success and does not touch the store", async () => {
    const store = makeStore();
    const r = await submitWithOutbox<{ id: number }>({
      store, endpoint: "/api/bills", payload: { amount: 300 }, label: "Bill", newRef: () => "cr_x",
      send: async (_e, _m, body) => { expect(body.clientRef).toBe("cr_x"); return { id: 7 }; },
    });
    expect(r.status).toBe("sent");
    expect(r.data).toEqual({ id: 7 });
    expect(await countPending(store)).toBe(0);
  });

  it("queues on a transient failure with a stable clientRef", async () => {
    const store = makeStore();
    const r = await submitWithOutbox({
      store, endpoint: "/api/bills", payload: { amount: 300 }, label: "Bill • ₹300", now: clock(1234), newRef: () => "cr_y",
      send: async () => { throw new Error("No internet connection — waiting for network to return."); },
    });
    expect(r.status).toBe("queued");
    expect(r.clientRef).toBe("cr_y");
    expect(r.entry?.label).toBe("Bill • ₹300");
    expect(await countPending(store)).toBe(1);
    const queued = (await store.getAll())[0]!;
    expect((queued.payload as any).clientRef).toBe("cr_y");
  });

  it("re-throws a permanent failure and does NOT queue it", async () => {
    const store = makeStore();
    await expect(submitWithOutbox({
      store, endpoint: "/api/bills", payload: { amount: -1 }, label: "Bad bill", newRef: () => "cr_z",
      send: async () => { throw new Error("Invalid request: amount must be positive"); },
    })).rejects.toThrow(/amount must be positive/);
    expect(await countPending(store)).toBe(0);
  });

  it("round-trips: a queued bill later replays exactly once", async () => {
    const store = makeStore();
    // 1) offline submit → queued
    await submitWithOutbox({
      store, endpoint: "/api/bills", payload: { amount: 300 }, label: "Bill", newRef: () => "cr_rt",
      send: async () => { throw new Error("Failed to fetch"); },
    });
    expect(await countPending(store)).toBe(1);
    // 2) back online → replay succeeds, dedupe-safe on clientRef
    const seen: string[] = [];
    const res = await replayOutbox(store, async (e) => { seen.push((e.payload as any).clientRef); });
    expect(seen).toEqual(["cr_rt"]);
    expect(res.synced).toBe(1);
    expect(await countPending(store)).toBe(0);
  });
});

describe("createMemoryOutboxStore", () => {
  it("puts, gets and deletes", async () => {
    const store = makeStore();
    const e = buildEntry({ endpoint: "/api/orders", payload: {}, label: "O", newRef: refGen });
    await store.put(e);
    expect((await store.getAll()).length).toBe(1);
    await store.delete(e.id);
    expect((await store.getAll()).length).toBe(0);
  });
});
