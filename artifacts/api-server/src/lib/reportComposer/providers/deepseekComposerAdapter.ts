/**
 * DeepSeek Report Composer adapter — official OpenAI-compatible API
 * (https://api.deepseek.com). Not Ollama Cloud.
 */
import OpenAI from "openai";
import {
  DEEPSEEK_TEXT_MODEL,
  DEEPSEEK_VISION_MODEL,
  getDeepSeekApiKey,
  getDeepSeekBaseUrl,
  isDeepSeekConfigured,
  scrubDeepSeekSecrets,
} from "./deepseekConfig";
import type {
  ComposerProviderAdapter,
  ComposerProviderCapabilities,
  ComposerProviderRequest,
  ComposerProviderResult,
} from "./types";

export type DeepSeekUsageTelemetry = {
  model: string;
  imageCount: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  success: boolean;
  safeError: string | null;
};

const recentTelemetry: DeepSeekUsageTelemetry[] = [];
const TELEMETRY_CAP = 50;

export function recordDeepSeekTelemetry(entry: DeepSeekUsageTelemetry): void {
  recentTelemetry.unshift(entry);
  if (recentTelemetry.length > TELEMETRY_CAP) recentTelemetry.length = TELEMETRY_CAP;
}

export function getRecentDeepSeekTelemetry(limit = 10): DeepSeekUsageTelemetry[] {
  return recentTelemetry.slice(0, Math.max(1, Math.min(50, limit)));
}

function estimateUsdCost(opts: {
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}): number | null {
  // Approximate public list pricing placeholders for trial display only — not billing.
  // If tokens missing, return null.
  const pin = opts.promptTokens;
  const cout = opts.completionTokens;
  if (pin == null || cout == null) return null;
  // Conservative placeholder rates ($/1M tokens) — UI labels as approximate.
  const isVision = opts.model.includes("vision");
  const inRate = isVision ? 0.14 : 0.14; // deepseek-ish ballpark
  const outRate = isVision ? 0.28 : 0.28;
  return (pin * inRate + cout * outRate) / 1_000_000;
}

export function approximateDeepSeekCostUsd(entry: DeepSeekUsageTelemetry): number | null {
  return estimateUsdCost(entry);
}

export class DeepSeekComposerAdapter implements ComposerProviderAdapter {
  readonly name = "deepseek" as const;

  async getCapabilities(model: string): Promise<ComposerProviderCapabilities> {
    const m = (model || "").toLowerCase();
    const vision = m.includes("vision") || m === DEEPSEEK_VISION_MODEL.toLowerCase();
    return { text: true, vision, local: false };
  }

  async compose(request: ComposerProviderRequest): Promise<ComposerProviderResult> {
    const started = Date.now();
    const model = (request.model || "").trim() || DEEPSEEK_TEXT_MODEL;
    const imageCount = request.images?.length ?? 0;

    if (!isDeepSeekConfigured()) {
      const latencyMs = Date.now() - started;
      recordDeepSeekTelemetry({
        model,
        imageCount,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        latencyMs,
        success: false,
        safeError: "deepseek_api_key_not_configured",
      });
      return {
        ok: false,
        provider: "deepseek",
        model,
        safeError: "deepseek_api_key_not_configured",
        latencyMs,
      };
    }

    if (imageCount > 0 && model !== DEEPSEEK_VISION_MODEL) {
      return {
        ok: false,
        provider: "deepseek",
        model,
        safeError: "deepseek_vision_model_required",
        latencyMs: Date.now() - started,
      };
    }

    const apiKey = getDeepSeekApiKey()!;
    const client = new OpenAI({
      apiKey,
      baseURL: getDeepSeekBaseUrl(),
      timeout: request.timeoutMs,
    });

    try {
      type ContentPart =
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } };

      const userContent: ContentPart[] = [{ type: "text", text: request.userPrompt }];
      for (const img of request.images ?? []) {
        userContent.push({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
        });
      }

      const resp = await client.chat.completions.create({
        model,
        temperature: request.temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemPrompt },
          {
            role: "user",
            content: imageCount > 0 ? userContent : request.userPrompt,
          },
        ],
      });

      const text = resp.choices[0]?.message?.content ?? "";
      const usage = resp.usage;
      const latencyMs = Date.now() - started;
      const promptTokens = usage?.prompt_tokens ?? null;
      const completionTokens = usage?.completion_tokens ?? null;
      const totalTokens = usage?.total_tokens ?? null;

      if (!text.trim()) {
        recordDeepSeekTelemetry({
          model,
          imageCount,
          promptTokens,
          completionTokens,
          totalTokens,
          latencyMs,
          success: false,
          safeError: "empty_model_response",
        });
        return {
          ok: false,
          provider: "deepseek",
          model,
          safeError: "empty_model_response",
          latencyMs,
        };
      }

      recordDeepSeekTelemetry({
        model,
        imageCount,
        promptTokens,
        completionTokens,
        totalTokens,
        latencyMs,
        success: true,
        safeError: null,
      });

      return {
        ok: true,
        text,
        provider: "deepseek",
        model,
        latencyMs,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - started;
      const raw = err instanceof Error ? err.message : String(err);
      const safeError = scrubDeepSeekSecrets(raw).slice(0, 180) || "deepseek_request_failed";
      recordDeepSeekTelemetry({
        model,
        imageCount,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        latencyMs,
        success: false,
        safeError: "deepseek_request_failed",
      });
      return {
        ok: false,
        provider: "deepseek",
        model,
        safeError: `deepseek_request_failed:${safeError.replace(/[^a-zA-Z0-9_.: -]/g, "").slice(0, 80)}`,
        latencyMs,
      };
    }
  }
}

export { DEEPSEEK_TEXT_MODEL, DEEPSEEK_VISION_MODEL };
