/**
 * devIsolationEgress.ts — the outbound guard for CARE_DEV_ISOLATED=1.
 *
 * WHY TWO SEAMS AND NOT ONE
 * There is no single place in this codebase where an outbound request is made:
 * ~124 direct `fetch()` call sites, `axios`, `node:http`, AI SDKs that open their
 * own sockets, SMTP via `nodemailer`, and DICOM DIMSE over raw TCP. A guard that
 * wrapped one of them would leave the others open while looking like a control.
 *
 * So this module guards the two supported, dependency-free seams that carry
 * essentially all HTTP egress:
 *   - `globalThis.fetch` (and therefore the SDKs that use it), and
 *   - `http.Agent` / `https.Agent` `createConnection` (and therefore `http.request`,
 *     `axios`, `node-fetch` and anything else that goes through an agent).
 * Both were verified on this Node before being written down: a destination is
 * readable in every calling form, and a refusal produces an ordinary asynchronous
 * connection error rather than a throw from inside Node's client.
 *
 * What these two seams do NOT cover is a socket opened directly with `net`/`tls`
 * — SMTP and DIMSE. Those get an explicit, named door at their own entry points
 * (`email.getTransporter`, `dimse-agent`), because pretending a TCP socket is
 * covered by an HTTP guard is exactly the kind of silent fail-open this mode
 * exists to prevent.
 *
 * HOW A REFUSAL HAPPENS: the destination is rewritten to `EGRESS_SINKHOLE`
 * (127.0.0.1:1) instead of being connected. Nothing can be listening there, so the
 * attempt is refused immediately on loopback — no packet leaves the machine, no
 * retry/backoff is confused by a fake timeout, and no caller has to know that a
 * guard exists. The reason is logged separately, naming the destination and the
 * variable that would permit it.
 *
 * When isolation is off, `installDevIsolationEgressGuards` returns without
 * touching anything, so production behaves exactly as before.
 */

import http from "node:http";
import https from "node:https";
import {
  DEV_EGRESS_ALLOW_ENV,
  EGRESS_BLOCKED_CODE,
  EGRESS_SINKHOLE,
  evaluateEgress,
  isIsolated,
  type Env,
} from "./devIsolation";

export type EgressObservation = {
  via: "fetch" | "http-agent" | "https-agent" | "explicit";
  host: string;
  port: number | null;
  allowed: boolean;
  reason: string;
};

export type EgressObserver = (observation: EgressObservation) => void;

const noopObserver: EgressObserver = () => {};

/** The error/failure shape every refusal carries, so a caller can tell this from an outage. */
export function devIsolationEgressError(host: string, port: number | null, reason: string): Error & { code: string } {
  const err = new Error(
    `CARE_DEV_ISOLATED blocked an outbound request to ${host}${port == null ? "" : `:${port}`} — ${reason}`,
  ) as Error & { code: string };
  err.code = EGRESS_BLOCKED_CODE;
  return err;
}

/**
 * Explicit refusal for the doors that the HTTP seams cannot see (raw TCP, SMTP) and
 * for work that would corrupt the restored data before it ever reaches the network
 * — e.g. an outbox dispatch that marks real clinical events as failed.
 * Returns null when the call may proceed.
 */
export function devIsolatedRefusal(
  label: string,
  target: { host?: string | null; port?: number | null },
  env: Env = process.env,
): { allowed: false; reason: string; message: string } | null {
  if (!isIsolated(env)) return null;
  const host = target.host ?? null;
  if (host == null) {
    return {
      allowed: false,
      reason: `${DEV_EGRESS_ALLOW_ENV} isolated mode refuses ${label} outright`,
      message: `CARE_DEV_ISOLATED blocked ${label}`,
    };
  }
  const decision = evaluateEgress({ host, port: target.port ?? null }, env);
  if (decision.allowed) return null;
  return { allowed: false, reason: decision.reason, message: `CARE_DEV_ISOLATED blocked ${label}` };
}

/** `assert`-style refusal for callers that prefer to throw. */
export function assertDevIsolatedEgress(
  label: string,
  target: { host?: string | null; port?: number | null },
  env: Env = process.env,
): void {
  const refusal = devIsolatedRefusal(label, target, env);
  if (!refusal) return;
  throw devIsolationEgressError(String(target.host ?? label), target.port ?? null, refusal.reason);
}

type Targetish = { host: string; port: number | null };

function targetFromFetchInput(input: unknown): Targetish | "non-network" | "unknown" {
  let raw: string | null = null;
  if (typeof input === "string") raw = input;
  else if (input instanceof URL) raw = input.href;
  else if (input && typeof input === "object") {
    const maybeUrl = (input as { url?: unknown }).url;
    if (typeof maybeUrl === "string") raw = maybeUrl;
  }
  if (raw == null) return "unknown";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "unknown";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "non-network";
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return "unknown";
  return { host, port };
}

function installFetchGuard(env: Env, observe: EgressObserver): () => void {
  const original = globalThis.fetch;
  if (typeof original !== "function") return () => {};
  // `RequestInfo` is a DOM lib name and this package compiles without it; the fetch
  // parameter type is taken from `fetch` itself so the guard cannot drift from it.
  type FetchInput = Parameters<typeof fetch>[0];
  const guarded: typeof fetch = function (input, init) {
    const target = targetFromFetchInput(input);
    if (target === "non-network") return original.call(globalThis, input as FetchInput, init);
    if (target === "unknown") {
      // An http(s) request whose destination cannot be read is refused: failing
      // open here would mean the guard's coverage depends on how a caller wrote
      // the URL.
      observe({ via: "fetch", host: "(unreadable)", port: null, allowed: false, reason: "destination could not be parsed from the fetch input" });
      return Promise.reject(devIsolationEgressError("(unreadable)", null, "the fetch destination could not be parsed"));
    }
    const decision = evaluateEgress(target, env);
    observe({ via: "fetch", host: target.host, port: target.port, allowed: decision.allowed, reason: decision.reason });
    if (!decision.allowed) return Promise.reject(devIsolationEgressError(target.host, target.port, decision.reason));
    return original.call(globalThis, input as FetchInput, init);
  };
  globalThis.fetch = guarded;
  return () => {
    globalThis.fetch = original;
  };
}

/** Node's `Agent.createConnection` signature, taken loosely so the wrapper can pass every calling form through. */
type CreateConnectionFn = (this: unknown, ...args: unknown[]) => unknown;

/**
 * Wrap `createConnection` on an Agent prototype. The refusal rewrites the
 * destination to the loopback sinkhole through the ORIGINAL function, so Node and
 * the caller still exchange a normal connection error.
 */
function installAgentGuard(
  proto: { createConnection?: CreateConnectionFn } | null | undefined,
  label: "http-agent" | "https-agent",
  env: Env,
  observe: EgressObserver,
): () => void {
  if (!proto) return () => {};
  const original = proto.createConnection;
  if (typeof original !== "function") return () => {};
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(proto, "createConnection");

  const guarded = function (this: unknown, ...args: unknown[]) {
    const first = args[0];
    let host: string | null = null;
    let port: number | null = null;
    if (first !== null && typeof first === "object") {
      const o = first as { host?: unknown; hostname?: unknown; port?: unknown };
      host = typeof o.host === "string" ? o.host : typeof o.hostname === "string" ? o.hostname : null;
      port = typeof o.port === "number" ? o.port : null;
    } else if (typeof first === "number" || typeof first === "string") {
      port = Number(first);
      const second = args[1];
      host = typeof second === "string" ? second : null;
    }
    const decision = evaluateEgress({ host: host ?? "", port }, env);
    observe({ via: label, host: host ?? "(none)", port, allowed: decision.allowed, reason: decision.reason });
    if (decision.allowed) return original.apply(this, args);
    const options = args[2];
    const sinkholeOptions =
      options !== null && typeof options === "object"
        ? { ...(options as Record<string, unknown>), host: EGRESS_SINKHOLE.host, port: EGRESS_SINKHOLE.port }
        : undefined;
    return original.call(this, EGRESS_SINKHOLE.port, EGRESS_SINKHOLE.host, sinkholeOptions);
  };

  proto.createConnection = guarded as never;
  return () => {
    if (hadOwnProperty) proto.createConnection = original;
    else delete proto.createConnection;
  };
}

/**
 * Install both HTTP seams. Returns a restore function; tests use it to leave the
 * process exactly as they found it.
 */
export function installDevIsolationEgressGuards(
  env: Env = process.env,
  observe: EgressObserver = noopObserver,
): () => void {
  if (!isIsolated(env)) return () => {};
  const restoreFetch = installFetchGuard(env, observe);
  // `http.Agent` is the constructor; `createConnection` lives on its prototype.
  // Patching the constructor instead installs a static that nothing ever calls, and
  // the guard then fails open silently — which is worse than not installing it.
  const restoreHttp = installAgentGuard(
    http.Agent.prototype as unknown as { createConnection?: (...args: never[]) => unknown },
    "http-agent",
    env,
    observe,
  );
  const restoreHttps = installAgentGuard(
    https.Agent.prototype as unknown as { createConnection?: (...args: never[]) => unknown },
    "https-agent",
    env,
    observe,
  );
  return () => {
    restoreFetch();
    restoreHttp();
    restoreHttps();
  };
}
