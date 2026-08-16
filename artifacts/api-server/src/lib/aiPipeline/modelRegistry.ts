/**
 * Central Model Registry for local Ollama models used by the OCR→AI pipeline.
 * Display metadata + resource class; does not call Ollama by itself.
 *
 * While Local AI is locked to one chat/vision model, all tiers resolve to that
 * model (from config / resolveLocalAiRuntime overlay).
 */

import { loadAiPipelineConfig, type AiMode, type AiPipelineConfig } from "./config";
import { CANONICAL_LOCAL_CHAT_VISION_MODEL } from "./canonicalLocalAi";

export type ModelModality = "text" | "vision";
export type ResourceClass = "small" | "medium" | "large";

export interface ModelRegistryEntry {
  id: string;
  displayName: string;
  ollamaName: string;
  purpose: string;
  modality: ModelModality;
  resourceClass: ResourceClass;
  enabled: boolean;
  maxContext: number;
  timeoutSeconds: number;
  temperature: number;
  supportedTasks: string[];
  /** Soft warning for RTX 3050 8GB class hardware */
  vramWarning?: string;
}

export function buildModelRegistry(cfgOverride?: AiPipelineConfig): ModelRegistryEntry[] {
  const cfg = cfgOverride ?? loadAiPipelineConfig();
  const name = cfg.modelStandard || cfg.modelVision || CANONICAL_LOCAL_CHAT_VISION_MODEL;
  const label = name.includes("qwen") ? `Qwen3-VL (${name})` : name;
  return [
    {
      id: "fast",
      displayName: `${label} (Fast)`,
      ollamaName: cfg.modelFast || name,
      purpose: "Routine OCR cleanup, extraction, straightforward drafting",
      modality: "vision",
      resourceClass: "medium",
      enabled: true,
      maxContext: cfg.ollamaNumCtx,
      timeoutSeconds: cfg.timeoutFastSeconds,
      temperature: cfg.temperatureExtraction,
      supportedTasks: ["ocr_cleanup", "demographic_extraction", "structured_extraction", "draft_simple"],
    },
    {
      id: "standard",
      displayName: `${label} (Standard)`,
      ollamaName: cfg.modelStandard || name,
      purpose: "Normal production drafting with fuller prompts/validation",
      modality: "vision",
      resourceClass: "medium",
      enabled: true,
      maxContext: cfg.ollamaNumCtx,
      timeoutSeconds: cfg.timeoutFastSeconds,
      temperature: cfg.temperatureDraft,
      supportedTasks: ["ocr_cleanup", "demographic_extraction", "structured_extraction", "radiology_draft", "quality_check"],
    },
    {
      id: "large",
      displayName: `${label} (Deep)`,
      ollamaName: cfg.modelLarge || name,
      purpose: "Explicit Deep mode — same canonical local model until multi-model is re-enabled",
      modality: "vision",
      resourceClass: "medium",
      enabled: true,
      maxContext: cfg.ollamaNumCtx,
      timeoutSeconds: cfg.timeoutLargeSeconds,
      temperature: cfg.temperatureDraft,
      supportedTasks: ["radiology_draft", "quality_check", "complex_extraction"],
    },
    {
      id: "vision",
      displayName: `${label} (Vision / Overnight MRI)`,
      ollamaName: cfg.modelVision || name,
      purpose: "Overnight MRI AI drafts (bounded key images) via Ollama vision",
      modality: "vision",
      resourceClass: "medium",
      enabled: true,
      maxContext: cfg.ollamaNumCtx,
      timeoutSeconds: cfg.timeoutLargeSeconds,
      temperature: cfg.temperatureDraft,
      supportedTasks: ["radiology_draft", "vision_ocr"],
    },
  ];
}

export function entryForMode(mode: AiMode, cfgOverride?: AiPipelineConfig): ModelRegistryEntry | null {
  if (mode === "OCR_ONLY") return null;
  const reg = buildModelRegistry(cfgOverride);
  if (mode === "FAST") return reg.find((e) => e.id === "fast") ?? null;
  if (mode === "DEEP") return reg.find((e) => e.id === "large") ?? null;
  if (mode === "STANDARD" || mode === "AUTO") return reg.find((e) => e.id === "standard") ?? null;
  return reg.find((e) => e.id === "standard") ?? null;
}

/** Hardware hint for UI when selecting large models */
export function isLikelyTooLargeForRtx3050(ollamaName: string): boolean {
  const n = ollamaName.toLowerCase();
  if (/:1b|:2b|:3b|:4b|:7b|:8b|:9b/.test(n)) return false;
  if (/12b|13b|14b|20b|27b|32b|70b/.test(n)) return true;
  return false;
}
