/**
 * Local OpenAI-Compatible provider config — vendor-neutral.
 * Initial clinic defaults target PrismML Bonsai 2 27B via Settings, not Composer hard-codes.
 */
import {
  readEnvApiKey,
  readEnvBaseUrl,
  COMPATIBLE_PROVIDER_DEFAULTS,
  LOCAL_OPENAI_COMPATIBLE_PROVIDER,
  getProviderApiKey,
  getProviderEndpointUrl,
  loadProviderConfig,
} from "@workspace/ai-providers";
import { db } from "@workspace/db";
import { aiProviderSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const LOCAL_OPENAI_COMPATIBLE_ID = LOCAL_OPENAI_COMPATIBLE_PROVIDER;

export const LOCAL_OPENAI_DEFAULT_DISPLAY_NAME = "Bonsai 2 27B";
export const LOCAL_OPENAI_DEFAULT_MODEL =
  COMPATIBLE_PROVIDER_DEFAULTS.local_openai_compatible?.defaultModel ?? "bonsai";

export type LocalOpenAiProviderSettings = {
  displayName: string;
  supportsText: boolean;
  supportsVision: boolean;
  /** Prefer response_format json_object when true. Default false (safer). */
  jsonMode: boolean;
};

const DEFAULT_SETTINGS: LocalOpenAiProviderSettings = {
  displayName: LOCAL_OPENAI_DEFAULT_DISPLAY_NAME,
  supportsText: true,
  supportsVision: true,
  jsonMode: false,
};

export function parseLocalOpenAiSettingsJson(
  raw: string | null | undefined,
): LocalOpenAiProviderSettings {
  if (!raw?.trim()) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<LocalOpenAiProviderSettings>;
    return {
      displayName:
        typeof parsed.displayName === "string" && parsed.displayName.trim()
          ? parsed.displayName.trim()
          : DEFAULT_SETTINGS.displayName,
      supportsText: parsed.supportsText !== false,
      supportsVision: parsed.supportsVision !== false,
      jsonMode: parsed.jsonMode === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function getLocalOpenAiApiKey(): Promise<string> {
  const dbKey = await getProviderApiKey(LOCAL_OPENAI_COMPATIBLE_ID);
  if (dbKey?.trim()) return dbKey.trim();
  return readEnvApiKey(LOCAL_OPENAI_COMPATIBLE_ID) ?? "";
}

export async function getLocalOpenAiBaseUrl(
  requestEndpoint?: string | null,
): Promise<string | null> {
  const fromRequest = (requestEndpoint ?? "").trim().replace(/\/$/, "");
  if (fromRequest) return fromRequest;
  const dbUrl = (await getProviderEndpointUrl(LOCAL_OPENAI_COMPATIBLE_ID))?.replace(/\/$/, "");
  if (dbUrl) return dbUrl;
  return readEnvBaseUrl(LOCAL_OPENAI_COMPATIBLE_ID);
}

export async function getLocalOpenAiDefaultModel(): Promise<string> {
  const cfg = await loadProviderConfig(LOCAL_OPENAI_COMPATIBLE_ID);
  const fromDb = (cfg?.defaultModel ?? "").trim();
  if (fromDb) return fromDb;
  return LOCAL_OPENAI_DEFAULT_MODEL;
}

export async function loadLocalOpenAiSettings(): Promise<LocalOpenAiProviderSettings> {
  const [row] = await db
    .select({ settingsJson: aiProviderSettingsTable.settingsJson })
    .from(aiProviderSettingsTable)
    .where(eq(aiProviderSettingsTable.provider, LOCAL_OPENAI_COMPATIBLE_ID))
    .limit(1);
  return parseLocalOpenAiSettingsJson(row?.settingsJson);
}

/**
 * Vision capability: Settings flag is authoritative for this provider.
 * Never infer from model-name heuristics. Builtin rows are informational only.
 */
export async function localOpenAiModelSupportsVision(_model: string): Promise<boolean> {
  const settings = await loadLocalOpenAiSettings();
  return settings.supportsVision === true;
}

export function localOpenAiConfiguredPublicStatus(): {
  configured: boolean;
  baseUrl: string | null;
  displayName: string;
} {
  // Sync env-only status for diagnostics panels (DB checked async elsewhere).
  const baseUrl = readEnvBaseUrl(LOCAL_OPENAI_COMPATIBLE_ID);
  return {
    configured: Boolean(baseUrl?.trim()),
    baseUrl,
    displayName: LOCAL_OPENAI_DEFAULT_DISPLAY_NAME,
  };
}

/**
 * Soft-seed the Local OpenAI-Compatible *provider* row only (Bonsai-friendly
 * pre-filled Settings values). Does NOT create or modify ai_model_routes.
 * Opening AI Settings must never change task routing.
 * No schema migration.
 */
export async function ensureLocalOpenAiCompatibleDefaults(): Promise<void> {
  const [existing] = await db
    .select({ id: aiProviderSettingsTable.id })
    .from(aiProviderSettingsTable)
    .where(eq(aiProviderSettingsTable.provider, LOCAL_OPENAI_COMPATIBLE_ID))
    .limit(1);

  if (!existing) {
    const envUrl = readEnvBaseUrl(LOCAL_OPENAI_COMPATIBLE_ID);
    await db.insert(aiProviderSettingsTable).values({
      provider: LOCAL_OPENAI_COMPATIBLE_ID,
      isEnabled: true,
      isDefault: false,
      defaultModel: LOCAL_OPENAI_DEFAULT_MODEL,
      endpointUrl: envUrl || null,
      settingsJson: JSON.stringify(DEFAULT_SETTINGS),
    });
  }
}
