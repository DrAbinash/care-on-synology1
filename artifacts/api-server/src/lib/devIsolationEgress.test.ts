import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import {
  DEV_EGRESS_ALLOW_ENV,
  EGRESS_BLOCKED_CODE,
  isIsolated,
} from "./devIsolation";
import {
  installDevIsolationEgressGuards,
  type EgressObservation,
} from "./devIsolationEgress";

/**
 * TEST-NET-2 (RFC 5737). Unroutable, so if a guard ever fails open during this run
 * nothing on the clinic — or anywhere else — is contacted. The test does not rely on
 * that: it asserts the destination was rewritten to the loopback sinkhole.
 */
const PRODUCTION_LIKE_HOST = "198.51.100.7";
const ISOLATED_ENV = { CARE_DEV_ISOLATED: "1" };

const realFetch = globalThis.fetch;

// Every test installs over whatever is on globalThis.fetch right now, so each one
// starts from the real implementation. Without this, a spy left in place by a
// previous test becomes the "original" the next guard wraps.
beforeEach(() => {
  globalThis.fetch = realFetch;
});

let localPort = 0;
let localServer: http.Server | null = null;

beforeAll(async () => {
  localServer = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("pong");
  });
  await new Promise<void>((resolve) => localServer!.listen(0, "127.0.0.1", () => resolve()));
  localPort = (localServer!.address() as AddressInfo).port;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (localServer) await new Promise<void>((resolve) => localServer!.close(() => resolve()));
});

function recordingObserver() {
  const seen: EgressObservation[] = [];
  return { seen, observe: (o: EgressObservation) => seen.push(o) };
}

describe("the guard is inert unless isolation is on", () => {
  test("installing without the flag does not replace fetch or the agents", () => {
    const restore = installDevIsolationEgressGuards({}, () => {});
    expect(globalThis.fetch).toBe(realFetch);
    restore();
  });

  test("isIsolated is the switch the seams read", () => {
    expect(isIsolated(ISOLATED_ENV)).toBe(true);
    expect(isIsolated({})).toBe(false);
  });
});

describe("fetch seam", () => {
  test("a production destination is refused before any socket exists", async () => {
    const { seen, observe } = recordingObserver();
    const calls: string[] = [];
    const spy = ((input: unknown) => {
      calls.push(String(input));
      return Promise.resolve(new Response("should-not-be-reached"));
    }) as unknown as typeof fetch;
    globalThis.fetch = spy;
    const restore = installDevIsolationEgressGuards(ISOLATED_ENV, observe);
    try {
      await expect(globalThis.fetch(`http://${PRODUCTION_LIKE_HOST}:8042/system/find`).catch((e: unknown) => e)).resolves.toBeInstanceOf(Error);
      expect(calls, "the underlying fetch must never be called").toEqual([]);
      const blocked = seen.find((o) => o.host === PRODUCTION_LIKE_HOST);
      expect(blocked, "the refusal must be observable").toMatchObject({ allowed: false, via: "fetch" });
      expect(blocked?.reason).toContain(DEV_EGRESS_ALLOW_ENV);
    } finally {
      restore();
    }
  });

  test("an allowlisted development service passes through unchanged", async () => {
    const calls: string[] = [];
    const spy = ((input: unknown, init?: unknown) => {
      calls.push(String(input));
      void init;
      return Promise.resolve(new Response("ok"));
    }) as unknown as typeof fetch;
    globalThis.fetch = spy;
    const restore = installDevIsolationEgressGuards(
      { ...ISOLATED_ENV, [DEV_EGRESS_ALLOW_ENV]: `${PRODUCTION_LIKE_HOST}:8042` },
      () => {},
    );
    try {
      const res = await globalThis.fetch(`http://${PRODUCTION_LIKE_HOST}:8042/ping`);
      expect(await res.text()).toBe("ok");
      expect(calls).toEqual([`http://${PRODUCTION_LIKE_HOST}:8042/ping`]);
      // A port-specific entry does not open the whole host.
      await expect(globalThis.fetch(`http://${PRODUCTION_LIKE_HOST}:9999/ping`).catch((e: unknown) => e)).resolves.toBeInstanceOf(Error);
      expect(calls).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test("loopback really works through the guard", async () => {
    const restore = installDevIsolationEgressGuards(ISOLATED_ENV, () => {});
    try {
      const res = await realFetchGuarded(`http://127.0.0.1:${localPort}/ping`);
      expect(res).toBe("pong");
    } finally {
      restore();
    }
  });

  test("a Request object is judged by its url, not passed through unread", async () => {
    const { seen, observe } = recordingObserver();
    globalThis.fetch = ((input: unknown) => Promise.resolve(new Response(String(input)))) as unknown as typeof fetch;
    const restore = installDevIsolationEgressGuards(ISOLATED_ENV, observe);
    try {
      const request = new Request(`https://${PRODUCTION_LIKE_HOST}/api/chat`);
      const outcome = await globalThis.fetch(request).catch((e: unknown) => e);
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as { code?: string }).code).toBe(EGRESS_BLOCKED_CODE);
      expect(seen.some((o) => o.host === PRODUCTION_LIKE_HOST && o.allowed === false)).toBe(true);
    } finally {
      restore();
    }
  });

  test("a fetch whose destination cannot be parsed is refused rather than guessed", async () => {
    const calls: unknown[] = [];
    globalThis.fetch = ((input: unknown) => {
      calls.push(input);
      return Promise.resolve(new Response("reached"));
    }) as unknown as typeof fetch;
    const restore = installDevIsolationEgressGuards(ISOLATED_ENV, () => {});
    try {
      const outcome = await globalThis.fetch("{not a url").catch((e: unknown) => e);
      expect(outcome).toBeInstanceOf(Error);
      expect(calls).toEqual([]);
    } finally {
      restore();
    }
  });

  test("a non-network scheme is not blocked (data: urls never leave the process)", async () => {
    let reached = false;
    globalThis.fetch = (() => {
      reached = true;
      return Promise.resolve(new Response("data"));
    }) as unknown as typeof fetch;
    const restore = installDevIsolationEgressGuards(ISOLATED_ENV, () => {});
    try {
      await globalThis.fetch("data:text/plain,hello");
      expect(reached).toBe(true);
    } finally {
      restore();
    }
  });
});

describe("http and https agent seam (axios, node-fetch, http.request)", () => {
  test("a production destination is rewritten to the loopback sinkhole", async () => {
    const { seen, observe } = recordingObserver();
    const restore = installDevIsolationEgressGuards(ISOLATED_ENV, observe);
    try {
      const outcome = await new Promise<Error>((resolve) => {
        const req = http.get(`http://${PRODUCTION_LIKE_HOST}:8042/`, (res) => {
          res.resume();
          resolve(new Error("UNEXPECTED: the request connected"));
        });
        req.on("error", resolve);
      });
      // The connection was attempted against 127.0.0.1:1 — nothing can listen there —
      // which is the proof that the production address was never dialed.
      expect((outcome as { code?: string }).code).toBe("ECONNREFUSED");
      expect(outcome.message).toContain("127.0.0.1:1");
      expect(outcome.message).not.toContain(PRODUCTION_LIKE_HOST);
      expect(seen.some((o) => o.host === PRODUCTION_LIKE_HOST && o.allowed === false && o.via === "http-agent")).toBe(true);
    } finally {
      restore();
    }
  });

  test("the https agent is guarded too, including the options-object form", async () => {
    const { seen, observe } = recordingObserver();
    const restore = installDevIsolationEgressGuards(ISOLATED_ENV, observe);
    try {
      const outcome = await new Promise<Error>((resolve) => {
        const req = https.request(
          { host: PRODUCTION_LIKE_HOST, port: 443, path: "/", servername: "graph.facebook.com" },
          (res) => {
            res.resume();
            resolve(new Error("UNEXPECTED: the request connected"));
          },
        );
        req.on("error", resolve);
        req.end();
      });
      expect((outcome as { code?: string }).code).toBe("ECONNREFUSED");
      expect(seen.some((o) => o.host === PRODUCTION_LIKE_HOST && o.via === "https-agent")).toBe(true);
    } finally {
      restore();
    }
  });

  test("loopback traffic through the agents is untouched — the Vite proxy path", async () => {
    const restore = installDevIsolationEgressGuards(ISOLATED_ENV, () => {});
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${localPort}/api/healthz`, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (d) => chunks.push(d as Buffer));
          res.on("end", () => resolve(Buffer.concat(chunks).toString()));
        });
        req.on("error", reject);
      });
      expect(body).toBe("pong");
    } finally {
      restore();
    }
  });

  test("restoring puts Node's own implementation back, byte for byte", () => {
    const fetchBefore = globalThis.fetch;
    const httpBefore = http.Agent.prototype.createConnection;
    const httpsBefore = https.Agent.prototype.createConnection;
    const restore = installDevIsolationEgressGuards(ISOLATED_ENV, () => {});
    expect(globalThis.fetch).not.toBe(fetchBefore);
    expect(http.Agent.prototype.createConnection).not.toBe(httpBefore);
    restore();
    expect(globalThis.fetch).toBe(fetchBefore);
    expect(http.Agent.prototype.createConnection).toBe(httpBefore);
    expect(https.Agent.prototype.createConnection).toBe(httpsBefore);
  });
});

/** Calls fetch through the seam that is currently installed, against the real stack. */
async function realFetchGuarded(url: string): Promise<string> {
  const res = await globalThis.fetch(url);
  return res.text();
}
