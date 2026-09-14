/**
 * Provider-neutral Report Composer / CARE AI gateway types.
 * Clinical code should depend on capabilities + roles, not vendor names.
 */
export type ComposerProviderName = "ollama" | "qwen" | "deepseek" | "openai";

export type AiExecution = "LOCAL" | "CLOUD";

export type AiCapability =
  | "TEXT"
  | "VISION"
  | "STRUCTURED_OUTPUT"
  | "LOCAL"
  | "CLOUD";

export type AiInferenceRole =
  | "REPORT_COMPOSER"
  | "SELECTED_IMAGE_VISION"
  | "OVERNIGHT_VISION"
  | "TEST_LAB_TEXT"
  | "TEST_LAB_VISION";

export type ComposerProviderCapabilities = {
  text: boolean;
  vision: boolean;
  structuredOutput: boolean;
  local: boolean;
};

export type ComposerProviderImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  /** Raw base64 without data: prefix — process memory only. */
  base64: string;
};

export type ComposerProviderRequest = {
  systemPrompt: string;
  userPrompt: string;
  images?: ComposerProviderImage[];
  model: string;
  temperature: number;
  timeoutMs: number;
  numCtx?: number;
  endpoint?: string;
  localOnly?: boolean;
  /** Prefer JSON object response when the provider supports it. */
  jsonMode?: boolean;
};

export type ComposerProviderUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  approximateCostUsd: number | null;
};

export type ComposerProviderResult =
  | {
      ok: true;
      text: string;
      provider: ComposerProviderName;
      model: string;
      latencyMs: number;
      execution: AiExecution;
      usage?: ComposerProviderUsage;
    }
  | {
      ok: false;
      provider: ComposerProviderName;
      model: string;
      safeError: string;
      latencyMs: number;
      execution: AiExecution;
      usage?: ComposerProviderUsage;
    };

export interface ComposerProviderAdapter {
  readonly name: ComposerProviderName;
  getCapabilities(model: string): Promise<ComposerProviderCapabilities>;
  compose(request: ComposerProviderRequest): Promise<ComposerProviderResult>;
}

/** Common gateway request (maps onto ComposerProviderRequest for compose). */
export type AiInferenceRequest = {
  role: AiInferenceRole;
  systemPrompt: string;
  userPrompt: string;
  images?: ComposerProviderImage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  /** Explicit provider/model overrides (Test Lab). */
  providerOverride?: ComposerProviderName | null;
  modelOverride?: string | null;
  cloudVisionAllowed?: boolean;
};

export type AiInferenceResult = {
  ok: boolean;
  requestedProvider: ComposerProviderName;
  requestedModel: string;
  actualProvider: ComposerProviderName;
  actualModel: string;
  execution: AiExecution;
  text: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  fallbackUsed: boolean;
  safeError: string | null;
  provenanceIntact: boolean;
};
