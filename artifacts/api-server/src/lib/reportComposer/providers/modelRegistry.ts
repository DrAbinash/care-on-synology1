/**
 * Model capability helpers for the Report Composer domain facade.
 * Delegates to @workspace/ai-providers builtin capabilities (not a parallel registry).
 */
import {
  listBuiltinModels,
  lookupBuiltinCapability,
  modelSupportsVision,
  assertVisionCapable,
  defaultModelForProvider,
  type BuiltinModelCapability,
} from "@workspace/ai-providers";
import type { ComposerProviderCapabilities, ComposerProviderName } from "./types";

export type RegisteredModel = {
  provider: ComposerProviderName;
  modelId: string;
  displayName: string;
  text: boolean;
  vision: boolean;
  structuredOutput: boolean;
  local: boolean;
  enabled: boolean;
  experimental: boolean;
};

function toRegistered(m: BuiltinModelCapability): RegisteredModel {
  return {
    provider: m.provider as ComposerProviderName,
    modelId: m.model,
    displayName: m.displayName,
    text: true,
    vision: m.supportsVision,
    structuredOutput: m.supportsGroundedJson,
    local: m.isLocal,
    enabled: true,
    experimental: m.experimental === true,
  };
}

export function listModels(opts?: {
  provider?: ComposerProviderName;
  text?: boolean;
  vision?: boolean;
}): RegisteredModel[] {
  return listBuiltinModels({
    provider: opts?.provider,
    vision: opts?.vision,
  }).map(toRegistered);
}

export function getRegisteredModel(
  provider: ComposerProviderName,
  modelId: string,
): RegisteredModel | null {
  const row = lookupBuiltinCapability(provider, modelId);
  return row ? toRegistered(row) : null;
}

export function defaultModelFor(
  provider: ComposerProviderName,
  capability: "text" | "vision",
): string | null {
  return defaultModelForProvider(provider, capability === "vision");
}

export function modelCapabilities(
  provider: ComposerProviderName,
  modelId: string,
): ComposerProviderCapabilities {
  const row = lookupBuiltinCapability(provider, modelId);
  if (row) {
    return {
      text: true,
      vision: row.supportsVision,
      structuredOutput: row.supportsGroundedJson,
      local: row.isLocal,
    };
  }
  if (provider === "ollama") {
    return {
      text: true,
      vision: modelSupportsVision("ollama", modelId),
      structuredOutput: true,
      local: true,
    };
  }
  return { text: true, vision: false, structuredOutput: true, local: false };
}

export function assertModelSupportsCapability(
  provider: ComposerProviderName,
  modelId: string,
  need: "text" | "vision",
): { ok: true } | { ok: false; safeError: string } {
  if (need === "vision") return assertVisionCapable(provider, modelId);
  return { ok: true };
}

export { modelSupportsVision };
