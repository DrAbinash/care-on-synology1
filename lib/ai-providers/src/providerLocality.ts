/**
 * Endpoint-derived provider locality classification.
 *
 * WHY THIS FILE EXISTS
 * `isLocalExecutionProvider()` classifies providers as "local" based solely on
 * the provider name string ("ollama" or "local_openai_compatible"). This is
 * correct for provider-chain ordering (try local first), but it is NOT safe
 * for PHI egress gating: a `local_openai_compatible` provider whose base URL
 * points to a public internet endpoint (e.g. "https://api.openai.com") would
 * bypass all cloud PHI controls because its name contains "local".
 *
 * This module closes that gap. `classifyEffectiveLocality()` takes the
 * provider name AND its resolved, validated base URL, and returns the
 * effective locality based on the actual network destination. A provider
 * named "local_openai_compatible" with a public URL is classified as "cloud"
 * for PHI egress purposes, regardless of its name.
 *
 * SECURITY INVARIANT
 * Provider locality is derived from the effective validated network destination.
 * Never classify a provider as local solely because its registry key or adapter
 * name contains "local". The URL is the ground truth.
 *
 * PURE — no DB, no network. Unit-testable in isolation.
 */

// Private / LAN / CGNAT ranges — these are considered "local" for PHI purposes.
// Duplicated from artifacts/api-server/src/lib/ssrf/ollamaUrlGuard.ts for
// independence: the SSRF guard blocks dangerous requests; this classifier
// determines PHI gate applicability. They share the same policy but serve
// different purposes and evolve independently.
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/, // link-local
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/, // CGNAT / Tailscale
  /^\[?::1\]?$/, // IPv6 loopback
  /^\[?fe80::/i, // IPv6 link-local
  /^\[?f[cd][0-9a-f]{2}:/i, // IPv6 unique-local fc00::/7
];

// Cloud metadata endpoints — NEVER considered local, even if they happen to
// respond on a private IP. These are always cloud egress.
const CLOUD_METADATA_HOSTS: RegExp[] = [
  /^169\.254\.169\.254$/, // AWS/GCP/Azure/OpenStack metadata
  /^metadata(\.google)?\.internal$/i,
];

/**
 * Canonicalise the URL hostname for locality matching. Handles:
 * - Trailing dots (localhost., 127.0.0.1.)
 * - IPv4-mapped IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1)
 * - Bracketed IPv6 ([::1], [fe80::1])
 * Returns all canonical forms so every representation is checked.
 */
export function canonicalHostsForLocality(rawHostname: string): string[] {
  const hosts = new Set<string>();
  const host = rawHostname.trim().toLowerCase();
  const debracketed = host.replace(/^\[/, "").replace(/\]$/, "");
  const noTrailingDot = debracketed.replace(/\.+$/, "");
  hosts.add(host);
  hosts.add(debracketed);
  hosts.add(noTrailingDot);
  // IPv4-mapped IPv6: ::ffff:127.0.0.1 or ::ffff:7f00:1
  const mapped = /^::(?:ffff:)?(.+)$/i.exec(debracketed);
  if (mapped) {
    const rest = mapped[1];
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) {
      hosts.add(rest);
    } else {
      const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
      if (hex) {
        const h1 = parseInt(hex[1], 16),
          h2 = parseInt(hex[2], 16);
        hosts.add(`${(h1 >> 8) & 0xff}.${h1 & 0xff}.${(h2 >> 8) & 0xff}.${h2 & 0xff}`);
      }
    }
  }
  return [...hosts];
}

/**
 * Returns true if the hostname (in any canonical form) matches a private/LAN
 * address range. Does NOT check cloud metadata endpoints — those are checked
 * separately because they have different semantics (always cloud, never local).
 */
export function isHostPrivateOrLan(hostname: string): boolean {
  const candidates = canonicalHostsForLocality(hostname);
  return PRIVATE_HOST_PATTERNS.some((re) => candidates.some((h) => re.test(h)));
}

/**
 * Returns true if the hostname is a known cloud metadata endpoint.
 * These are NEVER considered local, even if they respond on a link-local IP.
 */
export function isHostCloudMetadata(hostname: string): boolean {
  const candidates = canonicalHostsForLocality(hostname);
  return CLOUD_METADATA_HOSTS.some((re) => candidates.some((h) => re.test(h)));
}

export type EffectiveLocality = "local" | "cloud";

export type LocalityClassification = {
  locality: EffectiveLocality;
  /** The validated hostname extracted from the URL. */
  validatedHost: string | null;
  /** Human-readable reason for the classification. */
  reason: string;
};

/**
 * Classify the effective locality of a provider based on its resolved URL.
 *
 * For providers classified as "local" by name (ollama, local_openai_compatible),
 * this function checks whether the URL actually points to a private/LAN address.
 * If the URL points to a public internet destination, the provider is reclassified
 * as "cloud" for PHI egress purposes.
 *
 * For providers already classified as "cloud" by name (openai, deepseek, qwen, etc.),
 * this function returns "cloud" regardless of the URL.
 *
 * @param providerName - The provider name (e.g. "ollama", "local_openai_compatible", "openai")
 * @param resolvedUrl - The fully resolved base URL for the provider (may be null if not configured)
 * @returns The effective locality classification
 */
export function classifyEffectiveLocality(
  providerName: string,
  resolvedUrl: string | null,
): LocalityClassification {
  // Cloud providers are always cloud, regardless of URL.
  // (If someone points "openai" at localhost, it's still a cloud provider
  // from a policy perspective — but that's a misconfiguration, not a locality bypass.)
  if (
    providerName === "openai" ||
    providerName === "deepseek" ||
    providerName === "qwen" ||
    providerName === "gemini" ||
    providerName === "anthropic"
  ) {
    return {
      locality: "cloud",
      validatedHost: resolvedUrl ? safeExtractHost(resolvedUrl) : null,
      reason: `Provider "${providerName}" is classified as cloud by registry`,
    };
  }

  // For "local" providers, the URL is the ground truth.
  if (!resolvedUrl) {
    // No URL resolved — provider is not configured. Treat as local (it won't
    // make any requests anyway, and the adapter will refuse with "not configured").
    return {
      locality: "local",
      validatedHost: null,
      reason: "No URL resolved; provider not configured (adapter will refuse)",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(resolvedUrl);
  } catch {
    // Invalid URL — treat as cloud (fail closed: apply PHI controls).
    return {
      locality: "cloud",
      validatedHost: null,
      reason: `Invalid URL format; failing closed as cloud: "${resolvedUrl}"`,
    };
  }

  const hostname = parsed.hostname;

  // Cloud metadata endpoints are NEVER local.
  if (isHostCloudMetadata(hostname)) {
    return {
      locality: "cloud",
      validatedHost: hostname,
      reason: `Host "${hostname}" is a cloud metadata endpoint; never local`,
    };
  }

  // Private/LAN addresses are local.
  if (isHostPrivateOrLan(hostname)) {
    return {
      locality: "local",
      validatedHost: hostname,
      reason: `Host "${hostname}" is a private/LAN address`,
    };
  }

  // Public internet address — reclassify as cloud.
  return {
    locality: "cloud",
    validatedHost: hostname,
    reason: `Host "${hostname}" is a public internet address; reclassified from local to cloud for PHI egress`,
  };
}

/**
 * Extract the hostname from a URL string, returning null on parse failure.
 * Pure helper for use in classification results.
 */
function safeExtractHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Convenience: returns true if the provider+URL combination should be treated
 * as local for PHI egress purposes. This is the function the PHI gates should
 * call instead of `isLocalExecutionProvider(providerName)` when a resolved URL
 * is available.
 *
 * When no URL is available (e.g. provider chain ordering), fall back to
 * `isLocalExecutionProvider(providerName)` — it's safe for ordering because
 * no data is sent during ordering.
 */
export function isEffectivelyLocal(
  providerName: string,
  resolvedUrl: string | null,
): boolean {
  return classifyEffectiveLocality(providerName, resolvedUrl).locality === "local";
}
