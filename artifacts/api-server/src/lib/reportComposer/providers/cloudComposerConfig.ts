/**
 * Cloud composer credential / endpoint resolution.
 *
 * The composer used to read cloud keys from the environment only
 * (`compatibleComposerAdapters.ts` called `readEnvApiKey` / `readEnvBaseUrl`
 * directly), while every other CARE path — and the admin UI's own
 * "Test connection" button — resolves credentials through
 * `ai_provider_settings` (`getProviderApiKey` / `getProviderEndpointUrl`). A
 * clinic that saved its OpenAI key in AI Provider Settings therefore saw a
 * green, healthy provider and then got `<provider>_api_key_not_configured` on
 * every real draft. The settings page and the drafting path were reading two
 * different truths.
 *
 * This module gives the composer the SAME resolution the rest of CARE uses, in
 * the same order the local OpenAI-compatible arm already follows
 * (`localOpenAICompatibleConfig.ts:59-73`): database first, environment as
 * fallback, vendor default last. No new table, no new secret storage, and no
 * key ever reaches the browser.
 */
import {
  COMPATIBLE_PROVIDER_DEFAULTS,
  getProviderApiKey,
  getProviderEndpointUrl,
  readEnvApiKey,
  readEnvBaseUrl,
} from "@workspace/ai-providers";
import type { ComposerProviderName } from "./types";
import { logger } from "../../logger";

export type CloudComposerProvider = "openai" | "qwen" | "deepseek";

export type CloudComposerConfig = {
  provider: CloudComposerProvider;
  apiKey: string | null;
  baseURL: string | null;
  /** True when a key exists in DB or env — the policy gate's question. */
  keyConfigured: boolean;
  /**
   * The settings table could not be read. Informational only: resolution still
   * falls back to the environment, so a database outage does not disable a
   * provider that was configured there, and a provider with no env key still
   * sends nothing.
   */
  configLookupFailed: boolean;
};

/** Narrowing guard so callers never cast a provider name by hand. */
export function asCloudComposerProvider(
  provider: ComposerProviderName,
): CloudComposerProvider | null {
  return provider === "openai" || provider === "qwen" || provider === "deepseek" ? provider : null;
}

function normalizeUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\/$/, "");
  return v || null;
}

/**
 * Never throws. An unreadable settings table degrades to environment-only
 * resolution — which is exactly the answer the composer gave before this file
 * existed, so a database problem can neither invent a credential nor silently
 * disable a clinic that configured its key through env.
 */
export async function resolveCloudComposerConfig(
  provider: CloudComposerProvider,
): Promise<CloudComposerConfig> {
  let dbKey: string | null = null;
  let dbUrl: string | null = null;
  let configLookupFailed = false;
  try {
    dbKey = await getProviderApiKey(provider);
    dbUrl = await getProviderEndpointUrl(provider);
  } catch (err) {
    configLookupFailed = true;
    logger.error(
      { err, provider },
      "cloud composer could not read ai_provider_settings — falling back to environment resolution",
    );
  }

  const envKey = readEnvApiKey(provider);
  const envUrl = readEnvBaseUrl(provider);

  const apiKey = dbKey?.trim() || envKey?.trim() || null;
  const baseURL =
    normalizeUrl(dbUrl) ||
    normalizeUrl(envUrl) ||
    normalizeUrl(COMPATIBLE_PROVIDER_DEFAULTS[provider]?.baseURL);

  return {
    provider,
    apiKey,
    baseURL,
    keyConfigured: Boolean(apiKey),
    configLookupFailed,
  };
}
