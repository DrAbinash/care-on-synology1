/**
 * Thin cloud Composer adapters — translate ComposerProviderRequest into
 * @workspace/ai-providers shared OpenAI-compatible transport.
 * Do NOT own duplicate SDK clients / fetch / usage extraction.
 *
 * These three adapters are the only way composer text reaches a cloud vendor,
 * so they are where the two things CARE was missing are now enforced:
 *  - `assertGatewayPrivacy` runs before any network call (cloud-bound composer
 *    text previously bypassed every PHI control CARE has).
 *  - credentials resolve through `ai_provider_settings` first, like the rest of
 *    CARE, instead of environment-only (see cloudComposerConfig.ts).
 */
import {
  openAiCompatibleChat,
  assertVisionCapable,
  estimateUsageCostUsd,
  COMPATIBLE_PROVIDER_DEFAULTS,
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
import { assertGatewayPrivacy } from "./gatewayPrivacy";
import { resolveCloudComposerConfig, type CloudComposerProvider } from "./cloudComposerConfig";

type CloudId = CloudComposerProvider;

function failed(
  provider: CloudId,
  model: string,
  safeError: string,
  detail?: string,
): ComposerProviderResult {
  return {
    ok: false,
    provider,
    model,
    safeError,
    latencyMs: 0,
    execution: "CLOUD",
    ...(detail ? { detail } : {}),
  };
}

async function composeViaSharedTransport(
  provider: CloudId,
  request: ComposerProviderRequest,
): Promise<ComposerProviderResult> {
  const model =
    (request.model || "").trim() || COMPATIBLE_PROVIDER_DEFAULTS[provider]?.defaultModel || "";
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

  // ─── Privacy gate: runs before the request exists on the wire ───────────────
  // The gate may redact identifier VALUES (never clinical content) and returns
  // the exact text that is allowed to leave. Anything it refuses is refused
  // here, not silently sent.
  const privacy = await assertGatewayPrivacy({
    provider,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    images: request.images,
    cloudVisionAllowed: request.cloudVisionAllowed === true,
  });
  if (!privacy.ok) {
    return failed(provider, model, privacy.safeError, privacy.detail);
  }

  const cfg = await resolveCloudComposerConfig(provider);
  if (!cfg.apiKey) {
    return failed(
      provider,
      model,
      `${provider}_api_key_not_configured`,
      "No API key found for this provider in AI Provider Settings or the environment.",
    );
  }
  if (!cfg.baseURL) {
    return failed(
      provider,
      model,
      `${provider}_endpoint_not_configured`,
      `No endpoint configured for ${provider}.`,
    );
  }

  // The gate returns the exact bytes that cleared verification — a re-encoded,
  // metadata-stripped set, not the ones it was shown. Taking them from
  // `request.images` instead would inspect one image and send another, the same
  // way sending `request.userPrompt` rather than `privacy.userPrompt` would
  // un-redact text the gate had just scrubbed.
  const images: CompatibleImagePart[] | undefined = privacy.images.map((i) => ({
    mimeType: i.mimeType,
    base64: i.base64,
  }));

  const r = await openAiCompatibleChat({
    provider,
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    model,
    systemPrompt: privacy.systemPrompt,
    userPrompt: privacy.userPrompt,
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
