/**
 * HTTP client for the Windows PaddleOCR worker (default :8090).
 */

import { loadAiPipelineConfig } from "../aiPipeline/config";

export interface PaddleOcrLine {
  text: string;
  confidence: number;
  bbox?: number[][] | null;
  page: number;
}

export interface PaddleOcrPage {
  page: number;
  text: string;
  lines: PaddleOcrLine[];
  mean_confidence: number;
  processing_ms: number;
}

export interface PaddleOcrResponse {
  ok: boolean;
  engine: "paddle";
  profile: string;
  model_label: string;
  device: string;
  text: string;
  pages: PaddleOcrPage[];
  mean_confidence: number;
  low_confidence_line_ratio: number;
  processing_ms: number;
  warnings: string[];
  path_used: string;
  pipeline_version: string;
  empty: boolean;
  diagnostics?: Record<string, unknown>;
}

export interface PaddleHealth {
  ok: boolean;
  paddle_loaded: boolean;
  profiles_ready: string[];
  device_requested: string;
  device_actual: string;
  gpu_available: boolean;
  gpu_init_error?: string | null;
  active_jobs: number;
  average_processing_ms?: number | null;
  success_count: number;
  failure_count: number;
  last_success_at?: string | null;
  last_error?: string | null;
  version?: string;
  pipeline_version?: string;
  config?: Record<string, unknown>;
}

export class PaddleOcrClientError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "PaddleOcrClientError";
  }
}

function authHeaders(): Record<string, string> {
  const cfg = loadAiPipelineConfig();
  const h: Record<string, string> = {};
  if (cfg.ocrWorkerToken) h["X-OCR-Token"] = cfg.ocrWorkerToken;
  return h;
}

export async function fetchPaddleHealth(timeoutMs = 4000): Promise<PaddleHealth | null> {
  const cfg = loadAiPipelineConfig();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.ocrWorkerUrl}/health`, { signal: ctrl.signal, headers: authHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as PaddleHealth;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function runPaddleOcr(opts: {
  buffer: Buffer;
  filename?: string;
  mimeType?: string;
  profile?: "fast" | "accurate" | "auto";
  preprocess?: boolean;
  expectedKeywords?: string[];
  timeoutMs?: number;
}): Promise<PaddleOcrResponse> {
  const cfg = loadAiPipelineConfig();
  const form = new FormData();
  const bytes = new Uint8Array(opts.buffer);
  const blob = new Blob([bytes], { type: opts.mimeType || "application/octet-stream" });
  form.append("file", blob, opts.filename || "scan.bin");
  form.append("profile", opts.profile ?? "auto");
  form.append("preprocess", String(opts.preprocess ?? true));
  if (opts.expectedKeywords?.length) {
    form.append("expected_keywords", opts.expectedKeywords.join(","));
  }

  const ctrl = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.ocrWorkerUrl}/ocr`, {
      method: "POST",
      body: form,
      headers: authHeaders(),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => null)) as PaddleOcrResponse | null;
    if (res.status === 422 && json) {
      // Empty OCR — structured rejection
      return { ...json, ok: false, empty: true };
    }
    if (!res.ok || !json) {
      throw new PaddleOcrClientError(
        `PaddleOCR worker HTTP ${res.status}`,
        res.status,
        json,
      );
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}