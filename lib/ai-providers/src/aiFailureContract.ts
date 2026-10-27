/**
 * aiFailureContract.ts — one stable answer to "why did the model not answer?"
 *
 * WHY THIS EXISTS
 * The interactive radiology paths each reported provider failure in their own
 * shape: `/draft` returned HTTP 502 with a `diagnostics` object, `/query`
 * returned HTTP 502 with only `{ error }`, and the Report Composer adapters
 * returned `{ ok: false, safeError: "ollama_http_400" }` with no HTTP status at
 * all. A radiologist-facing screen therefore cannot say, consistently, whether
 * the model is switched off, unconfigured, slow, blocked by the clinic's privacy
 * policy, or simply answered with nothing.
 *
 * WHAT THIS IS NOT
 * It is not a new error system and not a new provider framework. Every input it
 * reads already exists on `AiQueryResult.diagnostics` — the error classes and
 * UPPER_SNAKE codes the providers have been producing since #805. This module
 * only gives those a single, small, public vocabulary and keeps secrets out of
 * the message, so the existing surfaces can adopt it additively: the historical
 * `error` sentence is left untouched, because callers match on its wording.
 */
import type { AiExecutionIdentity, AiQueryResult } from "./index";

/**
 * The complete vocabulary a UI may branch on. Nine members, deliberately:
 * `DISABLED` and `NOT_CONFIGURED` are the two an operator can fix in Settings,
 * `PHI_POLICY_BLOCK` and `IMAGE_EGRESS_BLOCK` are the two the clinic chose, and
 * the rest are what the model or the machine did.
 */
export type AiFailureCode =
  | "DISABLED"
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "PROVIDER_HTTP_ERROR"
  | "MALFORMED_RESPONSE"
  | "PHI_POLICY_BLOCK"
  | "IMAGE_EGRESS_BLOCK"
  | "EMPTY_RESPONSE"
  | "UNKNOWN";

export interface AiFailure {
  code: AiFailureCode;
  /** Operator-readable, secret-free, bounded. */
  message: string;
  /** The provider that was asked to run (or refused before running). */
  provider: string;
  model: string | null;
  locality: AiExecutionIdentity["locality"];
  /** False when policy or configuration stopped the call before any socket. */
  attempted: boolean;
  /** The canonical deadline that governed this call, in ms. */
  timeoutMs: number;
  /**
   * The provider layer's own code/class, kept so nothing is lost in translation.
   * Never re-derived from `code`.
   */
  detailCode: string | null;
}

const MAX_MESSAGE_CHARS = 240;

const DEFAULT_MESSAGES: Record<AiFailureCode, string> = {
  DISABLED: "AI is switched off for this clinic.",
  NOT_CONFIGURED: "No AI provider is configured for this task.",
  TIMEOUT: "The model did not answer within the configured time.",
  PROVIDER_HTTP_ERROR: "The AI provider refused the request.",
  MALFORMED_RESPONSE: "The model answered, but not in the requested form.",
  PHI_POLICY_BLOCK: "Patient identifiers are not allowed to leave the clinic for this request.",
  IMAGE_EGRESS_BLOCK: "Images are not allowed to leave the clinic for this request.",
  EMPTY_RESPONSE: "The model returned no text.",
  UNKNOWN: "The AI request failed for an unclassified reason.",
};

/**
 * Credential-shaped strings that must never reach a client log or response body.
 * Provider errors echo the URL or header they were given often enough that this
 * is worth doing once, here, instead of at each call site.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(api[_-]?key|secret|token|access_token)\s*[=:]\s*["']?[^\s"'&,}]{6,}/gi,
  /\bdecrypted:[^\s"',;]+/g,
];

export function redactAiSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "$1[REDACTED]");
  return out;
}

function bounded(text: string): string {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return trimmed.length > MAX_MESSAGE_CHARS ? `${trimmed.slice(0, MAX_MESSAGE_CHARS - 1)}…` : trimmed;
}

/** Map the provider layer's own classification onto the nine-member vocabulary. */
function classify(result: AiQueryResult): { code: AiFailureCode; detail: string | null } {
  const d = result.diagnostics;
  const code = d?.errorCode ?? null;
  const errorClass = d?.errorClass ?? null;
  const httpStatus = d?.httpStatus ?? null;

  // Policy blocks are the clinic's decision, so they are checked first: they must
  // never be reported as a provider outage.
  if (code === "PHI_TEXT_CLOUD_BLOCKED" || errorClass === "PhiTextCloudBlocked") {
    return { code: "PHI_POLICY_BLOCK", detail: code };
  }
  if (
    code === "PHI_IMAGE_CLOUD_BLOCKED"
    || code === "MODEL_NOT_VISION_CAPABLE"
    || errorClass === "PhiImageCloudBlocked"
  ) {
    return { code: "IMAGE_EGRESS_BLOCK", detail: code };
  }
  if (code === "PROVIDER_NOT_CONFIGURED" || errorClass === "ProviderNotConfigured") {
    return { code: "NOT_CONFIGURED", detail: code };
  }
  if (code === "PROVIDER_TIMEOUT" || errorClass === "AiRequestTimeout" || d?.timeoutStage) {
    return { code: "TIMEOUT", detail: code };
  }
  if (code === "DISABLED" || errorClass === "Disabled") {
    return { code: "DISABLED", detail: code };
  }
  if (typeof httpStatus === "number" && httpStatus >= 400) {
    return { code: "PROVIDER_HTTP_ERROR", detail: code ?? errorClass };
  }
  if (
    code === "CONTEXT_BUDGET_EXCEEDED"
    || code === "GPU_OUT_OF_MEMORY"
    || code === "PROVIDER_ERROR"
    || errorClass === "OllamaHttpError"
    || errorClass === "ContextBudgetExceeded"
    || errorClass === "GpuOutOfMemory"
  ) {
    return { code: "PROVIDER_HTTP_ERROR", detail: code ?? errorClass };
  }
  // The provider answered and nothing arrived. Distinct from a failure: the
  // radiologist needs to know the model was awake but silent.
  if (result.success && !result.text?.trim()) return { code: "EMPTY_RESPONSE", detail: code };
  return { code: "UNKNOWN", detail: code ?? errorClass };
}

/**
 * Normalize one executed call. Returns null when the call succeeded and produced
 * text, so a caller can branch on `failure === null` instead of comparing codes.
 *
 * `override` exists for what only the caller can know: the provider answered
 * correctly but its output could not be read as the section that was asked for,
 * or the answer cannot be attributed to the provider the request was validated
 * against. Neither is visible from inside the execution layer. The identity still
 * comes from `result.execution`, so an override reports who really answered rather
 * than whatever the caller hoped for.
 */
export function normalizeAiFailure(
  result: AiQueryResult,
  override?: { code: AiFailureCode; message?: string; detailCode?: string | null },
): AiFailure | null {
  const execution = result.execution;
  const classified = override ? { code: override.code, detail: null as string | null } : classify(result);

  if (!override && result.success && classified.code !== "EMPTY_RESPONSE") return null;

  const rawMessage =
    override?.message
    ?? result.diagnostics?.errorMessage
    ?? result.error
    ?? DEFAULT_MESSAGES[classified.code];

  return {
    code: classified.code,
    message: bounded(redactAiSecrets(String(rawMessage ?? ""))) || DEFAULT_MESSAGES[classified.code],
    // Identity comes from the execution layer whenever it reported; a caller
    // cannot make the failure claim a provider that never ran.
    provider: execution?.provider ?? result.diagnostics?.provider ?? "unknown",
    model: execution?.model ?? result.diagnostics?.model ?? null,
    locality: execution?.locality ?? "cloud",
    attempted: execution?.attempted ?? true,
    timeoutMs: execution?.timeoutMs ?? 0,
    detailCode: override?.detailCode ?? classified.detail,
  };
}
