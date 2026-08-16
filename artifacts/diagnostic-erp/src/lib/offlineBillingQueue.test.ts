import { describe, expect, it, vi } from "vitest";
import {
  appendToQueue,
  removeFromQueue,
  updateInQueue,
  sortQueueForReplay,
  replayQueue,
  type QueuedBill,
} from "./offlineBillingQueue";

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
