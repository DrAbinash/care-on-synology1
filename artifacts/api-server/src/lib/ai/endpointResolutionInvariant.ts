/**
 * Fail-closed identity check across health / inference / overnight Ollama URLs.
 * Does not resolve endpoints — callers pass already-resolved URLs from
 * resolveLocalAiRuntime() / generateAiResponse diagnostics.
 */

export function normalizeEndpointIdentity(url: string): string {
  return (url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

export type EndpointResolutionInvariantInput = {
  resolvedHealthEndpoint: string;
  resolvedInferenceEndpoint: string;
  resolvedOvernightEndpoint: string;
};

export type EndpointResolutionInvariantResult =
  | { ok: true; code: null }
  | {
      ok: false;
      code: "ENDPOINT_RESOLUTION_MISMATCH";
      resolvedHealthEndpoint: string;
      resolvedInferenceEndpoint: string;
      resolvedOvernightEndpoint: string;
      detail: string;
    };

export function assertEndpointResolutionIdentity(
  input: EndpointResolutionInvariantInput,
): EndpointResolutionInvariantResult {
  const health = normalizeEndpointIdentity(input.resolvedHealthEndpoint);
  const inference = normalizeEndpointIdentity(input.resolvedInferenceEndpoint);
  const overnight = normalizeEndpointIdentity(input.resolvedOvernightEndpoint);

  if (!health || !inference || !overnight) {
    return {
      ok: false,
      code: "ENDPOINT_RESOLUTION_MISMATCH",
      resolvedHealthEndpoint: input.resolvedHealthEndpoint,
      resolvedInferenceEndpoint: input.resolvedInferenceEndpoint,
      resolvedOvernightEndpoint: input.resolvedOvernightEndpoint,
      detail:
        "One or more resolved endpoints are empty — cannot prove health/inference/overnight identity",
    };
  }

  if (health === inference && inference === overnight) {
    return { ok: true, code: null };
  }

  return {
    ok: false,
    code: "ENDPOINT_RESOLUTION_MISMATCH",
    resolvedHealthEndpoint: input.resolvedHealthEndpoint,
    resolvedInferenceEndpoint: input.resolvedInferenceEndpoint,
    resolvedOvernightEndpoint: input.resolvedOvernightEndpoint,
    detail: [
      "Health, inference, and overnight Ollama endpoints must be identical.",
      `health=${input.resolvedHealthEndpoint}`,
      `inference=${input.resolvedInferenceEndpoint}`,
      `overnight=${input.resolvedOvernightEndpoint}`,
    ].join(" "),
  };
}
