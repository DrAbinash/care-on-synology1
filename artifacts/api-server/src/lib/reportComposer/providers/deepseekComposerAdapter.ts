/**
 * DeepSeek Report Composer adapter — thin facade over shared @workspace/ai-providers transport.
 */
export { DeepSeekComposerAdapter } from "./compatibleComposerAdapters";

export {
  DEEPSEEK_TEXT_MODEL,
  DEEPSEEK_VISION_MODEL,
  DEEPSEEK_OFFICIAL_BASE_URL,
  getDeepSeekApiKey,
  isDeepSeekConfigured,
  getDeepSeekBaseUrl,
  scrubDeepSeekSecrets,
  deepseekConfiguredPublicStatus,
} from "./deepseekConfig";

import { estimateUsageCostUsd } from "@workspace/ai-providers";
import { DEEPSEEK_TEXT_MODEL } from "./deepseekConfig";

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

/** Telemetry now lives on transport diagnostics; keep API for #709 call sites. */
export function getRecentDeepSeekTelemetry(_limit = 10): DeepSeekUsageTelemetry[] {
  return [];
}

export function recordDeepSeekTelemetry(_entry: DeepSeekUsageTelemetry): void {}

export function approximateDeepSeekCostUsd(entry: DeepSeekUsageTelemetry): number | null {
  return estimateUsageCostUsd({
    provider: "deepseek",
    model: entry.model || DEEPSEEK_TEXT_MODEL,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
  });
}
