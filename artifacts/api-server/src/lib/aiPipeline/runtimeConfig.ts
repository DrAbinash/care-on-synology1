/**
 * Canonical Local AI runtime configuration.
 *
 * ONE resolved object for Ollama URL + local chat/vision model used by overnight
 * MRI, OCR, radiology Local AI, health checks, and verifiers.
 *
 * Env vars are bootstrap defaults only. clinic_settings (Local AI admin UI)
 * overlays URL + model. Do not read ai_provider_settings for these fields at
 * runtime — that row is kept in sync on Local AI save so legacy
 * generateAiForTask paths stay consistent.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { clinicSettingsTable, aiProviderSettingsTable } from "@workspace/db";
import {
  loadAiPipelineConfig,
  resetAiPipelineConfigCache,
  type AiPipelineConfig,
} from "./config";
import {
  CANONICAL_LOCAL_CHAT_VISION_MODEL,
  CANONICAL_OLLAMA_ENDPOINT,
  normalizeLocalChatVisionModel,
  normalizeOllamaBaseUrl,
} from "./canonicalLocalAi";

export type LocalAiRuntime = AiPipelineConfig & {
  /** Where the Ollama URL came from */
  ollamaUrlSource: "clinic_settings" | "env" | "canonical";
  /** Where the local chat/vision model came from */
  modelStandardSource: "clinic_settings" | "env" | "canonical";
  ollamaEnabled: boolean;
  ollamaFallbackUrl: string | null;
  /**
   * Single local chat/vision model used by overnight, OCR, Local AI panel,
   * and verifiers. Equal to modelFast/standard/large/vision while architecture
   * is locked to one model.
   */
  localChatVisionModel: string;
};

let runtimeCache: { value: LocalAiRuntime; expiresAt: number } | null = null;
const CACHE_MS = 5_000;

export function invalidateLocalAiRuntimeCache(): void {
  runtimeCache = null;
  resetAiPipelineConfigCache();
}

export async function resolveLocalAiRuntime(forceReload = false): Promise<LocalAiRuntime> {
  const now = Date.now();
  if (!forceReload && runtimeCache && runtimeCache.expiresAt > now) {
    return runtimeCache.value;
  }

  const env = loadAiPipelineConfig(forceReload);

  let ollamaBaseUrl = normalizeOllamaBaseUrl(env.ollamaBaseUrl);
  let ollamaUrlSource: LocalAiRuntime["ollamaUrlSource"] =
    env.ollamaBaseUrl === CANONICAL_OLLAMA_ENDPOINT && !process.env.OLLAMA_BASE_URL && !process.env.OLLAMA_PRIMARY_URL
      ? "canonical"
      : "env";
  let localModel = normalizeLocalChatVisionModel(env.modelStandard || env.modelVision);
  let modelStandardSource: LocalAiRuntime["modelStandardSource"] =
    localModel === CANONICAL_LOCAL_CHAT_VISION_MODEL && !process.env.AI_MODEL_STANDARD && !process.env.AI_MODEL_VISION
      ? "canonical"
      : "env";
  let ollamaEnabled = true;
  let ollamaFallbackUrl: string | null = null;

  try {
    const rows = await db
      .select({
        ollamaBaseUrl: clinicSettingsTable.ollamaBaseUrl,
        ollamaFallbackUrl: clinicSettingsTable.ollamaFallbackUrl,
        ollamaModel: clinicSettingsTable.ollamaModel,
        ollamaEnabled: clinicSettingsTable.ollamaEnabled,
      })
      .from(clinicSettingsTable)
      .orderBy(desc(clinicSettingsTable.id))
      .limit(1);
    const row = rows[0];
    if (row) {
      ollamaEnabled = row.ollamaEnabled !== false;
      if (row.ollamaBaseUrl?.trim()) {
        ollamaBaseUrl = normalizeOllamaBaseUrl(row.ollamaBaseUrl);
        ollamaUrlSource = "clinic_settings";
      }
      if (row.ollamaFallbackUrl?.trim()) {
        ollamaFallbackUrl = normalizeOllamaBaseUrl(row.ollamaFallbackUrl);
      }
      if (row.ollamaModel?.trim()) {
        localModel = normalizeLocalChatVisionModel(row.ollamaModel);
        modelStandardSource = "clinic_settings";
      }
    }
  } catch {
    // DB unavailable during tests / early boot — env/canonical defaults only
  }

  const value: LocalAiRuntime = {
    ...env,
    ollamaBaseUrl,
    // Lock all chat/vision tiers to the single local model.
    modelStandard: localModel,
    modelFast: localModel,
    modelLarge: localModel,
    modelVision: localModel,
    localChatVisionModel: localModel,
    ollamaUrlSource,
    modelStandardSource,
    ollamaEnabled,
    ollamaFallbackUrl,
  };

  runtimeCache = { value, expiresAt: now + CACHE_MS };
  return value;
}

/**
 * Keep ai_provider_settings.ollama aligned with the canonical Local AI settings
 * so Form F / generateAiForTask do not diverge.
 */
export async function syncOllamaProviderSettings(opts: {
  endpointUrl: string | null;
  defaultModel: string | null;
  isEnabled: boolean;
}): Promise<void> {
  const endpointUrl = normalizeOllamaBaseUrl(opts.endpointUrl);
  const defaultModel = normalizeLocalChatVisionModel(opts.defaultModel);

  const [existing] = await db
    .select({ id: aiProviderSettingsTable.id })
    .from(aiProviderSettingsTable)
    .where(eq(aiProviderSettingsTable.provider, "ollama"))
    .limit(1);

  if (existing) {
    await db
      .update(aiProviderSettingsTable)
      .set({
        endpointUrl,
        defaultModel,
        isEnabled: opts.isEnabled,
        updatedAt: new Date(),
      })
      .where(eq(aiProviderSettingsTable.id, existing.id));
  } else {
    await db.insert(aiProviderSettingsTable).values({
      provider: "ollama",
      endpointUrl,
      defaultModel,
      isEnabled: opts.isEnabled,
      isDefault: false,
    });
  }

  invalidateLocalAiRuntimeCache();
}
