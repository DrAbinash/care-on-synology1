/**
 * abdmGateway.ts — thin, credentials-gated client for the ABDM gateway.
 *
 * ABDM (Ayushman Bharat Digital Mission) requires a registered HIP/HIU with
 * client credentials, a public callback URL, and — for actual health-data
 * exchange — RSA encryption of payloads and X-HMAC signature verification of
 * inbound callbacks. Those cryptographic layers are deployment-specific and are
 * NOT implemented here; this client provides the pieces that are safe and
 * useful without them: configuration gating, gateway session-token acquisition
 * with caching, and a generic authenticated POST. See
 * docs/CARE_ERP_ABDM_INTEGRATION.md for the activation checklist.
 *
 * Everything is inert until ABDM_ENABLED=true and credentials are set: callers
 * should guard with isAbdmConfigured() (routes turn "not configured" into 503).
 */

export class AbdmNotConfiguredError extends Error {
  constructor() {
    super("ABDM is not configured on this server");
    this.name = "AbdmNotConfiguredError";
  }
}

export interface AbdmConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  cmId: string;      // consent-manager / registrar id, e.g. "sbx"
  hipId: string;
  hipName: string;
  sessionPath: string;
}

export function readAbdmConfig(): AbdmConfig | null {
  if ((process.env.ABDM_ENABLED ?? "").toLowerCase() !== "true") return null;
  const clientId = process.env.ABDM_CLIENT_ID ?? "";
  const clientSecret = process.env.ABDM_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) return null;
  return {
    baseUrl: (process.env.ABDM_BASE_URL ?? "https://dev.abdm.gov.in").replace(/\/$/, ""),
    clientId,
    clientSecret,
    cmId: process.env.ABDM_CM_ID ?? "sbx",
    hipId: process.env.ABDM_HIP_ID ?? "",
    hipName: process.env.ABDM_HIP_NAME ?? "CARE Diagnostics",
    sessionPath: process.env.ABDM_SESSION_PATH ?? "/api/hiecm/gateway/v3/sessions",
  };
}

export function isAbdmConfigured(): boolean {
  return readAbdmConfig() != null;
}

// ── Session-token cache ──────────────────────────────────────────────────────

interface CachedToken { token: string; expiresAt: number }
let cached: CachedToken | null = null;

/** Exposed for tests / forced refresh. */
export function _clearTokenCache(): void { cached = null; }

/**
 * Fetch (and cache) a gateway session access token. Refreshes ~60s before
 * expiry. Throws AbdmNotConfiguredError if ABDM is not configured.
 */
export async function getSessionToken(now: number = Date.now()): Promise<string> {
  const cfg = readAbdmConfig();
  if (!cfg) throw new AbdmNotConfiguredError();
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;

  const res = await fetch(cfg.baseUrl + cfg.sessionPath, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "X-CM-ID": cfg.cmId },
    body: JSON.stringify({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, grantType: "client_credentials" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ABDM session request failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { accessToken?: string; expiresIn?: number };
  if (!body.accessToken) throw new Error("ABDM session response missing accessToken");
  cached = { token: body.accessToken, expiresAt: now + (body.expiresIn ?? 1200) * 1000 };
  return cached.token;
}

export interface AbdmCallResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * Authenticated POST to a gateway endpoint. Adds the session bearer token,
 * X-CM-ID and correlation headers. Does NOT encrypt payloads — callers must not
 * pass raw health data through this until the encryption layer is added.
 */
export async function abdmPost(path: string, payload: unknown, requestId: string): Promise<AbdmCallResult> {
  const cfg = readAbdmConfig();
  if (!cfg) throw new AbdmNotConfiguredError();
  const token = await getSessionToken();
  const res = await fetch(cfg.baseUrl + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
      "X-CM-ID": cfg.cmId,
      "REQUEST-ID": requestId,
      "TIMESTAMP": new Date().toISOString(),
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}
