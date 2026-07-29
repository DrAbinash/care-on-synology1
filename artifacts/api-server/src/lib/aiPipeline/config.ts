/**
 * Single backend source of truth for OCR + local-AI pipeline configuration.
 * Env vars win; clinic_settings / admin UI may override selected models at runtime
 * via getAiPipelineRuntimeConfig() callers — do not scatter process.env reads elsewhere.
 */

export type OcrEngine = "paddle" | "tesseract" | "vision";
export type OcrProfile = "fast" | "accurate";
export type OcrDevice = "auto" | "cpu" | "gpu";
export type AiMode = "AUTO" | "FAST" | "STANDARD" | "DEEP" | "OCR_ONLY";

function boolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function numEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

function strEnv(name: string, defaultValue: string): string {
  const raw = process.env[name];
  return raw != null && raw.trim() !== "" ? raw.trim() : defaultValue;
}

export interface AiPipelineConfig {
  ocrEngine: OcrEngine;
  ocrProfile: OcrProfile;
  ocrDevice: OcrDevice;
  ocrLowConfidenceThreshold: number;
  ocrRetryAccurate: boolean;
  ocrTesseractFallback: boolean;
  ocrWorkerUrl: string;
  ocrWorkerToken: string | null;
  ocrWorkerConcurrency: number;
  ollamaBaseUrl: string;
  aiMode: AiMode;
  modelFast: string;
  modelStandard: string;
  modelLarge: string;
  modelVision: string;
  timeoutFastSeconds: number;
  timeoutLargeSeconds: number;
  aiConcurrency: number;
  temperatureExtraction: number;
  temperatureDraft: number;
  pipelineVersion: string;
}

let cached: AiPipelineConfig | null = null;

export function loadAiPipelineConfig(forceReload = false): AiPipelineConfig {
  if (cached && !forceReload) return cached;

  const engineRaw = strEnv("OCR_ENGINE", "paddle").toLowerCase();
  const ocrEngine: OcrEngine =
    engineRaw === "tesseract" || engineRaw === "vision" ? engineRaw : "paddle";

  const profileRaw = strEnv("OCR_PROFILE", "fast").toLowerCase();
  const ocrProfile: OcrProfile = profileRaw === "accurate" ? "accurate" : "fast";

  const deviceRaw = strEnv("OCR_DEVICE", "auto").toLowerCase();
  const ocrDevice: OcrDevice =
    deviceRaw === "cpu" || deviceRaw === "gpu" ? deviceRaw : "auto";

  const modeRaw = strEnv("AI_MODE", "AUTO").toUpperCase();
  const aiMode: AiMode =
    (["AUTO", "FAST", "STANDARD", "DEEP", "OCR_ONLY"] as AiMode[]).includes(modeRaw as AiMode)
      ? (modeRaw as AiMode)
      : "AUTO";

  cached = {
    ocrEngine,
    ocrProfile,
    ocrDevice,
    ocrLowConfidenceThreshold: numEnv("OCR_LOW_CONFIDENCE_THRESHOLD", 0.8),
    ocrRetryAccurate: boolEnv("OCR_RETRY_ACCURATE", true),
    ocrTesseractFallback: boolEnv("OCR_TESSERACT_FALLBACK", true),
    ocrWorkerUrl: strEnv("OCR_WORKER_URL", "http://127.0.0.1:8090").replace(/\/$/, ""),
    ocrWorkerToken: strEnv("OCR_WORKER_TOKEN", "") || null,
    ocrWorkerConcurrency: Math.max(1, numEnv("OCR_WORKER_CONCURRENCY", 1)),
    ollamaBaseUrl: strEnv("OLLAMA_BASE_URL", strEnv("OLLAMA_PRIMARY_URL", "http://127.0.0.1:11434")).replace(/\/$/, ""),
    aiMode,
    modelFast: strEnv("AI_MODEL_FAST", "gemma3:4b"),
    modelStandard: strEnv("AI_MODEL_STANDARD", "gemma3:4b"),
    modelLarge: strEnv("AI_MODEL_LARGE", "gemma3:12b"),
    modelVision: strEnv("AI_MODEL_VISION", "gemma3:4b"),
    timeoutFastSeconds: Math.max(10, numEnv("AI_TIMEOUT_FAST_SECONDS", 120)),
    timeoutLargeSeconds: Math.max(30, numEnv("AI_TIMEOUT_LARGE_SECONDS", 300)),
    aiConcurrency: Math.max(1, numEnv("AI_CONCURRENCY", 1)),
    temperatureExtraction: numEnv("AI_TEMPERATURE_EXTRACTION", 0),
    temperatureDraft: numEnv("AI_TEMPERATURE_DRAFT", 0.1),
    pipelineVersion: "care-ai-ocr-v1",
  };
  return cached;
}

/** Test helper */
export function resetAiPipelineConfigCache(): void {
  cached = null;
}