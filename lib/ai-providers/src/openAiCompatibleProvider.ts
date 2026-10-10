/**
 * OpenAI-compatible AiProvider (DeepSeek / Qwen / OpenAI / Local OpenAI-Compatible).
 * Uses shared openAiCompatibleChat — no per-vendor SDK duplication.
 */
import type { AiProvider, AiProviderConfig, AiQueryOptions, AiQueryResult } from "./index";
import {
  openAiCompatibleChat,
  probeOpenAiCompatibleModels,
  COMPATIBLE_PROVIDER_DEFAULTS,
  isLocalOpenAiCompatibleProvider,
  type CompatibleImagePart,
} from "./openAiCompatible";
import { estimateUsageCostUsd } from "./pricing";
import { assertVisionCapable } from "./builtinModelCapabilities";

export type OpenAiCompatibleProviderOptions = {
  allowEmptyApiKey?: boolean;
  /** Default false for local servers that may lack response_format support. */
  defaultJsonMode?: boolean;
};

export class OpenAiCompatibleProvider implements AiProvider {
  config: AiProviderConfig;

  constructor(
    private providerName: string,
    private apiKey: string,
    private baseURL: string,
    config: AiProviderConfig,
    private opts: OpenAiCompatibleProviderOptions = {},
  ) {
    this.config = config;
  }

  async query(opts: AiQueryOptions): Promise<AiQueryResult> {
    const images: CompatibleImagePart[] = (opts.images ?? []).map((b64) => ({
      mimeType: "image/jpeg" as const,
      base64: b64,
    }));
    const defaults = COMPATIBLE_PROVIDER_DEFAULTS[this.providerName];
    const model = opts.model || defaults?.defaultModel || "unknown";
    const extraBody =
      this.providerName === "qwen" ? { enable_thinking: false } : undefined;

    if (images.length > 0) {
      const vis = assertVisionCapable(this.providerName, model);
      if (!vis.ok) {
        return {
          text: "",
          success: false,
          error: vis.safeError,
          diagnostics: {
            provider: this.providerName,
            resolvedEndpoint: this.baseURL,
            model,
            numberOfImages: images.length,
            totalImageBytes: 0,
            promptLength: (opts.prompt ?? "").length,
            startedAt: new Date().toISOString(),
            elapsedMs: 0,
            httpStatus: null,
            responseLength: 0,
            finishReason: null,
            errorClass: "ModelNotVisionCapable",
            errorCode: "MODEL_NOT_VISION_CAPABLE",
            errorMessage: vis.safeError,
            timeoutStage: null,
            timeoutMsConfigured: opts.timeoutMs ?? null,
          },
        };
      }
    }

    const allowEmpty =
      this.opts.allowEmptyApiKey === true ||
      defaults?.allowEmptyApiKey === true ||
      isLocalOpenAiCompatibleProvider(this.providerName);

    const r = await openAiCompatibleChat({
      provider: this.providerName,
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      model,
      userPrompt: opts.prompt,
      images: images.length > 0 ? images : undefined,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      jsonMode: this.opts.defaultJsonMode ?? false,
      allowEmptyApiKey: allowEmpty,
      extraBody,
      // SECURITY: Enforce DNS binding and disable redirects for local providers.
      enforceLocalBinding: isLocalOpenAiCompatibleProvider(this.providerName),
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
    const allowEmpty =
      this.opts.allowEmptyApiKey === true ||
      defaults?.allowEmptyApiKey === true ||
      isLocalOpenAiCompatibleProvider(this.providerName);

    // A local OpenAI-compatible server has a cheap GET /models; ask it first so
    // "down", "needs a key" and "model not loaded" stop looking identical.
    // Cloud vendors are deliberately not probed — this adds no external call.
    let availableModels: string[] | undefined;
    let note = "";
    if (isLocalOpenAiCompatibleProvider(this.providerName)) {
      const listing = await probeOpenAiCompatibleModels(this.baseURL, {
        apiKey: this.apiKey,
        enforceLocalBinding: true,
      });
      if (listing.reachable) {
        availableModels = listing.models;
        if (listing.models.length > 0 && probe !== "unknown" && !listing.models.includes(probe)) {
          note = ` — server lists ${listing.models.length} model(s), "${probe}" is not one of them`;
        }
      } else if (listing.httpStatus == null || listing.httpStatus >= 500) {
        // No socket answer or a server-side failure: the chat call cannot succeed,
        // and waiting its 30s deadline only delays the operator's answer.
        return {
          ok: false,
          message: `local server unreachable at ${this.baseURL}/models (${listing.error})`,
        };
      } else {
        // 401/403/404 — the server is alive but /models is gated or unimplemented;
        // the chat completion below remains the real verdict.
        note = ` (GET /models: ${listing.error})`;
      }
    }

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
      allowEmptyApiKey: allowEmpty,
      enforceLocalBinding: isLocalOpenAiCompatibleProvider(this.providerName),
    });
    if (!r.ok) return { ok: false, message: `${r.safeError}${note}` };
    return { ok: true, message: `${r.text.slice(0, 200)}${note}`, availableModels };
  }

  /**
   * Optional vision probe — sends a 1×1 JPEG data URI. Fail closed on error.
   * Does not expose secrets.
   */
  async testVision(model?: string): Promise<{ ok: boolean; message: string }> {
    const defaults = COMPATIBLE_PROVIDER_DEFAULTS[this.providerName];
    const probe = model || defaults?.defaultModel || "unknown";
    const vis = assertVisionCapable(this.providerName, probe);
    if (!vis.ok) {
      return { ok: false, message: vis.safeError };
    }
    // 1×1 white JPEG
    const tinyJpegBase64 =
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z";
    const allowEmpty =
      this.opts.allowEmptyApiKey === true ||
      defaults?.allowEmptyApiKey === true ||
      isLocalOpenAiCompatibleProvider(this.providerName);
    const r = await openAiCompatibleChat({
      provider: this.providerName,
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      model: probe,
      userPrompt: "Reply with exactly the word: VISION_OK",
      images: [{ mimeType: "image/jpeg", base64: tinyJpegBase64 }],
      temperature: 0,
      maxTokens: 16,
      timeoutMs: 60_000,
      jsonMode: false,
      allowEmptyApiKey: allowEmpty,
      enforceLocalBinding: isLocalOpenAiCompatibleProvider(this.providerName),
    });
    if (!r.ok) return { ok: false, message: r.safeError };
    return { ok: true, message: r.text.slice(0, 200) };
  }
}
