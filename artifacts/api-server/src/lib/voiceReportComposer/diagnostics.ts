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
  };
}
