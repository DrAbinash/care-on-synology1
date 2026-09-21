/**
 * Local OpenAI-Compatible Composer adapter.
 * Reuses shared openAiCompatibleChat — LOCAL execution, optional API key,
 * OpenAI image_url data URIs (never Ollama images[]).
 * JSON mode OFF by default (many local servers lack response_format);
 * Composer parseComposerDraftJson validation remains unchanged.
 */
import {
  openAiCompatibleChat,
  COMPATIBLE_PROVIDER_DEFAULTS,
  estimateUsageCostUsd,
  type CompatibleImagePart,
} from "@workspace/ai-providers";
import type {
  ComposerProviderAdapter,
  ComposerProviderCapabilities,
  ComposerProviderRequest,
  ComposerProviderResult,
} from "./types";
import {
  getLocalOpenAiApiKey,
  getLocalOpenAiBaseUrl,
  loadLocalOpenAiSettings,
  localOpenAiModelSupportsVision,
  LOCAL_OPENAI_COMPATIBLE_ID,
} from "./localOpenAiCompatibleConfig";

export class LocalOpenAiCompatibleComposerAdapter implements ComposerProviderAdapter {
  readonly name = "local_openai_compatible" as const;

  async getCapabilities(model: string): Promise<ComposerProviderCapabilities> {
    const settings = await loadLocalOpenAiSettings();
    const vision = await localOpenAiModelSupportsVision(model);
    return {
      text: settings.supportsText !== false,
      vision,
      structuredOutput: true,
      local: true,
    };
  }

  async compose(request: ComposerProviderRequest): Promise<ComposerProviderResult> {
    const started = Date.now();
    const execution = "LOCAL" as const;
    const defaults = COMPATIBLE_PROVIDER_DEFAULTS.local_openai_compatible;
    const model =
      (request.model || "").trim() || defaults?.defaultModel || "";
    const imageCount = request.images?.length ?? 0;

    if (!model) {
      return {
        ok: false,
        provider: this.name,
        model,
        safeError: "composer_model_not_configured",
        latencyMs: Date.now() - started,
        execution,
      };
    }

    if (imageCount > 0) {
      const visionOk = await localOpenAiModelSupportsVision(model);
      if (!visionOk) {
        return {
          ok: false,
          provider: this.name,
          model,
          safeError: "model_not_vision_capable",
          latencyMs: Date.now() - started,
          execution,
        };
      }
    }

    const baseURL = await getLocalOpenAiBaseUrl(request.endpoint);
    if (!baseURL) {
      return {
        ok: false,
        provider: this.name,
        model,
        safeError: "local_openai_compatible_endpoint_not_configured",
        latencyMs: Date.now() - started,
        execution,
      };
    }

    const apiKey = await getLocalOpenAiApiKey();
    const settings = await loadLocalOpenAiSettings();
    // Prefer request.jsonMode when set; otherwise Settings (default false).
    const jsonMode =
      request.jsonMode === true
        ? true
        : request.jsonMode === false
          ? false
          : settings.jsonMode === true;

    const images: CompatibleImagePart[] | undefined = request.images?.map((i) => ({
      mimeType: i.mimeType,
      base64: i.base64,
    }));

    const r = await openAiCompatibleChat({
      provider: LOCAL_OPENAI_COMPATIBLE_ID,
      baseURL,
      apiKey,
      model,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      images,
      temperature: request.temperature,
      timeoutMs: request.timeoutMs,
      jsonMode,
      allowEmptyApiKey: true,
    });

    const usage = {
      promptTokens: r.usage.promptTokens,
      completionTokens: r.usage.completionTokens,
      totalTokens: r.usage.totalTokens,
      approximateCostUsd: estimateUsageCostUsd({
        provider: LOCAL_OPENAI_COMPATIBLE_ID,
        model: r.model,
        promptTokens: r.usage.promptTokens,
        completionTokens: r.usage.completionTokens,
      }),
    };

    if (!r.ok) {
      return {
        ok: false,
        provider: this.name,
        model: r.model,
        safeError: r.safeError,
        latencyMs: r.latencyMs,
        execution,
        usage,
      };
    }
    return {
      ok: true,
      text: r.text,
      provider: this.name,
      model: r.model,
      latencyMs: r.latencyMs,
      execution,
      usage,
    };
  }
}
