/**
 * Thin cloud Composer adapters — translate ComposerProviderRequest into
 * @workspace/ai-providers shared OpenAI-compatible transport.
 * Do NOT own duplicate SDK clients / fetch / usage extraction.
 */
import {
  openAiCompatibleChat,
  readEnvApiKey,
  readEnvBaseUrl,
  COMPATIBLE_PROVIDER_DEFAULTS,
  assertVisionCapable,
  estimateUsageCostUsd,
  type CompatibleImagePart,
} from "@workspace/ai-providers";
import type {
  ComposerProviderAdapter,
  ComposerProviderCapabilities,
  ComposerProviderRequest,
  ComposerProviderResult,
  ComposerProviderName,
} from "./types";
import { modelCapabilities } from "./modelRegistry";

type CloudId = "qwen" | "deepseek" | "openai";

async function composeViaSharedTransport(
  provider: CloudId,
  request: ComposerProviderRequest,
): Promise<ComposerProviderResult> {
  const model = (request.model || "").trim() || COMPATIBLE_PROVIDER_DEFAULTS[provider]?.defaultModel || "";
  const imageCount = request.images?.length ?? 0;
  const execution = "CLOUD" as const;

  if (imageCount > 0) {
    const vis = assertVisionCapable(provider, model);
    if (!vis.ok) {
      return {
        ok: false,
        provider,
        model,
        safeError: vis.safeError,
        latencyMs: 0,
        execution,
      };
    }
  }

  const apiKey = readEnvApiKey(provider);
  const baseURL = readEnvBaseUrl(provider) || COMPATIBLE_PROVIDER_DEFAULTS[provider]?.baseURL;
  if (!apiKey) {
    return {
      ok: false,
      provider,
      model,
      safeError: `${provider}_api_key_not_configured`,
      latencyMs: 0,
      execution,
    };
  }
  if (!baseURL) {
    return {
      ok: false,
      provider,
      model,
      safeError: `${provider}_endpoint_not_configured`,
      latencyMs: 0,
      execution,
    };
  }

  const images: CompatibleImagePart[] | undefined = request.images?.map((i) => ({
    mimeType: i.mimeType,
    base64: i.base64,
  }));

  const r = await openAiCompatibleChat({
    provider,
    baseURL,
    apiKey,
    model,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    images,
    temperature: request.temperature,
    timeoutMs: request.timeoutMs,
    jsonMode: request.jsonMode !== false,
    extraBody: provider === "qwen" ? { enable_thinking: false } : undefined,
  });

  const usage = {
    promptTokens: r.usage.promptTokens,
    completionTokens: r.usage.completionTokens,
    totalTokens: r.usage.totalTokens,
    approximateCostUsd: estimateUsageCostUsd({
      provider,
      model: r.model,
      promptTokens: r.usage.promptTokens,
      completionTokens: r.usage.completionTokens,
    }),
  };

  if (!r.ok) {
    return {
      ok: false,
      provider,
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
    provider,
    model: r.model,
    latencyMs: r.latencyMs,
    execution,
    usage,
  };
}

function caps(provider: ComposerProviderName, model: string): ComposerProviderCapabilities {
  return modelCapabilities(provider, model);
}

export class QwenComposerAdapter implements ComposerProviderAdapter {
  readonly name = "qwen" as const;
  async getCapabilities(model: string) {
    return caps("qwen", model);
  }
  compose(request: ComposerProviderRequest) {
    return composeViaSharedTransport("qwen", request);
  }
}

export class DeepSeekComposerAdapter implements ComposerProviderAdapter {
  readonly name = "deepseek" as const;
  async getCapabilities(model: string) {
    return caps("deepseek", model);
  }
  compose(request: ComposerProviderRequest) {
    return composeViaSharedTransport("deepseek", request);
  }
}

export class OpenAiComposerAdapter implements ComposerProviderAdapter {
  readonly name = "openai" as const;
  async getCapabilities(model: string) {
    return caps("openai", model);
  }
  compose(request: ComposerProviderRequest) {
    return composeViaSharedTransport("openai", request);
  }
}
