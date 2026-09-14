/**
 * Qwen / Alibaba Model Studio — international OpenAI-compatible.
 * Endpoint verified: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
 * Model verified: qwen3.7-plus
 */
import {
  readEnvApiKey,
  readEnvBaseUrl,
  isCompatibleProviderConfigured,
  COMPATIBLE_PROVIDER_DEFAULTS,
} from "@workspace/ai-providers";

export const QWEN_OFFICIAL_BASE_URL =
  COMPATIBLE_PROVIDER_DEFAULTS.qwen?.baseURL ??
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export const QWEN_DEFAULT_MODEL = "qwen3.7-plus";

export function getQwenApiKey(): string | null {
  return readEnvApiKey("qwen");
}

export function isQwenConfigured(): boolean {
  return isCompatibleProviderConfigured("qwen");
}

export function getQwenBaseUrl(): string {
  return readEnvBaseUrl("qwen") || QWEN_OFFICIAL_BASE_URL;
}

export function qwenConfiguredPublicStatus(): {
  configured: boolean;
  baseUrl: string;
  model: string;
} {
  return {
    configured: isQwenConfigured(),
    baseUrl: getQwenBaseUrl(),
    model: QWEN_DEFAULT_MODEL,
  };
}
