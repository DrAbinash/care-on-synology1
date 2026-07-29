/**
 * Central Model Registry for local Ollama models used by the OCR→AI pipeline.
 * Display metadata + resource class; does not call Ollama by itself.
 */

import { loadAiPipelineConfig, type AiMode } from "./config";

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

export function buildModelRegistry(): ModelRegistryEntry[] {
  const cfg = loadAiPipelineConfig();
  return [
    {
      id: "fast",
      displayName: "Gemma 3 4B (Fast)",
      ollamaName: cfg.modelFast,
      purpose: "Routine OCR cleanup, extraction, straightforward drafting",
      modality: "text",
      resourceClass: "small",
      enabled: true,
      maxContext: 8192,
      timeoutSeconds: cfg.timeoutFastSeconds,
      temperature: cfg.temperatureExtraction,
      supportedTasks: ["ocr_cleanup", "demographic_extraction", "structured_extraction", "draft_simple"],
    },
    {
      id: "standard",
      displayName: "Gemma 3 4B (Standard)",
      ollamaName: cfg.modelStandard,
      purpose: "Normal production drafting with fuller prompts/validation",
      modality: "text",
      resourceClass: "small",
      enabled: true,
      maxContext: 8192,
      timeoutSeconds: cfg.timeoutFastSeconds,
      temperature: cfg.temperatureDraft,
      supportedTasks: ["ocr_cleanup", "demographic_extraction", "structured_extraction", "radiology_draft", "quality_check"],
    },
    {
      id: "large",
      displayName: "Gemma 3 12B (Deep)",
      ollamaName: cfg.modelLarge,
      purpose: "Explicit Deep/Large mode only — slower on 8 GB GPUs",
      modality: "text",
      resourceClass: "large",
      enabled: true,
      maxContext: 8192,
      timeoutSeconds: cfg.timeoutLargeSeconds,
      temperature: cfg.temperatureDraft,
      supportedTasks: ["radiology_draft", "quality_check", "complex_extraction"],
      vramWarning: "Gemma 3 12B may be slow or OOM on RTX 3050 8 GB VRAM. Prefer 4B for routine work.",
    },
    {
      id: "vision",
      displayName: "Gemma 3 4B Vision",
      ollamaName: cfg.modelVision,
      purpose: "Explicit vision analysis when OCR text is insufficient",
      modality: "vision",
      resourceClass: "medium",
      enabled: true,
      maxContext: 4096,
      timeoutSeconds: cfg.timeoutFastSeconds,
      temperature: cfg.temperatureExtraction,
      supportedTasks: ["vision_ocr", "id_card_ocr"],
    },
  ];
}

export function entryForMode(mode: AiMode): ModelRegistryEntry | null {
  if (mode === "OCR_ONLY") return null;
  const reg = buildModelRegistry();
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