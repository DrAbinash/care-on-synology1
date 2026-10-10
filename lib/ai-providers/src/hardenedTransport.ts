/**
 * Hardened HTTP transport for local AI providers.
 *
 * WHY THIS FILE EXISTS
 * PROMPT 6 (endpoint-derived locality) classifies providers based on the URL
 * hostname. But the URL check and the actual HTTP connection are separated by
 * a TOCTOU gap:
 *
 *   1. REDIRECT FOLLOWING: The SSRF guard validates the configured URL, but
 *      fetch/SDK follow redirects by default. A malicious local server could
 *      302-redirect to http://169.254.169.254/ (cloud metadata).
 *
 *   2. DNS REBINDING: The guard checks the hostname, but DNS resolution
 *      happens inside fetch/SDK AFTER the guard passes. An attacker controlling
 *      DNS can return a private IP at guard-check time and a public IP at
 *      connection time.
 *
 *   3. PROXY ENV VARS: If the runtime ever adds HTTP_PROXY/HTTPS_PROXY support,
 *      traffic could be silently redirected through a proxy.
 *
 * This module closes all three gaps for LOCAL provider connections:
 *   - Pre-resolves DNS and validates ALL A/AAAA records are private/LAN
 *   - Binds the TCP connection to the validated IP via custom Agent lookup
 *   - Preserves the original Host header (for HTTP virtual hosting)
 *   - Preserves TLS SNI and certificate validation (for HTTPS)
 *   - Uses redirect: "manual" — any 3xx response is treated as an error
 *   - Native http/https modules do NOT respect HTTP_PROXY by default
 *
 * SECURITY INVARIANT
 * For BOTH HTTP and HTTPS connections to local providers, the TCP connection
 * is bound to a pre-validated IP address via a custom Agent lookup function.
 * The URL hostname is unchanged, so Host headers and TLS SNI work correctly.
 * DNS rebinding is impossible because the socket connects to the validated IP,
 * not whatever DNS returns at connection time.
 *
 * PURE + DNS — no DB, no application state. Only depends on providerLocality.ts
 * for IP classification and node:dns/promises for resolution.
 */

import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { Readable } from "node:stream";
import {
  isHostPrivateOrLan,
  isHostCloudMetadata,
} from "./providerLocality";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HardenedFetchResult = {
  /** The validated IP the connection was bound to. */
  boundIp: string;
  /** The original hostname (before IP replacement). */
  originalHost: string;
};

export type HardenedFetchError =
  | "dns_resolution_failed"
  | "dns_resolved_to_public_ip"
  | "dns_resolved_to_cloud_metadata"
  | "redirect_not_allowed"
  | "connection_refused"
  | "transport_error";

// ─── DNS pre-resolution + IP validation ───────────────────────────────────────

/**
 * Pre-resolve a hostname and validate ALL returned IPs are private/LAN.
 * Returns the validated IPs. Throws if any IP is public or cloud metadata.
 *
 * Loopback hostnames (localhost, 127.0.0.1, ::1) are accepted without DNS
 * resolution — they are always private by definition.
 *
 * IP literals (e.g. "192.168.1.100") are validated directly without DNS.
 */
export async function resolveAndValidatePrivateIps(
  hostname: string,
): Promise<{ ips: string[]; isLoopback: boolean }> {
  const host = hostname.trim().toLowerCase();

  // Loopback — always safe, no DNS needed
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return { ips: ["127.0.0.1"], isLoopback: true };
  }

  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isHostCloudMetadata(host)) {
      throw Object.assign(
        new Error(`IP ${host} is a cloud metadata endpoint`),
        { code: "dns_resolved_to_cloud_metadata" as const },
      );
    }
    if (!isHostPrivateOrLan(host)) {
      throw Object.assign(
        new Error(`IP ${host} is not in a private/LAN range`),
        { code: "dns_resolved_to_public_ip" as const },
      );
    }
    return { ips: [host], isLoopback: /^127\./.test(host) };
  }

  // IPv6 literal (bracketed or bare)
  const debracketed = host.replace(/^\[/, "").replace(/\]$/, "");
  if (debracketed.includes(":")) {
    // IPv6 — check if it's a known private form
    if (isHostCloudMetadata(debracketed)) {
      throw Object.assign(
        new Error(`IPv6 ${debracketed} is a cloud metadata endpoint`),
        { code: "dns_resolved_to_cloud_metadata" as const },
      );
    }
    if (!isHostPrivateOrLan(debracketed)) {
      throw Object.assign(
        new Error(`IPv6 ${debracketed} is not in a private/LAN range`),
        { code: "dns_resolved_to_public_ip" as const },
      );
    }
    return { ips: [debracketed], isLoopback: debracketed === "::1" };
  }

  // Hostname — resolve via DNS
  let results: Array<{ address: string; family: number }>;
  try {
    results = await lookup(host, { all: true });
  } catch (err) {
    throw Object.assign(
      new Error(
        `DNS resolution failed for ${host}: ${err instanceof Error ? err.message : String(err)}`,
      ),
      { code: "dns_resolution_failed" as const },
    );
  }

  if (!results || results.length === 0) {
    throw Object.assign(new Error(`DNS returned no addresses for ${host}`), {
      code: "dns_resolution_failed" as const,
    });
  }

  // Validate ALL resolved IPs
  for (const r of results) {
    if (isHostCloudMetadata(r.address)) {
      throw Object.assign(
        new Error(
          `DNS for ${host} resolved to cloud metadata endpoint ${r.address}`,
        ),
        { code: "dns_resolved_to_cloud_metadata" as const },
      );
    }
    if (!isHostPrivateOrLan(r.address)) {
      throw Object.assign(
        new Error(
          `DNS for ${host} resolved to non-private address ${r.address}`,
        ),
        { code: "dns_resolved_to_public_ip" as const },
      );
    }
  }

  return {
    ips: results.map((r) => r.address),
    isLoopback: results.every(
      (r) => r.address === "127.0.0.1" || r.address === "::1",
    ),
  };
}

// ─── Bound fetch: DNS-pinned HTTP/HTTPS via custom Agent lookup ─────────────

/**
 * Node.js http/https Agent lookup callback signature (Node 24+).
 * The array form is required: callback(null, [{address, family}]).
 * The old 3-arg form (err, address, family) throws ERR_INVALID_IP_ADDRESS.
 */
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  addresses: Array<{ address: string; family: number }>,
) => void;

type LookupFunction = (
  hostname: string,
  options: unknown,
  callback: LookupCallback,
) => void;

/**
 * Creates a fetch-compatible function that binds TCP connections to pre-validated
 * IPs using node:http/https Agents with custom lookup.
 *
 * HOW IT WORKS
 * 1. Pre-resolves DNS via resolveAndValidatePrivateIps() — all IPs must be private
 * 2. Creates an http.Agent or https.Agent with a custom lookup function
 * 3. The lookup function returns ONLY the pre-validated IPs (no fresh DNS query)
 * 4. The URL hostname is UNCHANGED — Host header and TLS SNI work correctly
 * 5. The TCP socket connects to the validated IP — DNS rebinding is impossible
 *
 * SECURITY PROPERTIES
 * - HTTP: Host header preserved (original hostname:port)
 * - HTTPS: TLS SNI preserved, certificate validated against original hostname
 * - BOTH: TCP connection bound to validated IP — no DNS rebinding window
 * - Redirects: 3xx responses throw (redirect: "manual" enforced)
 * - Proxy: node:http/https do NOT use HTTP_PROXY by default
 *
 * LIMITATIONS
 * - Body streaming: the response body is buffered into memory (acceptable for
 *   AI provider responses which are typically <1MB JSON)
 * - No keep-alive: agents are created per-request (acceptable for low-frequency
 *   AI provider calls; could be optimized with agent pooling later)
 */
async function createBoundFetch(opts?: {
  /** When false, skip DNS binding — only disable redirects. Default: true. */
  enforceBinding?: boolean;
}): Promise<typeof globalThis.fetch> {
  const enforceBinding = opts?.enforceBinding !== false;

  // Cache DNS resolutions per hostname to avoid re-resolving for every request
  const dnsCache = new Map<string, { ips: string[]; isLoopback: boolean }>();

  async function resolveCached(hostname: string) {
    const cached = dnsCache.get(hostname);
    if (cached) return cached;
    const result = await resolveAndValidatePrivateIps(hostname);
    dnsCache.set(hostname, result);
    return result;
  }

  /**
   * Convert a Node.js IncomingMessage to a Web Response.
   * Buffers the body into memory (acceptable for AI provider responses).
   */
  function toWebResponse(
    msg: http.IncomingMessage,
    requestUrl: URL,
  ): Response {
    const status = msg.statusCode ?? 0;
    const statusText = msg.statusMessage ?? "";

    // Convert Node.js headers to a Headers object
    const headers = new Headers();
    const rawHeaders = msg.headers;
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.set(key, value);
      }
    }

    // Buffer the body from the Node.js stream
    const bodyPromise = new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Buffer[] = [];
      msg.on("data", (chunk: Buffer) => chunks.push(chunk));
      msg.on("end", () => resolve(Buffer.concat(chunks)));
      msg.on("error", reject);
    });

    // Create a ReadableStream from the buffered body
    // We need to wait for the body before constructing the Response
    // because Response body must be a stream or null
    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            const body = await bodyPromise;
            if (body.length > 0) {
              controller.enqueue(body);
            }
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      }),
      { status, statusText, headers },
    );
  }

  /**
   * Make an HTTP/HTTPS request using a bound Agent.
   */
  function boundRequest(
    url: URL,
    validatedIps: string[],
    init?: RequestInit,
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const isHttps = url.protocol === "https:";
      const port = url.port || (isHttps ? "443" : "80");

      // Create a custom lookup function that returns ONLY the pre-validated IPs
      const lookupFn: LookupFunction = (_hostname, _options, callback) => {
        const addresses = validatedIps.map((ip) => ({
          address: ip,
          family: ip.includes(":") ? 6 : 4,
        }));
        callback(null, addresses);
      };

      // Create the Agent with the custom lookup
      const agent = isHttps
        ? new https.Agent({
            keepAlive: false,
            lookup: lookupFn as any,
          })
        : new http.Agent({
            keepAlive: false,
            lookup: lookupFn as any,
          });

      // Convert Web Headers to Node.js headers
      const nodeHeaders: Record<string, string | string[]> = {};
      if (init?.headers) {
        const h = new Headers(init.headers);
        h.forEach((value, key) => {
          const existing = nodeHeaders[key];
          if (existing) {
            nodeHeaders[key] = Array.isArray(existing)
              ? [...existing, value]
              : [existing, value];
          } else {
            nodeHeaders[key] = value;
          }
        });
      }

      // Prepare the request body
      let body: string | Buffer | Uint8Array | null = null;
      if (init?.body != null) {
        if (typeof init.body === "string") {
          body = init.body;
        } else if (init.body instanceof Uint8Array) {
          body = Buffer.from(init.body);
        } else if (typeof init.body === "object" && "arrayBuffer" in init.body) {
          // Blob or similar — convert synchronously if possible
          body = init.body as unknown as Buffer;
        }
      }

      const requestOptions: http.RequestOptions = {
        method: init?.method ?? "GET",
        hostname: url.hostname,
        port,
        path: url.pathname + url.search,
        headers: nodeHeaders,
        agent,
      };

      const makeRequest = isHttps
        ? https.request
        : http.request;

      const req = makeRequest(requestOptions, (res) => {
        const response = toWebResponse(res, url);
        resolve(response);
      });

      req.on("error", (err) => {
        reject(err);
      });

      if (body != null) {
        req.write(body);
      }
      req.end();
    });
  }

  // Return the fetch-compatible function
  return async function hardenedFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const url = new URL(urlStr);
    const originalHostname = url.hostname;

    let validatedIps: string[] | null = null;

    if (enforceBinding) {
      const result = await resolveCached(originalHostname);
      validatedIps = result.ips;
    }

    // Make the bound request
    const resp = validatedIps
      ? await boundRequest(url, validatedIps, init)
      : await globalThis.fetch(urlStr, { ...init, redirect: "manual" });

    // Check for redirect attempts — 3xx is always an error
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location") ?? "(none)";
      await resp.body?.cancel().catch(() => {});
      throw Object.assign(
        new Error(
          `Redirect not allowed: HTTP ${resp.status} → ${location}. ` +
            `Local AI providers must not redirect requests.`,
        ),
        {
          code: "redirect_not_allowed" as const,
          httpStatus: resp.status,
          location,
          boundIp: validatedIps?.[0] ?? null,
        },
      );
    }

    return resp;
  };
}

// ─── Hardened fetch wrapper (public API) ──────────────────────────────────────

/**
 * Creates a fetch function that enforces local binding for HTTP/HTTPS connections.
 *
 * The returned function:
 * 1. Parses the URL and extracts the hostname
 * 2. Pre-resolves DNS and validates ALL IPs are private/LAN
 * 3. Creates an http/https Agent with custom lookup returning validated IPs
 * 4. The TCP connection binds to the validated IP — no DNS rebinding
 * 5. The URL hostname is unchanged — Host header and TLS SNI preserved
 * 6. Uses redirect: "manual" — any 3xx response throws
 *
 * SECURITY: Works for BOTH HTTP and HTTPS. For HTTPS, TLS SNI and certificate
 * validation work correctly because the URL hostname is unchanged.
 *
 * The `enforceBinding` parameter controls whether DNS binding is enforced.
 * When false, only redirect control is applied (used for cloud providers
 * where DNS binding is not applicable).
 */
export function createHardenedLocalFetch(opts?: {
  /** When false, skip DNS binding — only disable redirects. Default: true. */
  enforceBinding?: boolean;
}): typeof globalThis.fetch {
  // Create the bound fetch lazily and cache it
  let cachedFetch: typeof globalThis.fetch | null = null;
  let createPromise: Promise<typeof globalThis.fetch> | null = null;

  async function getBoundFetch(): Promise<typeof globalThis.fetch> {
    if (cachedFetch) return cachedFetch;
    if (createPromise) return createPromise;
    createPromise = createBoundFetch(opts).then((f) => {
      cachedFetch = f;
      return f;
    });
    return createPromise;
  }

  // Return a synchronous wrapper that defers to the async bound fetch
  return function hardenedFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    return getBoundFetch().then((fetch) => fetch(input, init));
  };
}

// ─── Hardened RequestInit for native fetch calls ──────────────────────────────

/**
 * Returns RequestInit options that disable redirect following.
 * Use this for native fetch calls where a full hardened fetch wrapper is not
 * needed (e.g., when the caller handles DNS binding separately).
 *
 * The caller MUST still validate DNS before calling fetch — this function
 * only controls the redirect behavior.
 */
export function noRedirectInit(init?: RequestInit): RequestInit {
  return {
    ...init,
    redirect: "manual",
  };
}

/**
 * Check a fetch response for redirect status and throw if found.
 * Call this after a native fetch with `redirect: "manual"` to detect
 * redirect attempts.
 *
 * Returns the response unchanged if it's not a redirect.
 */
export async function assertNoRedirect(
  resp: Response,
  context: { originalUrl: string; boundIp?: string | null },
): Promise<Response> {
  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get("location") ?? "(none)";
    await resp.body?.cancel().catch(() => {});
    throw Object.assign(
      new Error(
        `Redirect not allowed: HTTP ${resp.status} → ${location} ` +
          `(original: ${context.originalUrl}). ` +
          `Local AI providers must not redirect requests.`,
      ),
      {
        code: "redirect_not_allowed" as const,
        httpStatus: resp.status,
        location,
        boundIp: context.boundIp ?? null,
      },
    );
  }
  return resp;
}

// ─── Convenience: hardened local fetch for simple GET/POST calls ──────────────

/**
 * One-shot hardened fetch for local AI provider endpoints.
 *
 * Uses the bound fetch approach: pre-resolves DNS, validates all IPs are
 * private/LAN, binds the TCP connection to the validated IP via custom Agent
 * lookup, and rejects any 3xx redirect response.
 *
 * Works for BOTH HTTP and HTTPS. For HTTPS, TLS SNI and certificate validation
 * work correctly because the URL hostname is unchanged.
 *
 * Returns the Response and the bound IP for diagnostics.
 */
export async function hardenedLocalRequest(
  rawUrl: string,
  init?: RequestInit,
): Promise<{ response: Response; boundIp: string; originalHost: string }> {
  const url = new URL(rawUrl);
  const originalHost = url.host;

  // Pre-resolve DNS and validate all IPs
  const { ips } = await resolveAndValidatePrivateIps(url.hostname);
  const boundIp = ips[0];

  // Use the bound fetch to make the request
  const boundFetch = await createBoundFetch({ enforceBinding: true });
  const response = await boundFetch(rawUrl, init);

  return { response, boundIp, originalHost };
}

// ─── URL rewriting helper (backward compatibility) ────────────────────────────

/**
 * Rewrite a URL string to use the validated IP instead of the hostname.
 * Returns the rewritten URL string and the original host for the Host header.
 *
 * DEPRECATED: This function rewrites the URL hostname to the validated IP,
 * which works for HTTP but breaks HTTPS (TLS certificate validation fails
 * when the hostname doesn't match the certificate). For new code, prefer
 * `createHardenedLocalFetch()` or `hardenedLocalRequest()` which use the
 * bound fetch approach — they preserve the URL hostname and bind the TCP
 * connection to the validated IP via a custom Agent lookup.
 *
 * This function is kept for backward compatibility with existing call sites
 * that use it for URL validation and DNS pre-resolution. For HTTPS URLs,
 * it returns the URL unchanged (with the validated IP available for diagnostics).
 *
 * Throws if DNS resolution fails or resolves to a non-private IP.
 */
export async function rewriteUrlToValidatedIp(
  rawUrl: string,
): Promise<{ rewrittenUrl: string; originalHost: string; boundIp: string }> {
  const url = new URL(rawUrl);

  if (url.protocol !== "http:") {
    // HTTPS — cannot rewrite (TLS cert validation). Return as-is.
    // The boundIp is still available for diagnostics.
    const { ips } = await resolveAndValidatePrivateIps(url.hostname);
    return {
      rewrittenUrl: rawUrl,
      originalHost: url.host,
      boundIp: ips[0],
    };
  }

  const { ips } = await resolveAndValidatePrivateIps(url.hostname);
  const originalHost = url.host;
  url.hostname = ips[0];

  return {
    rewrittenUrl: url.href,
    originalHost,
    boundIp: ips[0],
  };
}
