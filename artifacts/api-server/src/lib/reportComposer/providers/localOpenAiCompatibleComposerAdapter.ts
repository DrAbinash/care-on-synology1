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
import { validateOllamaUrl } from "../../ssrf/ollamaUrlGuard";
import { assertGatewayPrivacy } from "./gatewayPrivacy";

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

    // SSRF guard — validate the resolved URL before making any request.
    // A "local_openai_compatible" provider whose base URL points to a public
    // internet endpoint, cloud metadata service, or other dangerous destination
    // must be blocked here. allowLocal=true because this provider is intended
    // to contact LAN/private addresses (the clinic's own AI server).
    const urlValidation = validateOllamaUrl(baseURL, /* allowLocal */ true);
    if (!urlValidation.ok) {
      return {
        ok: false,
        provider: this.name,
        model,
        safeError: "local_openai_compatible_endpoint_blocked",
        latencyMs: Date.now() - started,
        execution,
      };
    }

    // Endpoint-derived privacy gate. For genuinely local URLs (private/LAN),
    // the gate returns a local bypass (no PHI check, text passes through
    // unchanged). For public URLs, the provider is reclassified as cloud and
    // the full PHI detection/redaction gate applies — same policy as the
    // cloud adapters. This closes the gap where a "local" provider pointed at
    // a public URL could send clinical text off-prem without any PHI check.
    const privacy = await assertGatewayPrivacy({
      provider: this.name,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      images: request.images,
      cloudAllowed: true,
      cloudVisionAllowed: request.cloudVisionAllowed,
      resolvedUrl: baseURL,
    });
    if (!privacy.ok) {
      return {
        ok: false,
        provider: this.name,
        model,
        safeError: privacy.safeError,
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
      systemPrompt: privacy.systemPrompt,
      userPrompt: privacy.userPrompt,
      images,
      temperature: request.temperature,
      timeoutMs: request.timeoutMs,
      jsonMode,
      allowEmptyApiKey: true,
      // SECURITY: Enforce DNS binding and disable redirects for local provider.
      // This eliminates DNS rebinding and redirect-based SSRF.
      enforceLocalBinding: true,
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
