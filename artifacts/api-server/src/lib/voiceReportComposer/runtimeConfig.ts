/**
 * Resolve task-specific Report Composer model — separate from vision model.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { clinicSettingsTable } from "@workspace/db";
import { resolveLocalAiRuntime } from "../aiPipeline/runtimeConfig";
import { normalizeOllamaBaseUrl } from "../aiPipeline/canonicalLocalAi";

export type ComposerRuntime = {
  enabled: boolean;
  endpoint: string;
  endpointSource: string;
  model: string;
  fallbackModel: string | null;
  numCtx: number;
  temperature: number;
  timeoutMs: number;
  localOnly: boolean;
  visionModel: string;
};

let cache: { value: ComposerRuntime; expiresAt: number } | null = null;

export function invalidateComposerRuntimeCache(): void {
  cache = null;
}

export async function resolveComposerRuntime(force = false): Promise<ComposerRuntime> {
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) return cache.value;

  const localRuntime = await resolveLocalAiRuntime(force);
  let composerModel: string | null = null;
  let fallbackModel: string | null = null;
  let numCtx = 4096;
  let temperature = 0.1;
  let timeoutSeconds = 45;
  let localOnly = false;

  try {
    const [row] = await db
      .select({
        ollamaComposerModel: clinicSettingsTable.ollamaComposerModel,
        ollamaComposerFallbackModel: clinicSettingsTable.ollamaComposerFallbackModel,
        ollamaComposerNumCtx: clinicSettingsTable.ollamaComposerNumCtx,
        ollamaComposerTemperature: clinicSettingsTable.ollamaComposerTemperature,
        ollamaComposerTimeoutSeconds: clinicSettingsTable.ollamaComposerTimeoutSeconds,
        ollamaLocalOnly: clinicSettingsTable.ollamaLocalOnly,
      })
      .from(clinicSettingsTable)
      .orderBy(desc(clinicSettingsTable.id))
      .limit(1);

    if (row) {
      composerModel = row.ollamaComposerModel?.trim() || null;
      fallbackModel = row.ollamaComposerFallbackModel?.trim() || null;
      numCtx = Math.max(2048, Math.min(8192, Number(row.ollamaComposerNumCtx ?? 4096)));
      temperature = Math.max(0, Math.min(1, Number(row.ollamaComposerTemperature ?? 0.1)));
      timeoutSeconds = Math.max(10, Math.min(120, Number(row.ollamaComposerTimeoutSeconds ?? 45)));
      localOnly = row.ollamaLocalOnly ?? false;
    }
  } catch {
    // tests / early boot
  }

  const value: ComposerRuntime = {
    enabled: localRuntime.ollamaEnabled && !!composerModel,
    endpoint: normalizeOllamaBaseUrl(localRuntime.ollamaBaseUrl),
    endpointSource: localRuntime.ollamaUrlSource,
    model: composerModel ?? "",
    fallbackModel,
    numCtx,
    temperature,
    timeoutMs: timeoutSeconds * 1000,
    localOnly,
    visionModel: localRuntime.localChatVisionModel,
  };

  cache = { value, expiresAt: now + 5000 };
  return value;
}
