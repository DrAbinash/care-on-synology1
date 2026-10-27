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
  loadProviderConfig,
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
   * Did the admin switch this provider ON?
   *
   * `null` means CARE has no `ai_provider_settings` row for it — the provider was
   * configured through the environment, which is how the CLI and every pre-UI
   * clinic did it, and which makes no statement about enablement. `false` means a
   * row exists and says OFF.
   *
   * This exists because the composer used to read only `encryptedApiKey` and
   * ignore `isEnabled` entirely: a provider the admin had deliberately switched
   * off could still be handed patient text as long as its key row was present.
   * The rest of CARE (the interactive gateway, `resolveInteractiveTarget`) has
   * always honoured the switch, so the two paths answered "is OpenAI on?"
   * differently for the same settings screen.
   */
  enabled: boolean | null;
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
  let enabled: boolean | null = null;
  let configLookupFailed = false;
  try {
    dbKey = await getProviderApiKey(provider);
    dbUrl = await getProviderEndpointUrl(provider);
    // One row read, same table, same transaction-level failure mode: a settings
    // row that exists is an admin statement, so its `isEnabled` is honoured. A
    // missing row is not a statement at all and leaves `enabled` null.
    const row = await loadProviderConfig(provider);
    enabled = row ? row.isEnabled : null;
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
    enabled,
    configLookupFailed,
  };
}
