/**
 * Server-Sent Events over an authenticated fetch.
 *
 * EventSource cannot send an Authorization header. That single limitation is why
 * the radiology worklist used to put the staff session token in the stream's
 * query string: a long-lived credential then sits in the browser history, in the
 * reverse proxy's access log, in Referer headers on any navigation the page makes
 * while it is open, and in cache keys. This client sends the same
 * `Authorization: Bearer <token>` header every other ERP request already sends,
 * so no credential enters a URL and no second authentication path is added — the
 * server already accepts the header (proved by
 * api-server/src/routes/pacsWorklistStream.request.test.ts).
 *
 * The other half of why this exists: the page built its URL from the SPA's
 * BASE_URL ("/erp/" in production), so the request matched nginx's
 * `location ^~ /erp/` and was answered by index.html — HTTP 200, text/html, and
 * an event stream that never fired. Callers pass a root-relative "/api/…" path;
 * a non-event-stream answer is refused here rather than being silently accepted,
 * because that fall-through is exactly what made the original bug invisible.
 *
 * Reconnection is deliberately simple: exponential backoff capped at
 * MAX_RETRY_MS, reset by the first successful frame. A refused credential stops
 * the loop — a stream cannot fix an auth problem, and hammering the API with a
 * token the server already rejected is worse than the live refresh being absent.
 * The screens that use this keep their polling query as the floor, so a closed
 * stream degrades to a slower refresh, not to stale data.
 */
import { getStaffToken } from "./fetchApi";

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const LOG_PREFIX = "[authedEventStream]";

export interface AuthedEventStreamHandle {
  close(): void;
}

/**
 * Open `path` (root-relative, e.g. "/api/radiology/pacs-worklist-stream") and
 * call `onData` with the payload of every `data:` frame. Returns a handle whose
 * close() aborts the in-flight request, cancels any pending reconnect and stops
 * further dispatch — call it from the effect cleanup.
 */
export function openAuthedEventStream(
  path: string,
  onData: (data: string) => void,
): AuthedEventStreamHandle {
  let closed = false;
  let controller: AbortController | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;

  const stop = (reason: string): void => {
    closed = true;
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
    controller?.abort();
    console.warn(`${LOG_PREFIX} GET ${path} ${reason}; live refresh off (the screen keeps polling)`);
  };

  const scheduleReconnect = (reason: string): void => {
    if (closed) return;
    const delay = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** failures++);
    console.warn(`${LOG_PREFIX} GET ${path} ${reason}, reconnecting in ${delay}ms`);
    reconnectTimer = setTimeout(() => { void connect(); }, delay);
  };

  async function connect(): Promise<void> {
    if (closed) return;
    const token = getStaffToken();
    if (!token) { stop("has no staff session to authenticate with"); return; }

    const abort = new AbortController();
    controller = abort;

    let res: Response;
    try {
      res = await fetch(path, {
        headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
        signal: abort.signal,
      });
    } catch (err) {
      if (closed || abort.signal.aborted) return;
      scheduleReconnect(`failed on the network (${err instanceof Error ? err.name : "unknown error"})`);
      return;
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) { stop(`was refused with HTTP ${res.status}`); return; }
      scheduleReconnect(`answered HTTP ${res.status}`);
      return;
    }

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (contentType !== "text/event-stream") {
      stop(`answered ${contentType || "an unlabelled"} body, not an event stream`);
      return;
    }
    if (!res.body) { stop("answered with no response body"); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let dataLines: string[] = [];

    const takeLine = (line: string): void => {
      if (line === "") {
        if (!dataLines.length) return;
        const data = dataLines.join("\n");
        dataLines = [];
        if (closed) return;
        // Backoff is reset by a frame that arrived, not by a connection that was
        // accepted: a server that opens the stream and closes it immediately must
        // not be retried once a second forever.
        failures = 0;
        onData(data);
        return;
      }
      if (line.startsWith(":")) return; // comment / heartbeat
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      // event:, id: and retry: are ignored — CARE's streams send one unnamed
      // data event per update, so a field-based dispatch would be unused code.
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        pending += decoder.decode(value, { stream: true });
        for (;;) {
          const nl = pending.indexOf("\n");
          if (nl < 0) break;
          const line = pending.slice(0, nl).replace(/\r$/, "");
          pending = pending.slice(nl + 1);
          takeLine(line);
        }
      }
    } catch {
      // The read failed mid-stream: reconnect like any other closed stream.
      if (!closed && !abort.signal.aborted) { scheduleReconnect("dropped mid-stream"); return; }
      return;
    }

    scheduleReconnect("the server closed the stream");
  }

  void connect();

  return {
    close(): void {
      closed = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      controller?.abort();
    },
  };
}
