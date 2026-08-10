/**
 * Canonical Local AI runtime configuration.
 *
 * ONE resolved object for Ollama URL + AI mode + Fast/Standard/Deep/Vision models.
 * Env vars are defaults only. clinic_settings (Local AI admin UI) overlays URL +
 * standard model. Do not read ai_provider_settings for these fields at runtime —
 * that row is kept in sync on Local AI save so legacy generateAiForTask paths
 * stay consistent.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { clinicSettingsTable, aiProviderSettingsTable } from "@workspace/db";
import {
  loadAiPipelineConfig,
  resetAiPipelineConfigCache,
  type AiPipelineConfig,
} from "./config";

export type LocalAiRuntime = AiPipelineConfig & {
  /** Where the Ollama URL came from */
  ollamaUrlSource: "clinic_settings" | "env";
  /** Where the standard model came from */
  modelStandardSource: "clinic_settings" | "env";
  ollamaEnabled: boolean;
  ollamaFallbackUrl: string | null;
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

  let ollamaBaseUrl = env.ollamaBaseUrl;
  let ollamaUrlSource: LocalAiRuntime["ollamaUrlSource"] = "env";
  let modelStandard = env.modelStandard;
  let modelFast = env.modelFast;
  let modelStandardSource: LocalAiRuntime["modelStandardSource"] = "env";
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
        ollamaBaseUrl = row.ollamaBaseUrl.trim().replace(/\/$/, "");
        ollamaUrlSource = "clinic_settings";
      }
      if (row.ollamaFallbackUrl?.trim()) {
        ollamaFallbackUrl = row.ollamaFallbackUrl.trim().replace(/\/$/, "");
      }
      if (row.ollamaModel?.trim()) {
        // Local AI "Default Model" is the canonical STANDARD (and FAST) model.
        modelStandard = row.ollamaModel.trim();
        modelFast = row.ollamaModel.trim();
        modelStandardSource = "clinic_settings";
      }
    }
  } catch {
    // DB unavailable during tests / early boot — env defaults only
  }

  const value: LocalAiRuntime = {
    ...env,
    ollamaBaseUrl,
    modelStandard,
    modelFast,
    // Deep + Vision stay env-configured (no dual DB fields yet)
    modelLarge: env.modelLarge,
    modelVision: env.modelVision,
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
  const endpointUrl = opts.endpointUrl?.trim().replace(/\/$/, "") || null;
  const defaultModel = opts.defaultModel?.trim() || null;

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
