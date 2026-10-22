/**
 * PHI-safe composer diagnostics — never include transcript text.
 */
import { randomUUID } from "node:crypto";

export type ComposerDiagnostics = {
  requestId: string;
  provider: "ollama";
  model: string;
  fallbackUsed?: boolean;
  endpointSource?: string;
  region?: string;
  transcriptLength: number;
  latencyMs: number;
  validationMs?: number;
  validationOk: boolean;
  schemaOk?: boolean;
  phraseFallback?: boolean;
  /**
   * PHI-safe reason code for a provider/parse failure — e.g. "timeout",
   * "model_not_found", "http_500", "schema_invalid". Never the prompt, the
   * model response or the transcript, which all carry clinical text. Previously
   * these errors were swallowed by bare catch blocks, so an operator could only
   * see "Local composer unavailable" with no way to tell a slow model from a
   * missing fallback model from a network refusal.
   */
  failureReason?: string;
};

export function newComposerRequestId(): string {
  return randomUUID();
}

export function buildDiagnostics(opts: {
  requestId: string;
  model: string;
  region?: string;
  transcriptLength: number;
  latencyMs: number;
  validationMs?: number;
  validationOk: boolean;
  schemaOk?: boolean;
  fallbackUsed?: boolean;
  endpointSource?: string;
  phraseFallback?: boolean;
  failureReason?: string;
}): ComposerDiagnostics {
  return {
    requestId: opts.requestId,
    provider: "ollama",
    model: opts.model,
    fallbackUsed: opts.fallbackUsed,
    endpointSource: opts.endpointSource,
    region: opts.region,
    transcriptLength: opts.transcriptLength,
    latencyMs: opts.latencyMs,
    validationMs: opts.validationMs,
    validationOk: opts.validationOk,
    schemaOk: opts.schemaOk,
    phraseFallback: opts.phraseFallback,
    failureReason: opts.failureReason,
  };
}
