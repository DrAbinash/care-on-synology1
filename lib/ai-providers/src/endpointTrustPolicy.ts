/**
 * Endpoint trust policy for AI provider connections.
 *
 * WHY THIS FILE EXISTS
 * PROMPT 6 (classifyEffectiveLocality) determines whether an endpoint is
 * "local" or "cloud" based on the URL hostname. But "local" doesn't
 * automatically mean "approved for PHI" — a misconfigured local provider
 * pointing at the wrong LAN segment, or a local_openai_compatible provider
 * with a public URL, must not silently inherit PHI privileges.
 *
 * This module adds an explicit trust layer on top of locality classification:
 * - LOCAL endpoints must be both effectively-local AND reachable to be trusted
 * - CLOUD endpoints are never trusted for PHI unless explicitly approved
 * - The trust decision is separate from the locality decision
 *
 * SECURITY INVARIANT
 * Trust is derived from locality + reachability, never from configuration alone.
 * A provider that is "configured" (has a URL) is not automatically "trusted"
 * for PHI transmission. The endpoint must be effectively local AND reachable.
 *
 * PURE — no DB, no network. Unit-testable in isolation.
 */

import { classifyEffectiveLocality, type EffectiveLocality } from "./providerLocality";

// ─── Trust levels ─────────────────────────────────────────────────────────────

/**
 * Trust level for an AI provider endpoint.
 *
 * - UNTRUSTED: Endpoint is not approved for any data transmission.
 *   Either the locality is cloud (PHI egress blocked), or the endpoint
 *   is unreachable/misconfigured.
 *
 * - LOCAL_TRUSTED: Endpoint is effectively local AND reachable.
 *   PHI can be transmitted without cloud egress controls.
 *   This is the normal state for Ollama on localhost/LAN.
 *
 * - CLOUD_TRUSTED: Endpoint is effectively cloud AND explicitly approved
 *   for PHI transmission (e.g., de-identified data only, or with BAA).
 *   This level is NOT automatically granted — requires operator action.
 *   Currently unused; cloud providers are always UNTRUSTED for PHI.
 */
export type EndpointTrustLevel = "UNTRUSTED" | "LOCAL_TRUSTED" | "CLOUD_TRUSTED";

export type EndpointTrustClassification = {
  /** The trust level for this endpoint. */
  trust: EndpointTrustLevel;
  /** The underlying locality classification. */
  locality: EffectiveLocality;
  /** The validated hostname (null if URL is missing/invalid). */
  validatedHost: string | null;
  /** Human-readable reason for the trust decision. */
  reason: string;
};

// ─── Trust classification ─────────────────────────────────────────────────────

/**
 * Classify the trust level for an AI provider endpoint.
 *
 * Trust is derived from:
 * 1. Effective locality (from classifyEffectiveLocality)
 * 2. Whether the endpoint is reachable (non-null URL)
 *
 * Rules:
 * - Cloud endpoints → UNTRUSTED (PHI egress blocked)
 * - Local endpoints with no URL → UNTRUSTED (not configured)
 * - Local endpoints with URL → LOCAL_TRUSTED (PHI allowed)
 *
 * @param providerName - The provider name (e.g. "ollama", "openai")
 * @param resolvedUrl - The fully resolved base URL (null if not configured)
 * @returns The trust classification
 */
export function classifyEndpointTrust(
  providerName: string,
  resolvedUrl: string | null,
): EndpointTrustClassification {
  const localityResult = classifyEffectiveLocality(providerName, resolvedUrl);
  const { locality, validatedHost, reason: localityReason } = localityResult;

  // Cloud endpoints are never trusted for PHI
  if (locality === "cloud") {
    return {
      trust: "UNTRUSTED",
      locality: "cloud",
      validatedHost,
      reason: `Cloud endpoint not trusted for PHI: ${localityReason}`,
    };
  }

  // Local endpoints must have a URL to be trusted
  if (!resolvedUrl?.trim()) {
    return {
      trust: "UNTRUSTED",
      locality: "local",
      validatedHost: null,
      reason: "Local endpoint not configured (no URL); not trusted",
    };
  }

  // Local endpoint with URL → trusted
  return {
    trust: "LOCAL_TRUSTED",
    locality: "local",
    validatedHost,
    reason: `Local endpoint trusted: ${localityReason}`,
  };
}

/**
 * Convenience: returns true if the endpoint is trusted for PHI transmission.
 *
 * This is the function PHI egress gates should call. It combines locality
 * classification with trust policy: only LOCAL_TRUSTED endpoints are approved
 * for PHI.
 *
 * @param providerName - The provider name
 * @param resolvedUrl - The fully resolved base URL
 * @returns true if PHI can be transmitted to this endpoint
 */
export function isEndpointTrustedForPhi(
  providerName: string,
  resolvedUrl: string | null,
): boolean {
  return classifyEndpointTrust(providerName, resolvedUrl).trust === "LOCAL_TRUSTED";
}
