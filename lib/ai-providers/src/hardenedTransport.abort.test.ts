/**
 * Stage 1 PR-A — the caller's deadline must reach the socket.
 *
 * Why this is a security test and not a nicety: the hardened transport pins the
 * connection to a validated private IP and keeps it open for as long as the
 * local model takes. When it ignored `init.signal`, an Ollama that stopped
 * answering held the compose job, its socket and its image bytes open
 * indefinitely — the exact state a radiologist cancels out of. Every production
 * call site hands a deadline here (`probeOllamaReachable`,
 * `probeOllamaModelVision`, the OpenAI SDK's own abort controller), so the
 * behaviour under test is the one the clinic actually depends on.
 *
 * A real HTTP server on a real socket, no mocks: a mocked fetch would accept
 * `signal` and prove nothing about whether the socket is torn down.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { hardenedLocalRequest, createHardenedLocalFetch } from "./hardenedTransport";

/**
 * Fail the test ourselves rather than let the runner time out. Without this a
 * regression (signal dropped again) would hang for the whole testTimeout and
 * read as an environment problem instead of a red assertion.
 */
async function withinDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`DEADLINE_NOT_HONOURED: ${label}`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type Harness = {
  url: string;
  requestsReceived: number;
  socketsClosed: number;
  close: () => Promise<void>;
};

const openServers: Harness[] = [];

/**
 * A server that accepts the TCP connection and then says nothing — the local
 * model wedged mid-inference. `bodyBytes` makes it answer, which the control
 * cases need to prove the harness itself is not broken.
 */
async function startServer(mode: "silent" | "answers" | "slow-body"): Promise<Harness> {
  const server: Server = createServer((_req, res) => {
    harness.requestsReceived += 1;
    if (mode === "answers") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    if (mode === "slow-body") {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"partial":');
      return; // headers delivered, body never finished
    }
    // silent: hold the socket open, never respond
  });
  const harness: Harness = {
    url: "",
    requestsReceived: 0,
    socketsClosed: 0,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  harness.url = `http://127.0.0.1:${port}`;
  server.on("connection", (s) => {
    const track = { closed: false };
    s.on("close", () => {
      if (!track.closed) {
        track.closed = true;
        harness.socketsClosed += 1;
      }
    });
  });
  openServers.push(harness);
  return harness;
}

afterEach(async () => {
  while (openServers.length) {
    const h = openServers.pop();
    if (h) await h.close();
  }
});

function isAbortish(err: unknown): boolean {
  const e = err as { name?: string; code?: string; message?: string };
  return /AbortError|AbortSignal|ABORT_ERR|abort/i.test(
    `${e?.name ?? ""} ${e?.code ?? ""} ${e?.message ?? ""}`,
  );
}

describe("hardenedLocalRequest — honours the caller's abort signal", () => {
  it("cancels a wedged local model on the requested deadline", async () => {
    const h = await startServer("silent");
    const started = Date.now();
    const err = await withinDeadline(
      hardenedLocalRequest(h.url, { method: "POST", signal: AbortSignal.timeout(200) }).then(
        () => null,
        (e: unknown) => e,
      ),
      5_000,
      "hardenedLocalRequest ignored AbortSignal.timeout(200)",
    );
    expect(err).toBeInstanceOf(Error);
    expect(isAbortish(err)).toBe(true);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("really reached the server, so the cancel came from the deadline not a failed connect", async () => {
    const h = await startServer("silent");
    await withinDeadline(
      hardenedLocalRequest(h.url, { signal: AbortSignal.timeout(200) }).then(
        () => null,
        (e: unknown) => e,
      ),
      5_000,
      "hardenedLocalRequest never returned",
    );
    expect(h.requestsReceived).toBe(1);
    // The socket has to be gone, not merely un-read: the clinic's complaint was
    // a cancelled compose job still holding a local inference slot.
    await withinDeadline(
      (async () => {
        while (h.socketsClosed === 0) await new Promise((r) => setTimeout(r, 20));
      })(),
      3_000,
      "aborted request left the TCP socket open",
    );
    expect(h.socketsClosed).toBeGreaterThanOrEqual(1);
  });

  it("does not put a byte on the wire for a request that is already cancelled", async () => {
    const h = await startServer("answers");
    const controller = new AbortController();
    controller.abort();
    const err = await withinDeadline(
      hardenedLocalRequest(h.url, { signal: controller.signal }).then(() => null, (e: unknown) => e),
      5_000,
      "pre-aborted request hung",
    );
    expect(err).toBeInstanceOf(Error);
    expect(h.requestsReceived).toBe(0);
  });

  it("still delivers a normal response when no signal is passed (control)", async () => {
    const h = await startServer("answers");
    const { response, boundIp } = await withinDeadline(
      hardenedLocalRequest(h.url, { method: "GET" }),
      5_000,
      "plain request never completed",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(boundIp).toBe("127.0.0.1");
  });

  it("still delivers when an un-triggered signal is passed (control)", async () => {
    const h = await startServer("answers");
    const response = await withinDeadline(
      hardenedLocalRequest(h.url, { signal: AbortSignal.timeout(30_000) }),
      5_000,
      "generous deadline aborted a fast response",
    );
    expect(response.response.status).toBe(200);
  });

  it("tears the socket down when the deadline lands mid-body", async () => {
    const h = await startServer("slow-body");
    const { response } = await withinDeadline(
      hardenedLocalRequest(h.url, { signal: AbortSignal.timeout(300) }),
      5_000,
      "headers never arrived",
    );
    // Headers were already delivered, so the rejection has to surface on the
    // body read — an un-aborted transport would sit here until the server died.
    const read = await withinDeadline(
      response.text().then(() => null, (e: unknown) => e),
      5_000,
      "body read hung after abort",
    );
    expect(read).toBeInstanceOf(Error);
    expect(h.socketsClosed).toBeGreaterThanOrEqual(1);
  });
});

describe("createHardenedLocalFetch — the SDK path honours the signal too", () => {
  it("cancels a wedged local model behind the bound fetch the OpenAI SDK uses", async () => {
    const h = await startServer("silent");
    const bound = createHardenedLocalFetch({ enforceBinding: true });
    const err = await withinDeadline(
      bound(`${h.url}/v1/chat/completions`, { method: "POST", signal: AbortSignal.timeout(200) }).then(
        () => null,
        (e: unknown) => e,
      ),
      5_000,
      "createHardenedLocalFetch ignored the signal",
    );
    expect(err).toBeInstanceOf(Error);
    expect(isAbortish(err)).toBe(true);
    expect(h.requestsReceived).toBe(1);
  });

  it("passes a normal response through the bound fetch (control)", async () => {
    const h = await startServer("answers");
    const bound = createHardenedLocalFetch({ enforceBinding: true });
    const resp = await withinDeadline(
      bound(`${h.url}/v1/models`, { method: "GET", signal: AbortSignal.timeout(30_000) }),
      5_000,
      "bound fetch never resolved",
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true });
  });
});
