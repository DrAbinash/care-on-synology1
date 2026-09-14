/**
 * OpenAI-compatible AiProvider (DeepSeek / Qwen / OpenAI).
 * Uses shared openAiCompatibleChat — no per-vendor SDK duplication.
 */
import type { AiProvider, AiProviderConfig, AiQueryOptions, AiQueryResult } from "./index";
import {
  openAiCompatibleChat,
  COMPATIBLE_PROVIDER_DEFAULTS,
  type CompatibleImagePart,
} from "./openAiCompatible";
import { estimateUsageCostUsd } from "./pricing";

export class OpenAiCompatibleProvider implements AiProvider {
  config: AiProviderConfig;

  constructor(
    private providerName: string,
    private apiKey: string,
    private baseURL: string,
    config: AiProviderConfig,
  ) {
    this.config = config;
  }

  async query(opts: AiQueryOptions): Promise<AiQueryResult> {
    const images: CompatibleImagePart[] = (opts.images ?? []).map((b64) => ({
      mimeType: "image/jpeg" as const,
      base64: b64,
    }));
    const defaults = COMPATIBLE_PROVIDER_DEFAULTS[this.providerName];
    const extraBody =
      this.providerName === "qwen" ? { enable_thinking: false } : undefined;

    const r = await openAiCompatibleChat({
      provider: this.providerName,
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      model: opts.model || defaults?.defaultModel || "unknown",
      userPrompt: opts.prompt,
      images: images.length > 0 ? images : undefined,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      jsonMode: false,
      extraBody,
    });

    const baseDiag = {
      provider: this.providerName,
      resolvedEndpoint: this.baseURL,
      model: r.model,
      numberOfImages: images.length,
      totalImageBytes: 0,
      promptLength: (opts.prompt ?? "").length,
      startedAt: new Date().toISOString(),
      elapsedMs: r.latencyMs,
      promptTokens: r.usage.promptTokens,
      completionTokens: r.usage.completionTokens,
      approximateCostUsd: estimateUsageCostUsd({
        provider: this.providerName,
        model: r.model,
        promptTokens: r.usage.promptTokens,
        completionTokens: r.usage.completionTokens,
      }),
      timeoutMsConfigured: opts.timeoutMs ?? null,
    };

    if (!r.ok) {
      return {
        text: "",
        success: false,
        error: r.safeError,
        diagnostics: {
          ...baseDiag,
          httpStatus: null,
          responseLength: 0,
          finishReason: null,
          errorClass: "CompatibleProviderError",
          errorCode: r.safeError.split(":")[0] ?? "COMPATIBLE_PROVIDER_ERROR",
          errorMessage: r.safeError,
          timeoutStage: null,
        },
      };
    }

    return {
      text: r.text,
      success: true,
      diagnostics: {
        ...baseDiag,
        httpStatus: 200,
        responseLength: r.text.length,
        finishReason: "stop",
        errorClass: null,
        errorCode: null,
        errorMessage: null,
        timeoutStage: null,
      },
    };
  }

  async testConnection(model?: string): Promise<{
    ok: boolean;
    message: string;
    availableModels?: string[];
  }> {
    const defaults = COMPATIBLE_PROVIDER_DEFAULTS[this.providerName];
    // OpenAI probe historically used gpt-4o-mini when model omitted.
    const probe =
      model ||
      (this.providerName === "openai" ? "gpt-4o-mini" : defaults?.defaultModel) ||
      "unknown";
    const r = await openAiCompatibleChat({
      provider: this.providerName,
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      model: probe,
      userPrompt: "Reply with exactly the word: CONNECTED",
      temperature: 0,
      maxTokens: 10,
      timeoutMs: 30_000,
      jsonMode: false,
    });
    if (!r.ok) return { ok: false, message: r.safeError };
    return { ok: true, message: r.text.slice(0, 200) };
  }
}
