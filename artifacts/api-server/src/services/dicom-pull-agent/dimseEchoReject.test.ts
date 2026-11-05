/**
 * Regression suite for the C-ECHO reject path.
 *
 * Measured fault (2026-11-05, the clinic's UIH MRI at 172.16.1.103:3333): the console
 * answers our verification request with A-ASSOCIATE-RJ "Called AE Title Not Recognized"
 * in under a second when we call as DIAGNO_AGENT, and accepts the byte-identical request
 * when it comes from the site PACS AE. The library reports that on `associationRejected`,
 * which nothing listened for, so the probe sat out its 60 s timer and told the operator
 * "timeout" — pointing at the network when the console had already replied. CT and both
 * X-ray consoles accept DIAGNO_AGENT, so that identity stays primary and the PACS AE is
 * tried only after an explicit rejection.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TIMEOUT_MS = 25;

const harness = vi.hoisted(() => {
  const sends: Array<{ host: string; port: number; calling: string; called: string }> = [];
  const clients: any[] = [];
  const settings = { rows: [] as Array<{ key: string; value: string | null }>, reads: 0 };
  const policy = {
    respond: (_calling: string, _client: any, _request: any): void => {},
  };

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
  }

  class FakeClient {
    handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    requests: any[] = [];
    abortCalls = 0;
    clearRequestsCalls = 0;
    constructor() {
      clients.push(this);
    }
    on(ev: string, cb: (...a: unknown[]) => void): void {
      const list = this.handlers.get(ev) ?? [];
      list.push(cb);
      this.handlers.set(ev, list);
    }
    emit(ev: string, ...args: unknown[]): void {
      for (const cb of this.handlers.get(ev) ?? []) cb(...args);
    }
    addRequest(r: any): void {
      this.requests.push(r);
    }
    clearRequests(): void {
      this.clearRequestsCalls += 1;
    }
    abort(): void {
      this.abortCalls += 1;
    }
    send(host: string, port: number, calling: string, called: string): void {
      sends.push({ host, port, calling, called });
      const request = this.requests[this.requests.length - 1];
      setTimeout(() => policy.respond(calling, this, request), 0);
    }
    listenerCount(ev: string): number {
      return (this.handlers.get(ev) ?? []).length;
    }
  }

  const module = {
    Client: FakeClient,
    requests: { CEchoRequest: FakeRequest },
    constants: {
      Status: { Success: 0 },
      RejectResult: { Transient: 1, Permanent: 2 },
      RejectSource: { ServiceUser: 1 },
      RejectReason: {
        NoReasonGiven: 1,
        ApplicationContextNotSupported: 2,
        CallingAeTitleNotRecognized: 3,
        CalledAeTitleNotRecognized: 7,
      },
    },
  };

  return {
    sends,
    clients,
    settings,
    policy,
    module,
    firstRejectListener: (): number => clients[0]?.listenerCount("associationRejected") ?? -1,
    reset(): void {
      sends.length = 0;
      clients.length = 0;
      settings.rows = [];
      settings.reads = 0;
      policy.respond = () => {};
    },
  };
});

vi.mock("dcmjs-dimse", () => ({ default: harness.module, ...harness.module }));

vi.mock("@workspace/db", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    db: {
      select: () => ({
        from: () => ({
          where: () => {
            harness.settings.reads += 1;
            return Promise.resolve(harness.settings.rows.slice());
          },
        }),
      }),
      insert: () => ({ values: () => Promise.resolve() }),
    },
  };
});

const MRI = { host: "172.16.1.103", port: 3333, aeTitle: "UIH", modality: "MR" } as const;

const REJECT_CALLED_AE = { result: 2, source: 1, reason: 7 };

type Agent = typeof import("./dimse-agent");
let agent: Agent;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  process.env["DIMSE_TIMEOUT_MS"] = String(TIMEOUT_MS);
  delete process.env["CARE_DEV_ISOLATED"];
  delete process.env["AGENT_AE_TITLE"];
  agent = await import("./dimse-agent");
});

beforeEach(() => {
  harness.reset();
});

describe("A. a console that knows the PACS but not the agent", () => {
  it("A1 is served by retrying once as the site PACS AE title", async () => {
    harness.settings.rows = [{ key: "pacs_ae_title", value: "ORTHANC2" }];
    harness.policy.respond = (calling, client, request) => {
      if (calling === "DIAGNO_AGENT") client.emit("associationRejected", REJECT_CALLED_AE);
      else request.emit("response", { getStatus: () => 0 });
    };

    const result = await agent.testNodeConnection(MRI);

    expect(result.ok).toBe(true);
    expect(harness.sends).toEqual([
      { host: "172.16.1.103", port: 3333, calling: "DIAGNO_AGENT", called: "UIH" },
      { host: "172.16.1.103", port: 3333, calling: "ORTHANC2", called: "UIH" },
    ]);
  });

  it("A2 prefers pacs_ae_title over orthanc_ae_title when both are set", async () => {
    harness.settings.rows = [
      { key: "orthanc_ae_title", value: "ORTHANC" },
      { key: "pacs_ae_title", value: "ORTHANC2" },
    ];
    harness.policy.respond = (calling, client, request) => {
      if (calling === "DIAGNO_AGENT") client.emit("associationRejected", REJECT_CALLED_AE);
      else request.emit("response", { getStatus: () => 0 });
    };

    await agent.testNodeConnection(MRI);

    expect(harness.sends[1].calling).toBe("ORTHANC2");
  });

  it("A3 the rejected association is still released, once, without throwing", async () => {
    harness.settings.rows = [{ key: "pacs_ae_title", value: "ORTHANC2" }];
    harness.policy.respond = (calling, client, request) => {
      if (calling === "DIAGNO_AGENT") client.emit("associationRejected", REJECT_CALLED_AE);
      else request.emit("response", { getStatus: () => 0 });
    };

    await agent.testNodeConnection(MRI);
    await sleep(TIMEOUT_MS * 2);

    const first = harness.clients[0];
    expect(first.abortCalls).toBe(1);
    expect(first.clearRequestsCalls).toBe(1);
    expect(harness.clients[1].abortCalls).toBe(0);
  });
});

describe("B. what the operator is told", () => {
  it("B1 a rejection is reported as the console's own reason, never as a timeout", async () => {
    harness.settings.rows = [{ key: "pacs_ae_title", value: "ORTHANC2" }];
    harness.policy.respond = (calling, client) => {
      client.emit("associationRejected", REJECT_CALLED_AE);
    };

    const result = await agent.testNodeConnection(MRI);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Called AE Title Not Recognized");
    expect(result.error).not.toMatch(/timeout/i);
    expect(result.error).toContain("tried calling AE titles: DIAGNO_AGENT, ORTHANC2");
  });

  it("B2 the reject listener is actually registered on the client", async () => {
    harness.policy.respond = (calling, client) => {
      client.emit("associationRejected", REJECT_CALLED_AE);
    };
    await agent.testNodeConnection(MRI);
    expect(harness.firstRejectListener()).toBe(1);
  });
});

describe("C. paths that must not pay for a fallback", () => {
  it("C1 an unreachable console gets one association and no settings read", async () => {
    // A site PACS AE IS configured here on purpose: if the fallback were widened past
    // rejections, this is what would catch the second association.
    harness.settings.rows = [{ key: "pacs_ae_title", value: "ORTHANC2" }];
    harness.policy.respond = (_c, client) => {
      client.emit("networkError", new Error("connect ECONNREFUSED 172.16.1.103:3333"));
    };

    const result = await agent.testNodeConnection(MRI);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
    expect(harness.sends.length).toBe(1);
    expect(harness.settings.reads).toBe(0);
  });

  it("C2 a silent console still times out after exactly one association", async () => {
    harness.settings.rows = [{ key: "pacs_ae_title", value: "ORTHANC2" }];
    harness.policy.respond = () => {};
    const result = await agent.testNodeConnection(MRI);

    expect(result.error).toBe(`C-ECHO timeout after ${TIMEOUT_MS}ms`);
    expect(harness.sends.length).toBe(1);
    expect(harness.settings.reads).toBe(0);
  });

  it("C3 a console that accepts the agent AE is never dialled twice", async () => {
    harness.settings.rows = [{ key: "pacs_ae_title", value: "ORTHANC2" }];
    harness.policy.respond = (_c, _client, request) => {
      request.emit("response", { getStatus: () => 0 });
    };

    const result = await agent.testNodeConnection(MRI);

    expect(result.ok).toBe(true);
    expect(harness.sends.length).toBe(1);
    expect(harness.settings.reads).toBe(0);
  });

  it("C4 with no site PACS AE configured the reason is still reported once", async () => {
    harness.policy.respond = (_c, client) => {
      client.emit("associationRejected", REJECT_CALLED_AE);
    };

    const result = await agent.testNodeConnection(MRI);

    expect(harness.sends.length).toBe(1);
    expect(result.error).toContain("Called AE Title Not Recognized");
    expect(result.error).toContain("tried calling AE titles: DIAGNO_AGENT");
  });

  it("C5 a site AE identical to the agent AE is not dialled again", async () => {
    harness.settings.rows = [{ key: "pacs_ae_title", value: "DIAGNO_AGENT" }];
    harness.policy.respond = (_c, client) => {
      client.emit("associationRejected", REJECT_CALLED_AE);
    };

    await agent.testNodeConnection(MRI);

    expect(harness.sends.length).toBe(1);
  });
});
