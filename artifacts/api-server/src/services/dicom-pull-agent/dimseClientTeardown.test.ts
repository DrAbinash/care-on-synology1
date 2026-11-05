/**
 * Regression suite for the DIMSE teardown crash (production care-api exits).
 *
 * Measured fault: dcmjs-dimse 0.3.3 `Client` has no `close()` — that method belongs
 * to `Server`. dimse-agent's three `finish()` bodies called `client.close()`, and
 * two of the three arms are `setTimeout` callbacks, where a throw surfaces as an
 * `uncaughtException`; the API handler (index.ts) logs it and calls process.exit(1).
 * Production evidence: 7 x "client2.close is not a function" in 14 hours of the
 * care-api log, against RestartCount 9 (= 7 TypeErrors + 2 heap OOMs).
 *
 * Coverage split, stated honestly: C-ECHO is exercised behaviourally end to end
 * because it is the exported call site; C-FIND and C-MOVE are module-private and
 * unreachable without a live modality, so their three identical arms are pinned by
 * the source contract (group C) plus the shared helper's own tests (group D).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const agentSource = readFileSync(join(here, "dimse-agent.ts"), "utf8");

// Short enough that a whole "repeated failures" battery costs milliseconds; the
// module reads this at import time, so it is set before the dynamic import below.
const TIMEOUT_MS = 20;

const harness = vi.hoisted(() => {
  const made: Array<Record<string, any>> = [];
  const status = { Success: 0, Pending: 65280, Cancel: 65283 };

  class FakeRequest {
    handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    on(ev: string, cb: (...a: unknown[]) => void): void {
      const list = this.handlers.get(ev) ?? [];
      list.push(cb);
      this.handlers.set(ev, list);
    }
    emit(ev: string, ...args: unknown[]): void {
      for (const cb of this.handlers.get(ev) ?? []) cb(...args);
    }
    toString(): string {
      return "FakeRequest";
    }
  }

  // Mirrors the pinned Client: addRequest / clearRequests / send / abort / cancel /
  // getStatistics — and deliberately NO close(), exactly like dcmjs-dimse 0.3.3.
  class FakeClient {
    requests: Array<Record<string, any>> = [];
    handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    addCalls = 0;
    sendCalls = 0;
    abortCalls = 0;
    clearRequestsCalls = 0;
    /** dcmjs-dimse abort() throws once the socket is gone — the normal state on a timeout. */
    abortThrows = false;
    constructor() {
      made.push(this);
    }
    on(ev: string, cb: (...a: unknown[]) => void): void {
      const list = this.handlers.get(ev) ?? [];
      list.push(cb);
      this.handlers.set(ev, list);
    }
    emit(ev: string, ...args: unknown[]): void {
      for (const cb of this.handlers.get(ev) ?? []) cb(...args);
    }
    addRequest(request: Record<string, any>): void {
      this.addCalls += 1;
      this.requests.push(request);
    }
    clearRequests(): void {
      this.clearRequestsCalls += 1;
      this.requests.length = 0;
    }
    send(_host: string, _port: number, _calling: string, _called: string): void {
      this.sendCalls += 1;
    }
    abort(): void {
      this.abortCalls += 1;
      if (this.abortThrows) throw new Error("Network has not been initialized");
    }
    cancel(): void {
      /* present, not used by these three paths */
    }
    getStatistics(): Record<string, number> {
      return { bytesReceived: 0, bytesSent: 0 };
    }
    /** Drive the peer's C-ECHO/C-FIND/C-MOVE response through the registered handler. */
    respondWith(st: number, extra: Record<string, unknown> = {}): void {
      const response = {
        getStatus: () => st,
        hasDataset: () => false,
        getDataset: () => null,
        getRemaining: () => 0,
        getCompleted: () => 0,
        getFailures: () => 0,
        ...extra,
      };
      (this.requests[0] as Record<string, any>).emit("response", response);
    }
    failNetwork(message: string): void {
      this.emit("networkError", new Error(message));
    }
  }

  const module = {
    Client: FakeClient,
    requests: {
      CEchoRequest: class extends FakeRequest {},
      CFindRequest: {
        createStudyFindRequest: (_q: Record<string, unknown>) => new FakeRequest(),
      },
      CMoveRequest: {
        createStudyMoveRequest: (_dest: string, _uid: string) => new FakeRequest(),
      },
    },
    constants: { Status: status, AbortSource: { ServiceUser: 0, ServiceProvider: 2 } },
  };

  return {
    made,
    status,
    module,
    last: (): Record<string, any> => made[made.length - 1] as Record<string, any>,
    reset(): void {
      made.length = 0;
    },
  };
});

// The agent reads exactly these three names off the module: Client, requests, constants.
vi.mock("dcmjs-dimse", () => ({
  default: harness.module,
  ...harness.module,
}));

const NODE = { host: "10.255.255.1", port: 104, aeTitle: "FILMPLUS", modality: "DX" } as const;

type Agent = typeof import("./dimse-agent");

let agent: Agent;
let uncaught: unknown[] = [];

function uncaughtListener(err: unknown): void {
  uncaught.push(err);
}

beforeAll(async () => {
  process.env["DIMSE_TIMEOUT_MS"] = String(TIMEOUT_MS);
  delete process.env["CARE_DEV_ISOLATED"];
  agent = await import("./dimse-agent");
});

beforeEach(() => {
  harness.reset();
  uncaught = [];
  process.on("uncaughtException", uncaughtListener);
});

afterEach(() => {
  process.removeListener("uncaughtException", uncaughtListener);
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A never-resolving promise is itself the crash signature (the throw happens before
 * resolve()), so this reports "PENDING" instead of hanging the suite.
 */
const settle = async <T>(p: Promise<T>, ms: number): Promise<T | "PENDING"> =>
  Promise.race([p, sleep(ms).then(() => "PENDING" as const)]);

/**
 * The agent awaits its lazy `import("dcmjs-dimse")` before constructing the Client,
 * so one tick has to pass before the call's client is observable. `DIMSE_TIMEOUT_MS`
 * is 20 ms here, so the timeout cannot have fired in that tick.
 */
async function startEcho(): Promise<{ pending: Promise<{ ok: boolean; latencyMs: number; error?: string }>; client: Record<string, any> }> {
  const pending = agent.testNodeConnection(NODE);
  await sleep(1);
  return { pending, client: harness.last() as Record<string, any> };
}

describe("A. C-ECHO timeout — the arm that killed care-api", () => {
  it("A1 resolves the timeout instead of throwing out of the timer callback", async () => {
    const { pending, client } = await startEcho();
    expect(client.sendCalls).toBe(1);

    const result = await settle(pending, TIMEOUT_MS * 5);
    await sleep(TIMEOUT_MS); // let any process-level emit land before asserting

    expect(result).not.toBe("PENDING");
    expect(result).toMatchObject({ ok: false, error: `C-ECHO timeout after ${TIMEOUT_MS}ms` });
    expect(uncaught).toEqual([]);
  });

  it("A2 releases the association it owns, exactly once, using library-supported methods", async () => {
    const client = harness.module.Client as unknown as { prototype: Record<string, unknown> };
    expect(typeof client.prototype.close, "the mock must stay shape-faithful to dcmjs-dimse 0.3.3").toBe("undefined");

    await agent.testNodeConnection(NODE);
    await sleep(TIMEOUT_MS * 4);
    const c = harness.last();
    expect(c.abortCalls).toBe(1);
    expect(c.clearRequestsCalls).toBe(1);
    expect(uncaught).toEqual([]);
  });

  it("A3 a late-firing timer cannot clean up twice (the timer is cleared on settle)", async () => {
    const pending = agent.testNodeConnection(NODE);
    await settle(pending, TIMEOUT_MS * 5);
    await sleep(TIMEOUT_MS * 6); // far past the timeout the timer would have needed
    const c = harness.last();
    expect(c.abortCalls).toBe(1);
    expect(uncaught).toEqual([]);
  });
});

describe("B. the other failure and success shapes", () => {
  it("B1 a network error on an already-closed association is swallowed, not fatal", async () => {
    const { pending, client: c } = await startEcho();
    c.abortThrows = true; // exactly what dcmjs-dimse 0.3.3 abort() does after the socket closed
    c.failNetwork("connect ECONNREFUSED 10.255.255.1:104");

    const result = await settle(pending, TIMEOUT_MS * 5);
    await sleep(TIMEOUT_MS);

    expect(result).toMatchObject({ ok: false, error: "connect ECONNREFUSED 10.255.255.1:104" });
    expect(c.abortCalls).toBe(1);
    expect(uncaught).toEqual([]);
  });

  it("B2 a rejected C-ECHO status is reported and released", async () => {
    const { pending, client: c } = await startEcho();
    c.respondWith(41976); // any status that is neither Success nor Pending
    const result = await settle(pending, TIMEOUT_MS * 5);
    expect(result).toMatchObject({ ok: false, error: "C-ECHO rejected with status 41976" });
    expect(c.abortCalls).toBe(1);
    expect(uncaught).toEqual([]);
  });

  it("B3 success still resolves, and the library's own release is not preempted by an abort", async () => {
    const { pending, client: c } = await startEcho();
    c.respondWith(harness.status.Success);

    const result = await settle(pending, TIMEOUT_MS * 5);
    expect(result).not.toBe("PENDING");
    expect((result as { ok: boolean }).ok).toBe(true);
    expect(c.abortCalls).toBe(0);
    expect(c.clearRequestsCalls).toBe(0);

    await sleep(TIMEOUT_MS * 6); // the cleared timeout must never fire and abort a good association
    expect(c.abortCalls).toBe(0);
    expect(uncaught).toEqual([]);
  });

  it("B4 repeated unreachable modalities, then recovery through the same agent", async () => {
    for (let i = 0; i < 3; i += 1) {
      const { pending } = await startEcho();
      const result = await settle(pending, TIMEOUT_MS * 6);
      expect(result).not.toBe("PENDING");
      expect((result as { ok: boolean }).ok).toBe(false);
      expect(harness.last().abortCalls).toBe(1);
    }
    const { pending, client: c } = await startEcho();
    c.respondWith(harness.status.Success);
    const recovered = await settle(pending, TIMEOUT_MS * 6);
    expect(recovered).toMatchObject({ ok: true });
    expect(uncaught).toEqual([]);
    expect(harness.made.length).toBe(4);
  });
});

describe("C. all three DIMSE call sites agree", () => {
  it("C1 no site calls the method the pinned library does not have", () => {
    expect(agentSource).not.toContain("client.close(");
  });

  it("C2 every finish() releases through the shared non-throwing helper — and there are exactly three", () => {
    const releases = agentSource.split("releaseDimseClientAfterFailure(client,").length - 1;
    expect(releases).toBe(3);
  });

  it("C3 every timeout handle is captured so it can be cleared", () => {
    const armed = agentSource.split("timeout = setTimeout(").length - 1;
    const cleared = agentSource.split("clearTimeout(timeout)").length - 1;
    expect(armed).toBe(3);
    expect(cleared).toBe(3);
  });

  it("C2-control the contract reads real text, not an empty slice", () => {
    expect(agentSource.length).toBeGreaterThan(20_000);
    expect(agentSource).toContain("const finish = (ok: boolean, error?: string) => {");
    expect(agentSource).toContain("finish(`C-FIND timeout after");
    expect(agentSource).toContain("finish(false, `C-MOVE timeout after");
  });
});

describe("D. the teardown helper on its own", () => {
  it("D1 tolerates a missing, null or featureless client", async () => {
    const { releaseDimseClientAfterFailure } = await import("./dimseTeardown");
    expect(() => releaseDimseClientAfterFailure(null, "x")).not.toThrow();
    expect(() => releaseDimseClientAfterFailure(undefined, "x")).not.toThrow();
    expect(() => releaseDimseClientAfterFailure({}, "x")).not.toThrow();
  });

  it("D2 aborts once and survives a throwing abort", async () => {
    const { releaseDimseClientAfterFailure } = await import("./dimseTeardown");
    let aborts = 0;
    expect(() =>
      releaseDimseClientAfterFailure(
        {
          abort() {
            aborts += 1;
            throw new Error("Network has not been initialized");
          },
          clearRequests() {
            /* no-op */
          },
        },
        "C-FIND",
      ),
    ).not.toThrow();
    expect(aborts).toBe(1);
  });

  it("D3 a throwing clearRequests does not skip the abort", async () => {
    const { releaseDimseClientAfterFailure } = await import("./dimseTeardown");
    let aborts = 0;
    releaseDimseClientAfterFailure(
      {
        clearRequests() {
          throw new Error("queue busy");
        },
        abort() {
          aborts += 1;
        },
      },
      "C-MOVE",
    );
    expect(aborts).toBe(1);
  });
});
