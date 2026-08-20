/**
 * PHI-safe diagnostics for /api/ai-reporting/draft (and related CARE AI paths).
 * Never log images, base64, full prompts, or full model responses.
 */
import { randomUUID } from "node:crypto";
import type { AiQueryDiagnostics, AiQueryResult } from "@workspace/ai-providers";
import { logger } from "../logger";

export interface AiDraftImageFetchMeta {
  seriesSelected: number;
  imagesSelected: number;
  imageByteSizes: number[];
  totalImageBytes: number;
  fetchElapsedMs: number;
}

export interface AiDraftParserMeta {
  parserSuccess: boolean;
  hasFindingsSection: boolean;
  hasImpressionSection: boolean;
  findingsLength: number;
  impressionLength: number;
}

export interface AiReportingDraftDiagnostics {
  requestId: string;
  path: "/api/ai-reporting/draft";
  worklistId: number | null;
  provider: string;
  resolvedEndpoint: string | null;
  model: string | null;
  numberOfImages: number;
  totalImageBytes: number;
  imageByteSizes: number[];
  seriesSelected: number;
  promptLength: number;
  startedAt: string;
  imageFetchElapsedMs: number;
  providerElapsedMs: number | null;
  totalElapsedMs: number;
  httpStatus: number | null;
  responseLength: number;
  finishReason: string | null;
  parserSuccess: boolean | null;
  parser: AiDraftParserMeta | null;
  candidateCountBeforeTrust: number | null;
  candidateCountAccepted: number | null;
  candidateCountQuarantined: number | null;
  providerReturned: boolean;
  success: boolean;
  errorClass: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  timeoutStage: string | null;
  /** Provider-layer AbortSignal timeout; null means none on this path. */
  timeoutMsConfigured: number | null;
  /**
   * Clinic Local AI timeout (radiology-ollama path). Logged for comparison —
   * /api/ai-reporting/draft does NOT apply this AbortController today.
   */
  clinicOllamaTimeoutSeconds: number | null;
  /** Known timeout sources on the CARE draft path (documentation for ops). */
  timeoutSourcesNote: string;
}

export function newAiRequestId(): string {
  return randomUUID();
}

export function buildParserMeta(aiResponse: string, draftFindings: string, draftImpression: string): AiDraftParserMeta {
  const hasFindingsSection = /FINDINGS:?/i.test(aiResponse);
  const hasImpressionSection = /IMPRESSION:?/i.test(aiResponse);
  return {
    parserSuccess: draftFindings.trim().length > 0 || draftImpression.trim().length > 0,
    hasFindingsSection,
    hasImpressionSection,
    findingsLength: draftFindings.length,
    impressionLength: draftImpression.length,
  };
}

export function buildAiReportingDraftDiagnostics(input: {
  requestId: string;
  worklistId?: number | null;
  providerName: string;
  model: string | null;
  promptLength: number;
  startedAt: string;
  imageMeta: AiDraftImageFetchMeta;
  aiResult: AiQueryResult;
  parser: AiDraftParserMeta | null;
  clinicOllamaTimeoutSeconds: number | null;
  totalElapsedMs: number;
}): AiReportingDraftDiagnostics {
  const d: AiQueryDiagnostics | undefined = input.aiResult.diagnostics;
  const success = input.aiResult.success;
  return {
    requestId: input.requestId,
    path: "/api/ai-reporting/draft",
    worklistId: input.worklistId ?? null,
    provider: d?.provider ?? input.providerName,
    resolvedEndpoint: d?.resolvedEndpoint ?? null,
    model: d?.model ?? input.model,
    numberOfImages: d?.numberOfImages ?? input.imageMeta.imagesSelected,
    totalImageBytes: d?.totalImageBytes ?? input.imageMeta.totalImageBytes,
    imageByteSizes: input.imageMeta.imageByteSizes,
    seriesSelected: input.imageMeta.seriesSelected,
    promptLength: d?.promptLength ?? input.promptLength,
    startedAt: input.startedAt,
    imageFetchElapsedMs: input.imageMeta.fetchElapsedMs,
    providerElapsedMs: d?.elapsedMs ?? null,
    totalElapsedMs: input.totalElapsedMs,
    httpStatus: d?.httpStatus ?? null,
    responseLength: d?.responseLength ?? (input.aiResult.text?.length ?? 0),
    finishReason: d?.finishReason ?? null,
    parserSuccess: input.parser?.parserSuccess ?? null,
    parser: input.parser,
    candidateCountBeforeTrust: null,
    candidateCountAccepted: null,
    candidateCountQuarantined: null,
    providerReturned: success,
    success,
    errorClass: success ? null : (d?.errorClass ?? "AiProviderError"),
    errorCode: success ? null : (d?.errorCode ?? "AI_PROVIDER_ERROR"),
    errorMessage: success ? null : (d?.errorMessage ?? input.aiResult.error ?? "AI provider error").slice(0, 300),
    timeoutStage: d?.timeoutStage ?? null,
    timeoutMsConfigured: d?.timeoutMsConfigured ?? null,
    clinicOllamaTimeoutSeconds: input.clinicOllamaTimeoutSeconds,
    timeoutSourcesNote:
      "ai-reporting/draft → generateAiForTask → Ollama /api/chat has NO AbortController by default; " +
      "gateway overnight path uses withTimeout(10min); radiology-ollama uses clinic ollamaTimeoutSeconds (default 30s); " +
      "reverse proxies may still cut HTTP at ~30s.",
  };
}

/** Log PHI-safe draft diagnostics. Always call on failure; also on success for correlation. */
export function logAiReportingDraftDiagnostics(
  diag: AiReportingDraftDiagnostics,
  level: "info" | "error" = diag.success ? "info" : "error",
): void {
  const payload = {
    msg: diag.success ? "ai_reporting_draft_ok" : "ai_reporting_draft_failed",
    aiRequest: diag,
  };
  if (level === "error") {
    logger.error(payload, `AI draft 502 cause: ${diag.errorClass ?? "unknown"} / ${diag.errorCode ?? "n/a"} — ${diag.errorMessage ?? "no message"}`);
  } else {
    logger.info(payload, "AI draft completed");
  }
}
