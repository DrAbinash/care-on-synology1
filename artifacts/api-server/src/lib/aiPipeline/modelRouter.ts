/**
 * Deterministic model router — never random.
 * Local chat/vision resolves to the single canonical model from pipeline config
 * (overlaid at runtime by resolveLocalAiRuntime).
 */

import { loadAiPipelineConfig, type AiMode, type AiPipelineConfig } from "./config";
import { buildModelRegistry, entryForMode, type ModelRegistryEntry } from "./modelRegistry";

export type AiTaskType =
  | "ocr_cleanup"
  | "demographic_extraction"
  | "structured_extraction"
  | "radiology_draft"
  | "quality_check"
  | "vision_analysis"
  | "ocr_only";

export interface RouterInput {
  mode?: AiMode;
  task: AiTaskType;
  ocrConfidence?: number;
  documentLength?: number;
  pageCount?: number;
  imageUnderstandingRequired?: boolean;
  structuredExtractionSucceeded?: boolean;
  userRequestedDeep?: boolean;
  installedModels?: string[];
  ollamaReachable?: boolean;
  /** Admin must enable before AUTO may pick Deep for complexity */
  allowAutoDeep?: boolean;
  /** Prefer passing resolveLocalAiRuntime() result so routing matches jobs. */
  config?: AiPipelineConfig;
}

export interface RouterDecision {
  useLlm: boolean;
  model: string | null;
  registryEntry: ModelRegistryEntry | null;
  mode: AiMode;
  reason: string;
  warnings: string[];
  sendImages: boolean;
  temperature: number;
  timeoutSeconds: number;
}

function modelInstalled(name: string, installed?: string[]): boolean {
  if (!installed || installed.length === 0) return true; // unknown — allow, probe later
  const want = name.toLowerCase();
  const wantBase = want.split(":")[0] ?? want;
  const wantTag = want.includes(":") ? want.slice(want.indexOf(":") + 1) : "";
  return installed.some((m) => {
    const x = m.toLowerCase();
    if (x === want) return true;
    if (wantTag && x.startsWith(want + "-")) return true;
    if (wantTag && x.startsWith(wantBase + ":" + wantTag)) return true;
    return false;
  });
}

export function routeAiModel(input: RouterInput): RouterDecision {
  const cfg = input.config ?? loadAiPipelineConfig();
  const mode: AiMode = input.mode ?? cfg.aiMode;
  const warnings: string[] = [];

  if (input.task === "ocr_only" || mode === "OCR_ONLY") {
    return {
      useLlm: false,
      model: null,
      registryEntry: null,
      mode: "OCR_ONLY",
      reason: "OCR-only mode — no LLM call",
      warnings,
      sendImages: false,
      temperature: 0,
      timeoutSeconds: 0,
    };
  }

  if (input.ollamaReachable === false) {
    return {
      useLlm: false,
      model: null,
      registryEntry: null,
      mode,
      reason: "Ollama unavailable — preserving OCR result only",
      warnings: ["ollama_unavailable"],
      sendImages: false,
      temperature: 0,
      timeoutSeconds: 0,
    };
  }

  if (input.imageUnderstandingRequired || input.task === "vision_analysis") {
    const vision = buildModelRegistry(cfg).find((e) => e.id === "vision")!;
    let model = vision.ollamaName;
    if (!modelInstalled(model, input.installedModels)) {
      warnings.push(`vision_model_missing:${model}`);
      const std = entryForMode("STANDARD", cfg);
      model = std?.ollamaName ?? cfg.modelStandard;
      warnings.push(`fell_back_to:${model}`);
    }
    return {
      useLlm: true,
      model,
      registryEntry: vision,
      mode,
      reason: "Explicit vision analysis requested",
      warnings,
      sendImages: true,
      temperature: vision.temperature,
      timeoutSeconds: vision.timeoutSeconds,
    };
  }

  if (
    typeof input.ocrConfidence === "number" &&
    input.ocrConfidence < cfg.ocrLowConfidenceThreshold &&
    mode === "AUTO"
  ) {
    warnings.push("low_ocr_confidence_prefer_accurate_ocr_not_large_llm");
  }

  let effectiveMode: AiMode = mode;
  if (mode === "AUTO") {
    if (input.userRequestedDeep && input.allowAutoDeep) {
      effectiveMode = "DEEP";
    } else if (
      input.allowAutoDeep &&
      (input.documentLength ?? 0) > 12000 &&
      input.structuredExtractionSucceeded === false
    ) {
      effectiveMode = "STANDARD";
      warnings.push("long_document_kept_on_canonical_model");
    } else {
      effectiveMode = "STANDARD";
    }
  }
  if (input.userRequestedDeep) {
    effectiveMode = "DEEP";
  }

  const entry = entryForMode(effectiveMode === "AUTO" ? "STANDARD" : effectiveMode, cfg);
  if (!entry) {
    return {
      useLlm: false,
      model: null,
      registryEntry: null,
      mode: effectiveMode,
      reason: "No registry entry for mode",
      warnings,
      sendImages: false,
      temperature: 0,
      timeoutSeconds: 0,
    };
  }

  let model = entry.ollamaName;
  if (!modelInstalled(model, input.installedModels)) {
    warnings.push(`requested_model_missing:${model}`);
    const fallback = cfg.modelFast;
    if (modelInstalled(fallback, input.installedModels) || !input.installedModels?.length) {
      model = fallback;
      warnings.push(`fell_back_to:${fallback}`);
    } else if (input.installedModels.length) {
      model = input.installedModels[0]!;
      warnings.push(`fell_back_to_first_installed:${model}`);
    }
  }

  if (entry.vramWarning && effectiveMode === "DEEP") {
    warnings.push(entry.vramWarning);
  }

  return {
    useLlm: true,
    model,
    registryEntry: { ...entry, ollamaName: model },
    mode: effectiveMode,
    reason:
      effectiveMode === "DEEP"
        ? `Explicit Deep mode → ${model}`
        : effectiveMode === "FAST"
          ? `Fast mode → ${model}`
          : `Routine production → ${model} (canonical local)`,
    warnings,
    sendImages: false,
    temperature:
      input.task === "radiology_draft" || input.task === "quality_check"
        ? cfg.temperatureDraft
        : cfg.temperatureExtraction,
    timeoutSeconds: entry.timeoutSeconds,
  };
}
