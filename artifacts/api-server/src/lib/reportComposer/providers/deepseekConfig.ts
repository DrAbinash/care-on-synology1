/**
 * DeepSeek official OpenAI-compatible API — trial configuration.
 * Server-side only. Never return the API key to clients or logs.
 */
export const DEEPSEEK_OFFICIAL_BASE_URL = "https://api.deepseek.com";

/** Text Report Composer model (official API). */
export const DEEPSEEK_TEXT_MODEL = "deepseek-v4-pro";

/** Only DeepSeek model allowed to receive images in this trial. */
export const DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp";

export type NightVisionProviderMode = "local" | "deepseek" | "ab";

export function getDeepSeekApiKey(): string | null {
  const key = (process.env.DEEPSEEK_API_KEY ?? "").trim();
  return key.length > 0 ? key : null;
}

export function isDeepSeekConfigured(): boolean {
  return getDeepSeekApiKey() != null;
}

export function getDeepSeekBaseUrl(): string {
  const raw = (process.env.DEEPSEEK_BASE_URL ?? DEEPSEEK_OFFICIAL_BASE_URL).trim().replace(/\/$/, "");
  return raw || DEEPSEEK_OFFICIAL_BASE_URL;
}

/** Redact secrets from any string before logging or returning to clients. */
export function scrubDeepSeekSecrets(text: string): string {
  const key = getDeepSeekApiKey();
  if (!key) return text;
  return text.split(key).join("[REDACTED_DEEPSEEK_KEY]");
}

export function deepseekConfiguredPublicStatus(): { configured: boolean; baseUrl: string } {
  return {
    configured: isDeepSeekConfigured(),
    baseUrl: getDeepSeekBaseUrl(),
  };
}
