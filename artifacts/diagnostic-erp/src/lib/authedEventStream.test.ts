/**
 * authedEventStream — the ERP's authenticated SSE client.
 *
 * The fetch mock returns REAL web-platform objects (undici Response over a real
 * ReadableStream) rather than hand-shaped stubs, so `res.headers`, `res.body`
 * and the reader behave exactly as they do in the browser. Only timers are
 * faked, and only setTimeout/clearTimeout, so stream internals keep running on
 * the real microtask queue.
 *
 * FAKE_TOKEN is a synthetic value written into a shimmed localStorage for this
 * run. It is not a credential; it exists so the tests can prove where the token
 * goes (header) and where it must never appear (URL, console).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERP_SESSION_KEY } from "./staffSession";
import { openAuthedEventStream } from "./authedEventStream";

const FAKE_TOKEN = "vitest-fake-session-token-000000000000";
const STREAM_PATH = "/api/radiology/pacs-worklist-stream";

type Call = { path: string; init?: RequestInit };

const store = new Map<string, string>();
const calls: Call[] = [];
let responses: Array<() => Response> = [];
let warnings: string[] = [];

function writeSession(token: string | null): void {
  store.clear();
  if (token) store.set(ERP_SESSION_KEY, JSON.stringify({ token, user: { permissions: [] } }));
}

function chunk(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A complete event-stream response whose frames are already queued. */
function closedResponse(frames: string[], init?: { status?: number; contentType?: string }): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(chunk(frame));
        controller.close();
      },
    }),
    {
      status: init?.status ?? 200,
      headers: { "content-type": init?.contentType ?? "text/event-stream" },
    },
  );
}

/** An event-stream response the test feeds by hand, so a stream can stay open. */
function liveResponse(): { res: Response; push(text: string): void; end(): void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const res = new Response(
    new ReadableStream<Uint8Array>({
      start(c) { controller = c; },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  return {
    res,
    push: (text: string) => controller.enqueue(chunk(text)),
    end: () => controller.close(),
  };
}

/** Let queued microtasks (fetch resolution, stream reads) run. */
async function settle(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

beforeEach(() => {
  calls.length = 0;
  responses = [];
  warnings = [];
  writeSession(FAKE_TOKEN);

  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => store.clear(),
    },
    configurable: true,
    writable: true,
  });

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), init });
    const next = responses.shift();
    return next ? next() : closedResponse([], { status: 500 });
  }));
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });

  // Only setTimeout/clearTimeout are faked: reconnects must not fire unless a test
  // advances them, and pending ones must not leak into the next test. Promises and
  // stream internals keep running on the real queue, which is what the read loop
  // needs to make progress.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authedEventStream", () => {
  it("E1 — requests the root-relative API path with a Bearer header and no query string", async () => {
    const live = liveResponse();
    responses.push(() => live.res);
    openAuthedEventStream(STREAM_PATH, () => undefined);
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe(STREAM_PATH);
    expect(calls[0].path.startsWith("/api/")).toBe(true);
    expect(calls[0].path).not.toContain("?");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(headers.Accept).toBe("text/event-stream");
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    live.end();
  });

  it("E2 — delivers the payload of a data frame", async () => {
    responses.push(() => closedResponse(['data: {"type":"refresh","worklistId":42}\n\n']));
    const events: string[] = [];
    openAuthedEventStream(STREAM_PATH, (data) => events.push(data));
    await settle();

    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0])).toMatchObject({ type: "refresh", worklistId: 42 });
  });

  it("E3 — reassembles a frame split across reads", async () => {
    responses.push(() => closedResponse(['data: {"type":"ref', 'resh","worklistId":7}\n\n']));
    responses.push(() => closedResponse(['data: {"b":2}\n', "\n"]));
    const first: string[] = [];
    openAuthedEventStream(STREAM_PATH, (data) => first.push(data));
    await settle();
    expect(first).toEqual(['{"type":"refresh","worklistId":7}']);

    const second: string[] = [];
    openAuthedEventStream(STREAM_PATH, (data) => second.push(data));
    await settle();
    expect(second).toEqual(['{"b":2}']);
  });

  it("E4 — ignores heartbeats and comment lines", async () => {
    responses.push(() => closedResponse([": heartbeat\n\n", ': ping\n', 'data: {"ok":1}\n\n', ": heartbeat\n\n"]));
    const events: string[] = [];
    openAuthedEventStream(STREAM_PATH, (data) => events.push(data));
    await settle();
    expect(events).toEqual(['{"ok":1}']);
  });

  it("E5 — accepts CRLF framing and joins multi-line data with a newline", async () => {
    responses.push(() => closedResponse(["data: {\"crlf\":true}\r\n\r\n"]));
    responses.push(() => closedResponse(["data: line1\ndata: line2\n\n"]));

    const crlf: string[] = [];
    openAuthedEventStream(STREAM_PATH, (data) => crlf.push(data));
    await settle();
    expect(crlf).toEqual(['{"crlf":true}']);

    const joined: string[] = [];
    openAuthedEventStream(STREAM_PATH, (data) => joined.push(data));
    await settle();
    expect(joined).toEqual(["line1\nline2"]);
  });

  it("E6 — reconnects with growing backoff after the server closes the stream", async () => {
    responses.push(
      () => closedResponse(['data: {"a":1}\n\n']),
      () => closedResponse([]),
      () => closedResponse([]),
    );
    const events: string[] = [];
    openAuthedEventStream(STREAM_PATH, (data) => events.push(data));

    await settle();
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(calls).toHaveLength(3);
    expect(warnings.join("\n")).toContain("reconnecting in 1000ms");
    expect(warnings.join("\n")).toContain("reconnecting in 2000ms");
    expect(events).toEqual(['{"a":1}']);
  });

  it("E7 — stops on 401 instead of hammering the API with a refused credential", async () => {
    responses.push(() => new Response('{"error":"Staff authentication required"}', { status: 401 }));
    openAuthedEventStream(STREAM_PATH, () => undefined);

    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    expect(calls).toHaveLength(1);
    expect(warnings.join("\n")).toContain("HTTP 401");
  });

  it("E8 — refuses an HTML body: the SPA fall-through that made the old stream silently dead", async () => {
    responses.push(() => new Response("<!doctype html><html><head></head><body>CARE</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));
    const events: string[] = [];
    openAuthedEventStream(STREAM_PATH, (data) => events.push(data));

    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    expect(events).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(warnings.join("\n")).toContain("not an event stream");
  });

  it("E9 — close() stops dispatch, cancels a pending reconnect and aborts the request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const live = liveResponse();
    responses.push(() => live.res);
    const events: string[] = [];
    const handle = openAuthedEventStream(STREAM_PATH, (data) => events.push(data));
    await settle();

    live.push('data: {"before":1}\n\n');
    await settle();
    expect(events).toEqual(['{"before":1}']);

    const signal = calls[0].init?.signal as AbortSignal;
    handle.close();
    expect(signal.aborted).toBe(true);

    live.push('data: {"after":1}\n\n');
    live.end();
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    expect(events).toEqual(['{"before":1}']);
    expect(calls).toHaveLength(1);
  });

  it("E10 — opens nothing when there is no staff session", async () => {
    writeSession(null);
    openAuthedEventStream(STREAM_PATH, () => undefined);
    await settle();
    expect(calls).toHaveLength(0);
    expect(warnings.join("\n")).toContain("no staff session");
  });

  it("E12 — close() cancels a reconnect that is already scheduled", async () => {
    responses.push(() => closedResponse(['data: {"type":"connected"}\n\n']));
    const handle = openAuthedEventStream(STREAM_PATH, () => undefined);
    await settle();
    expect(calls).toHaveLength(1); // the stream closed, so a reconnect is pending

    handle.close();
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(calls).toHaveLength(1);
  });

  it("E11 — the session token never reaches a URL or the console", async () => {
    responses.push(
      () => closedResponse(['data: {"type":"connected"}\n\n']),
      () => new Response("nope", { status: 503 }),
      () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    openAuthedEventStream(STREAM_PATH, () => undefined);
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();

    const everything = [...calls.map((c) => c.path), ...warnings].join("\n");
    expect(everything).not.toContain(FAKE_TOKEN);
    expect(everything).not.toContain("Bearer");
    // Only the three attempts this script allows were made, on the same path.
    expect(calls.map((c) => c.path)).toEqual([STREAM_PATH, STREAM_PATH, STREAM_PATH]);
  });
});
