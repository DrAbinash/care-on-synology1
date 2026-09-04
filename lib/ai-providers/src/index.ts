/**
 * AI Provider Abstraction Layer
 *
 * Unified interface for all AI providers (OpenAI, Gemini, Anthropic, Ollama).
 * The registry reads provider configurations from the database, and the factory
 * creates provider instances with the correct credentials. Both the Radiology AI
 * Reporting system and the Legacy AI system use this library.
 *
 * Security: API keys are encrypted in the database; the registry decrypts them
 * at runtime. Endpoint URLs (not secrets) are stored plaintext.
 */
import { db } from "@workspace/db";
import { aiProviderSettingsTable, aiModelRoutesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { decryptSecret } from "@workspace/crypto";

// ─── Canonical on-prem Local AI (chat/vision) ───────────────────────────────
// Keep in sync with artifacts/api-server/.../canonicalLocalAi.ts.
// Embeddings (nomic-embed-text) and Paddle OCR are separate exceptions.

export const CANONICAL_OLLAMA_ENDPOINT = "http://172.16.1.140:11434";
export const CANONICAL_LOCAL_CHAT_VISION_MODEL = "qwen3-vl:8b";

function envOllamaEndpoint(): string {
  const raw =
    process.env.OLLAMA_BASE_URL?.trim() ||
    process.env.OLLAMA_PRIMARY_URL?.trim() ||
    process.env.OLLAMA_URL?.trim() ||
    "";
  return (raw.replace(/\/$/, "") || CANONICAL_OLLAMA_ENDPOINT);
}

/** Normalize Ollama base URL for identity compares (trim + strip trailing slash). */
export function normalizeOllamaEndpointUrl(url: string): string {
  return (url ?? "").trim().replace(/\/+$/, "");
}

/**
 * True for loopback Ollama URLs on non-standard ports (typical `listen(0)` /
 * ephemeral test/mock servers). Standard local Ollama (`:11434`) is allowed.
 * Production must never inherit these when a clinic LAN endpoint is configured.
 */
export function isEphemeralLoopbackOllamaUrl(url: string): boolean {
  try {
    const u = new URL(normalizeOllamaEndpointUrl(url));
    const host = u.hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") return false;
    const port = Number(u.port || (u.protocol === "https:" ? "443" : "80"));
    return Number.isFinite(port) && port !== 11434 && port > 1024;
  } catch {
    return false;
  }
}

export type OllamaRuntimeEndpoint = {
  endpointUrl: string;
  model?: string | null;
};

/**
 * Bridge to the api-server's existing `resolveLocalAiRuntime()` — not a second
 * resolver. When bound, all Ollama generate paths prefer clinic/runtime URL
 * over stale `ai_provider_settings` / ephemeral loopback test URLs.
 */
let ollamaRuntimeEndpointResolver:
  | (() => Promise<OllamaRuntimeEndpoint | null>)
  | null = null;

export function bindOllamaRuntimeEndpointResolver(
  fn: (() => Promise<OllamaRuntimeEndpoint | null>) | null,
): void {
  ollamaRuntimeEndpointResolver = fn;
}

/** True after api-server bootstrap binds resolveLocalAiRuntime into generate paths. */
export function isOllamaRuntimeEndpointResolverBound(): boolean {
  return ollamaRuntimeEndpointResolver != null;
}

/** Test helper — clears the production binder. */
export function resetOllamaRuntimeEndpointResolverForTests(): void {
  ollamaRuntimeEndpointResolver = null;
}

/**
 * Clinic/runtime URL wins over DB mirror, env, and ephemeral loopback test
 * servers. Does not hard-code a LAN IP — caller supplies the clinic URL.
 */
export function preferClinicOllamaEndpoint(opts: {
  clinicOrRuntimeUrl: string | null | undefined;
  candidateUrl: string | null | undefined;
  envFallback?: string;
}): {
  endpointUrl: string;
  source: "clinic_runtime" | "candidate" | "env_canonical";
  rejectedCandidate: string | null;
  rejectReason: string | null;
} {
  const clinic = opts.clinicOrRuntimeUrl?.trim()
    ? normalizeOllamaEndpointUrl(opts.clinicOrRuntimeUrl)
    : null;
  const candidate = opts.candidateUrl?.trim()
    ? normalizeOllamaEndpointUrl(opts.candidateUrl)
    : null;
  const envFallback = normalizeOllamaEndpointUrl(opts.envFallback ?? envOllamaEndpoint());

  if (clinic) {
    if (candidate && candidate !== clinic) {
      if (isEphemeralLoopbackOllamaUrl(candidate)) {
        return {
          endpointUrl: clinic,
          source: "clinic_runtime",
          rejectedCandidate: candidate,
          rejectReason: "ephemeral_loopback_cannot_override_clinic",
        };
      }
      return {
        endpointUrl: clinic,
        source: "clinic_runtime",
        rejectedCandidate: candidate,
        rejectReason: "clinic_settings_wins_over_provider_mirror",
      };
    }
    return {
      endpointUrl: clinic,
      source: "clinic_runtime",
      rejectedCandidate: null,
      rejectReason: null,
    };
  }
  if (candidate) {
    return {
      endpointUrl: candidate,
      source: "candidate",
      rejectedCandidate: null,
      rejectReason: null,
    };
  }
  return {
    endpointUrl: envFallback,
    source: "env_canonical",
    rejectedCandidate: null,
    rejectReason: null,
  };
}

/** Flatten undici `fetch failed` + `cause` so ECONNREFUSED host:port is visible. */
export function formatFetchNetworkError(err: unknown, intendedUrl?: string): string {
  if (!(err instanceof Error)) return String(err).slice(0, 400);
  const parts: string[] = [err.message || "unknown error"];
  let cause: unknown = (err as Error & { cause?: unknown }).cause;
  let depth = 0;
  while (cause && depth < 4) {
    if (cause instanceof Error) {
      const c = cause as Error & { code?: string; address?: string; port?: number };
      const addr =
        c.address != null && c.port != null
          ? `${c.address}:${c.port}`
          : c.message;
      parts.push(c.code ? `${c.code} ${addr}` : addr);
      cause = (c as Error & { cause?: unknown }).cause;
    } else {
      parts.push(String(cause).slice(0, 120));
      break;
    }
    depth += 1;
  }
  if (intendedUrl?.trim()) {
    parts.push(`intended ${normalizeOllamaEndpointUrl(intendedUrl)}`);
  }
  return parts.filter(Boolean).join(" → ").slice(0, 400);
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AiProviderConfig {
  name: string;
  label: string;
  needsApiKey: boolean;
  needsEndpointUrl: boolean;
  defaultModels: string[];
  placeholder: string;
}

export interface AiQueryOptions {
  model: string;
  prompt: string;
  images: string[];
  maxTokens?: number;
  /** Ollama native options.num_ctx (sent on /api/chat). */
  numCtx?: number;
  /** Ollama native `think` flag (false = no chain-of-thought when supported). */
  think?: boolean;
  temperature?: number;
  /**
   * Optional AbortController timeout for the provider HTTP call.
   * When unset, the call has no provider-level AbortSignal (callers / proxies
   * may still impose their own limits). Do not silently default this — draft
   * vs radiology-ollama paths differ intentionally.
   */
  timeoutMs?: number;
}

/** PHI-safe provider call metadata — never include prompts, base64, or raw responses. */
export interface AiQueryDiagnostics {
  provider: string;
  resolvedEndpoint?: string | null;
  model?: string | null;
  numberOfImages: number;
  /** Approximate decoded image payload bytes (from base64 length), not pixels. */
  totalImageBytes: number;
  /** JSON body byte length sent to the provider (includes embedded base64 — size only). */
  requestBodyBytes?: number | null;
  promptLength: number;
  startedAt: string;
  elapsedMs: number;
  httpStatus?: number | null;
  responseLength: number;
  finishReason?: string | null;
  /** Whether `think` was included in the outbound Ollama body. */
  thinkSent?: boolean | null;
  /** Value of think when sent (null if not sent). */
  thinkValue?: boolean | null;
  /** Length of message.thinking if Ollama returned one (not the text). */
  thinkingLength?: number | null;
  /** Ollama timing/eval counters when present (nanoseconds for durations). */
  ollamaTotalDurationNs?: number | null;
  ollamaLoadDurationNs?: number | null;
  ollamaPromptEvalCount?: number | null;
  ollamaEvalCount?: number | null;
  errorClass?: string | null;
  errorCode?: string | null;
  /** Safe truncated provider error (no PHI). */
  errorMessage?: string | null;
  /** Which stage timed out, if any (e.g. provider_http, gateway). */
  timeoutStage?: string | null;
  /** AbortSignal timeout configured for this call; null = none at provider layer. */
  timeoutMsConfigured?: number | null;
  /** options.num_ctx actually placed on the Ollama /api/chat body (null = not sent). */
  requestedNumCtx?: number | null;
  /** From Ollama exceed_context_size_error when present. */
  ollamaAvailableContext?: number | null;
  /** From Ollama exceed_context_size_error / n_prompt_tokens when present. */
  ollamaRequestTokens?: number | null;
}

export interface AiQueryResult {
  text: string;
  success: boolean;
  error?: string;
  /** PHI-safe call metadata for structured server logs. */
  diagnostics?: AiQueryDiagnostics;
}

export interface AiProvider {
  readonly config: AiProviderConfig;
  query(opts: AiQueryOptions): Promise<AiQueryResult>;
  /**
   * Verify connectivity. When `model` is provided it is used verbatim — the
   * caller's selected model must reach the SDK unchanged; only when it is
   * omitted does each provider fall back to its lightweight built-in probe model.
   */
  testConnection(model?: string): Promise<{ ok: boolean; message: string; availableModels?: string[] }>;
}

// ─── Built-in Provider Metadata ─────────────────────────────────────────────

export const BUILTIN_PROVIDER_CONFIGS: Record<string, AiProviderConfig> = {
  openai: {
    name: "openai",
    label: "OpenAI / ChatGPT",
    needsApiKey: true,
    needsEndpointUrl: false,
    defaultModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4-vision-preview"],
    placeholder: "sk-...",
  },
  gemini: {
    name: "gemini",
    label: "Google Gemini",
    needsApiKey: true,
    needsEndpointUrl: false,
    defaultModels: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-pro-preview-05-06"],
    placeholder: "AIza...",
  },
  anthropic: {
    name: "anthropic",
    label: "Anthropic Claude",
    needsApiKey: true,
    needsEndpointUrl: false,
    defaultModels: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229", "claude-opus-4-5"],
    placeholder: "sk-ant-...",
  },
  ollama: {
    name: "ollama",
    label: "Ollama (Local)",
    needsApiKey: false,
    needsEndpointUrl: true,
    // Canonical local chat/vision model until multi-model routing is re-enabled.
    // gemma3:* / qwen3:14b remain listed only so existing saved rows display cleanly.
    defaultModels: [CANONICAL_LOCAL_CHAT_VISION_MODEL, "gemma3:4b", "gemma3:12b", "qwen3:14b", "gpt-oss:20b"],
    placeholder: CANONICAL_OLLAMA_ENDPOINT,
  },
};

export const BUILTIN_PROVIDER_NAMES = Object.keys(BUILTIN_PROVIDER_CONFIGS);

/**
 * Model-family patterns per cloud provider, so a newly released model (e.g.
 * gemini-2.0-flash, gpt-4.1) is accepted without waiting for the built-in list
 * to be updated, while an obvious cross-provider mismatch (gpt-4o sent to
 * gemini) is rejected cleanly. Ollama accepts any pulled model name.
 */
const MODEL_FAMILY_PATTERNS: Record<string, RegExp> = {
  gemini: /^gemini[-.]/i,
  openai: /^(gpt[-.]|o1|o3|o4|chatgpt|text-)/i,
  anthropic: /^claude[-.]/i,
};

export interface ModelValidation { ok: boolean; message?: string }

/**
 * Validate a provider/model combination WITHOUT calling the provider. Empty
 * model → invalid. Unknown provider → invalid. Otherwise valid if the model is a
 * known default, matches the provider's family pattern, or the provider is
 * Ollama (arbitrary pulled names). Pure + testable.
 */
export function validateProviderModel(provider: string, model: string): ModelValidation {
  if (!BUILTIN_PROVIDER_NAMES.includes(provider)) return { ok: false, message: `Unknown provider: ${provider}` };
  const m = (model ?? "").trim();
  if (!m) return { ok: false, message: "Model cannot be empty." };
  if (provider === "ollama") return { ok: true }; // pulled model names are arbitrary
  const known = BUILTIN_PROVIDER_CONFIGS[provider]?.defaultModels ?? [];
  if (known.includes(m)) return { ok: true };
  const pattern = MODEL_FAMILY_PATTERNS[provider];
  if (pattern && pattern.test(m)) return { ok: true };
  return { ok: false, message: `"${m}" is not a recognized ${provider} model.` };
}

// ─── Lazy-loaded SDKs ───────────────────────────────────────────────────────

async function getOpenAIClient(apiKey: string) {
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey });
}

async function getGeminiModel(apiKey: string, model: string) {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model });
}

async function getAnthropicClient(apiKey: string) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic({ apiKey });
}

async function getOllamaClient(endpointUrl: string) {
  const { default: OpenAI } = await import("openai");
  const base = endpointUrl.replace(/\/$/, "");
  return new OpenAI({ baseURL: `${base}/v1`, apiKey: "ollama" });
}

// ─── Provider Implementations ───────────────────────────────────────────────

class OpenAIProvider implements AiProvider {
  config = BUILTIN_PROVIDER_CONFIGS.openai;
  constructor(private apiKey: string) {}

  async query(opts: AiQueryOptions): Promise<AiQueryResult> {
    try {
      const client = await getOpenAIClient(this.apiKey);
      type ContentItem =
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } };
      const content: ContentItem[] = [{ type: "text", text: opts.prompt }];
      for (const img of opts.images) {
        content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}` } });
      }
      const resp = await client.chat.completions.create({
        model: opts.model || "gpt-4o",
        messages: [{ role: "user", content }],
        max_tokens: opts.maxTokens ?? 4096,
      });
      return { text: resp.choices[0]?.message?.content ?? "", success: true };
    } catch (err: unknown) {
      return { text: "", success: false, error: err instanceof Error ? err.message : "OpenAI error" };
    }
  }

  async testConnection(model?: string): Promise<{ ok: boolean; message: string; availableModels?: string[] }> {
    try {
      const client = await getOpenAIClient(this.apiKey);
      const resp = await client.chat.completions.create({
        model: model || "gpt-4o-mini",
        messages: [{ role: "user", content: "Reply with exactly the word: CONNECTED" }],
        max_tokens: 10,
      });
      return { ok: true, message: resp.choices[0]?.message?.content ?? "Connected" };
    } catch (err: unknown) {
      return { ok: false, message: err instanceof Error ? err.message : "OpenAI connection failed" };
    }
  }
}

class GeminiProvider implements AiProvider {
  config = BUILTIN_PROVIDER_CONFIGS.gemini;
  constructor(private apiKey: string) {}

  async query(opts: AiQueryOptions): Promise<AiQueryResult> {
    try {
      const model = await getGeminiModel(this.apiKey, opts.model || "gemini-1.5-pro");
      type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
      const parts: Part[] = [{ text: opts.prompt }];
      for (const img of opts.images) {
        parts.push({ inlineData: { mimeType: "image/jpeg", data: img } });
      }
      const result = await model.generateContent(parts);
      return { text: result.response.text(), success: true };
    } catch (err: unknown) {
      return { text: "", success: false, error: err instanceof Error ? err.message : "Gemini error" };
    }
  }

  async testConnection(model?: string): Promise<{ ok: boolean; message: string; availableModels?: string[] }> {
    try {
      // Use the caller's selected model verbatim; only fall back to the
      // lightweight probe model when no model was supplied.
      const gm = await getGeminiModel(this.apiKey, model || "gemini-1.5-flash");
      const result = await gm.generateContent("Reply with exactly the word: CONNECTED");
      return { ok: true, message: result.response.text() };
    } catch (err: unknown) {
      return { ok: false, message: err instanceof Error ? err.message : "Gemini connection failed" };
    }
  }
}

class AnthropicProvider implements AiProvider {
  config = BUILTIN_PROVIDER_CONFIGS.anthropic;
  constructor(private apiKey: string) {}

  async query(opts: AiQueryOptions): Promise<AiQueryResult> {
    try {
      const client = await getAnthropicClient(this.apiKey);
      type ContentItem =
        | { type: "text"; text: string }
        | { type: "image"; source: { type: "base64"; media_type: string; data: string } };
      const content: Array<
        { type: "text"; text: string }
        | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } }
      > = [];
      for (const img of opts.images) {
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } });
      }
      content.push({ type: "text", text: opts.prompt });
      const resp = await client.messages.create({
        model: opts.model || "claude-3-5-sonnet-20241022",
        max_tokens: opts.maxTokens ?? 4096,
        messages: [{ role: "user", content: content as unknown as Parameters<typeof client.messages.create>[0]["messages"][number]["content"] }],
      });
      const block = resp.content[0];
      return { text: block?.type === "text" ? block.text : "", success: true };
    } catch (err: unknown) {
      return { text: "", success: false, error: err instanceof Error ? err.message : "Anthropic error" };
    }
  }

  async testConnection(model?: string): Promise<{ ok: boolean; message: string; availableModels?: string[] }> {
    try {
      const client = await getAnthropicClient(this.apiKey);
      const resp = await client.messages.create({
        model: model || "claude-3-5-haiku-20241022",
        max_tokens: 10,
        messages: [{ role: "user", content: "Reply with exactly the word: CONNECTED" }],
      });
      const block = resp.content[0];
      return { ok: true, message: block?.type === "text" ? block.text : "Connected" };
    } catch (err: unknown) {
      return { ok: false, message: err instanceof Error ? err.message : "Anthropic connection failed" };
    }
  }
}

/**
 * Strip `<think>…</think>` blocks some models emit (qwen3 family) even when
 * think=false — defensive before JSON parse / draft storage.
 */
export function stripThinkBlocks(text: string): string {
  return (text ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** Build the native Ollama `/api/chat` JSON body (exported for unit tests). */
export function buildOllamaChatPayload(opts: AiQueryOptions): Record<string, unknown> {
  const model = opts.model || CANONICAL_LOCAL_CHAT_VISION_MODEL;
  const images = (opts.images ?? []).map((img) =>
    img.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, ""),
  );
  const message: Record<string, unknown> = {
    role: "user",
    content: opts.prompt,
  };
  if (images.length > 0) message.images = images;

  const options: Record<string, unknown> = {};
  if (opts.numCtx != null && Number.isFinite(opts.numCtx)) options.num_ctx = opts.numCtx;
  if (opts.temperature != null && Number.isFinite(opts.temperature)) options.temperature = opts.temperature;
  if (opts.maxTokens != null && Number.isFinite(opts.maxTokens)) options.num_predict = opts.maxTokens;

  const body: Record<string, unknown> = {
    model,
    messages: [message],
    stream: false,
  };
  // Always send think when the caller sets it (overnight MRI: false).
  if (opts.think !== undefined) body.think = opts.think;
  if (Object.keys(options).length > 0) body.options = options;
  return body;
}

/** Approximate decoded byte length of a base64 (or data-URL) image string. */
export function estimateBase64DecodedBytes(b64OrDataUrl: string): number {
  const raw = (b64OrDataUrl ?? "").replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
  if (!raw) return 0;
  const padding = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((raw.length * 3) / 4) - padding);
}

function classifyProviderError(err: unknown, intendedUrl?: string): {
  errorClass: string;
  errorCode: string | null;
  errorMessage: string;
  timeoutStage: string | null;
} {
  if (err instanceof Error) {
    const name = err.name || "Error";
    const msg = formatFetchNetworkError(err, intendedUrl);
    const aborted =
      name === "AbortError" ||
      /aborted|abort|timed out after|TimeoutError/i.test(msg);
    if (aborted) {
      return {
        errorClass: name,
        errorCode: "PROVIDER_TIMEOUT",
        errorMessage: msg,
        timeoutStage: "provider_http",
      };
    }
    if (/cudaMalloc|out of memory|CUDA error|failed to allocate CUDA|ggml_cuda/i.test(msg)) {
      return {
        errorClass: "GpuOutOfMemory",
        errorCode: "GPU_OUT_OF_MEMORY",
        errorMessage: msg,
        timeoutStage: null,
      };
    }
    const refused = /ECONNREFUSED/i.test(msg);
    return {
      errorClass: refused ? "ConnectionRefused" : name,
      errorCode: refused ? "ECONNREFUSED" : name,
      errorMessage: msg,
      timeoutStage: null,
    };
  }
  return {
    errorClass: "UnknownError",
    errorCode: null,
    errorMessage: String(err).slice(0, 300),
    timeoutStage: null,
  };
}

function parseContextExceededFromOllamaDetail(detail: string): {
  errorCode: string;
  ollamaAvailableContext: number | null;
  ollamaRequestTokens: number | null;
} | null {
  if (!/exceed_context_size_error|exceeds the available context size/i.test(detail)) return null;
  const reqMatch = detail.match(/request\s*\((\d+)\s*tokens?\)/i);
  const availMatch = detail.match(/available context size\s*\((\d+)\s*tokens?\)/i);
  const promptTok = detail.match(/"n_prompt_tokens"\s*:\s*(\d+)/i);
  return {
    errorCode: "CONTEXT_BUDGET_EXCEEDED",
    ollamaRequestTokens: reqMatch
      ? Number(reqMatch[1])
      : promptTok
        ? Number(promptTok[1])
        : null,
    ollamaAvailableContext: availMatch ? Number(availMatch[1]) : null,
  };
}

/** Detect CUDA / GPU OOM in Ollama error bodies (must not become EMPTY). */
function parseGpuOomFromOllamaDetail(detail: string): { errorCode: "GPU_OUT_OF_MEMORY" } | null {
  if (!/cudaMalloc|out of memory|CUDA error|failed to allocate CUDA|ggml_cuda|gpu.?oom/i.test(detail)) {
    return null;
  }
  return { errorCode: "GPU_OUT_OF_MEMORY" };
}

class OllamaProvider implements AiProvider {
  config = BUILTIN_PROVIDER_CONFIGS.ollama;
  constructor(private endpointUrl: string) {}

  async query(opts: AiQueryOptions): Promise<AiQueryResult> {
    const base = this.endpointUrl.replace(/\/$/, "");
    const model = opts.model || CANONICAL_LOCAL_CHAT_VISION_MODEL;
    const images = opts.images ?? [];
    const totalImageBytes = images.reduce((sum, img) => sum + estimateBase64DecodedBytes(img), 0);
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const timeoutMsConfigured = opts.timeoutMs != null && Number.isFinite(opts.timeoutMs)
      ? Math.max(1, Math.floor(opts.timeoutMs))
      : null;
    const requestedNumCtx =
      opts.numCtx != null && Number.isFinite(opts.numCtx) ? Math.floor(opts.numCtx) : null;

    const baseDiag = (): Omit<
      AiQueryDiagnostics,
      | "elapsedMs"
      | "httpStatus"
      | "responseLength"
      | "finishReason"
      | "errorClass"
      | "errorCode"
      | "errorMessage"
      | "timeoutStage"
      | "thinkingLength"
      | "ollamaTotalDurationNs"
      | "ollamaLoadDurationNs"
      | "ollamaPromptEvalCount"
      | "ollamaEvalCount"
      | "ollamaAvailableContext"
      | "ollamaRequestTokens"
    > => ({
      provider: "ollama",
      resolvedEndpoint: base,
      model,
      numberOfImages: images.length,
      totalImageBytes,
      promptLength: (opts.prompt ?? "").length,
      startedAt,
      timeoutMsConfigured,
      thinkSent: opts.think !== undefined,
      thinkValue: opts.think !== undefined ? opts.think : null,
      requestBodyBytes: null,
      requestedNumCtx,
    });

    try {
      const body = buildOllamaChatPayload(opts);
      const bodyJson = JSON.stringify(body);
      const requestBodyBytes = Buffer.byteLength(bodyJson, "utf8");
      const init: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyJson,
      };
      if (timeoutMsConfigured != null) {
        init.signal = AbortSignal.timeout(timeoutMsConfigured);
      }
      const resp = await fetch(`${base}/api/chat`, init);
      const elapsedMs = Date.now() - t0;
      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        const errorMessage = `Ollama /api/chat ${resp.status}${detail ? `: ${detail.slice(0, 400)}` : ""}`;
        const ctxErr = parseContextExceededFromOllamaDetail(detail || errorMessage);
        const gpuErr = parseGpuOomFromOllamaDetail(detail || errorMessage);
        const errorCode =
          ctxErr?.errorCode ?? gpuErr?.errorCode ?? `HTTP_${resp.status}`;
        const errorClass = ctxErr
          ? "ContextBudgetExceeded"
          : gpuErr
            ? "GpuOutOfMemory"
            : "OllamaHttpError";
        return {
          text: "",
          success: false,
          error: errorMessage,
          diagnostics: {
            ...baseDiag(),
            requestBodyBytes,
            elapsedMs,
            httpStatus: resp.status,
            responseLength: 0,
            finishReason: null,
            thinkingLength: null,
            ollamaTotalDurationNs: null,
            ollamaLoadDurationNs: null,
            ollamaPromptEvalCount: null,
            ollamaEvalCount: null,
            ollamaAvailableContext: ctxErr?.ollamaAvailableContext ?? null,
            ollamaRequestTokens: ctxErr?.ollamaRequestTokens ?? null,
            errorClass,
            errorCode,
            errorMessage: errorMessage.slice(0, 400),
            timeoutStage: null,
          },
        };
      }
      const data = (await resp.json()) as {
        message?: { content?: string; thinking?: string };
        response?: string;
        done_reason?: string;
        done?: boolean;
        total_duration?: number;
        load_duration?: number;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const raw = data.message?.content ?? data.response ?? "";
      const thinkingRaw = data.message?.thinking ?? "";
      // Discard message.thinking (chain-of-thought) even if the model ignored think=false.
      const text = stripThinkBlocks(raw);
      return {
        text,
        success: true,
        diagnostics: {
          ...baseDiag(),
          requestBodyBytes,
          elapsedMs,
          httpStatus: resp.status,
          responseLength: text.length,
          finishReason: data.done_reason ?? (data.done === false ? "incomplete" : data.done ? "stop" : null),
          thinkingLength: thinkingRaw.length > 0 ? thinkingRaw.length : 0,
          ollamaTotalDurationNs: typeof data.total_duration === "number" ? data.total_duration : null,
          ollamaLoadDurationNs: typeof data.load_duration === "number" ? data.load_duration : null,
          ollamaPromptEvalCount: typeof data.prompt_eval_count === "number" ? data.prompt_eval_count : null,
          ollamaEvalCount: typeof data.eval_count === "number" ? data.eval_count : null,
          ollamaAvailableContext: null,
          ollamaRequestTokens: typeof data.prompt_eval_count === "number" ? data.prompt_eval_count : null,
          errorClass: null,
          errorCode: null,
          errorMessage: null,
          timeoutStage: null,
        },
      };
    } catch (err: unknown) {
      const classified = classifyProviderError(err, `${base}/api/chat`);
      const elapsedMs = Date.now() - t0;
      return {
        text: "",
        success: false,
        error: classified.errorMessage,
        diagnostics: {
          ...baseDiag(),
          elapsedMs,
          httpStatus: null,
          responseLength: 0,
          finishReason: null,
          thinkingLength: null,
          ollamaTotalDurationNs: null,
          ollamaLoadDurationNs: null,
          ollamaPromptEvalCount: null,
          ollamaEvalCount: null,
          ollamaAvailableContext: null,
          ollamaRequestTokens: null,
          errorClass: classified.errorClass,
          errorCode: classified.errorCode,
          errorMessage: classified.errorMessage,
          timeoutStage: classified.timeoutStage,
        },
      };
    }
  }

  async testConnection(model?: string): Promise<{ ok: boolean; message: string; availableModels?: string[] }> {
    try {
      const url = `${this.endpointUrl.replace(/\/$/, "")}/api/tags`;
      const tagsResp = await fetch(url, { method: "GET" });
      if (!tagsResp.ok) {
        return { ok: false, message: `Ollama server returned ${tagsResp.status}` };
      }
      const tagsData = await tagsResp.json() as { models?: Array<{ name: string; size?: number }> };
      const models = tagsData.models?.map((m) => m.name) ?? [];
      const chatResult = await this.query({
        model: model || CANONICAL_LOCAL_CHAT_VISION_MODEL,
        prompt: "Reply with exactly the word: CONNECTED",
        images: [],
        think: false,
        numCtx: 2048,
      });
      return {
        ok: chatResult.success,
        message: chatResult.text.substring(0, 200),
        availableModels: models,
      };
    } catch (err: unknown) {
      return { ok: false, message: err instanceof Error ? err.message : "Ollama connection failed" };
    }
  }
}

// ─── Provider Factory ───────────────────────────────────────────────────────

export async function createAiProvider(
  name: string,
  apiKey?: string,
  endpointUrl?: string
): Promise<AiProvider | null> {
  const config = BUILTIN_PROVIDER_CONFIGS[name];
  if (!config) return null;

  if (name === "openai" && apiKey) return new OpenAIProvider(apiKey);
  if (name === "gemini" && apiKey) return new GeminiProvider(apiKey);
  if (name === "anthropic" && apiKey) return new AnthropicProvider(apiKey);
  if (name === "ollama" && endpointUrl) return new OllamaProvider(endpointUrl);

  return null;
}

// ─── Database-backed Provider Registry ──────────────────────────────────────

export interface ProviderDbRow {
  provider: string;
  isEnabled: boolean;
  isDefault: boolean;
  hasApiKey: boolean;
  hasEndpointUrl: boolean;
  defaultModel: string | null;
  endpointUrl: string | null;
}

/**
 * Load all provider configurations from the database. Returns rows for all
 * built-in providers regardless of whether they have been configured yet.
 */
export async function loadProviderConfigs(): Promise<ProviderDbRow[]> {
  const rows = await db
    .select()
    .from(aiProviderSettingsTable)
    .where(eq(aiProviderSettingsTable.provider, "__global__"))
    .limit(1);

  const all = await Promise.all(
    BUILTIN_PROVIDER_NAMES.map(async (name) => {
      const [row] = await db
        .select()
        .from(aiProviderSettingsTable)
        .where(eq(aiProviderSettingsTable.provider, name))
        .limit(1);
      return {
        provider: name,
        isEnabled: row?.isEnabled ?? false,
        isDefault: row?.isDefault ?? false,
        hasApiKey: !!(row?.encryptedApiKey),
        hasEndpointUrl: !!(row?.endpointUrl),
        defaultModel: row?.defaultModel ?? null,
        endpointUrl: row?.endpointUrl ?? null,
      };
    })
  );
  return all;
}

/**
 * Get a single provider's config from the database.
 */
export async function loadProviderConfig(name: string): Promise<ProviderDbRow | null> {
  const [row] = await db
    .select()
    .from(aiProviderSettingsTable)
    .where(eq(aiProviderSettingsTable.provider, name))
    .limit(1);
  if (!row) return null;
  return {
    provider: name,
    isEnabled: row.isEnabled ?? false,
    isDefault: row.isDefault ?? false,
    hasApiKey: !!(row.encryptedApiKey),
    hasEndpointUrl: !!(row.endpointUrl),
    defaultModel: row.defaultModel ?? null,
    endpointUrl: row.endpointUrl ?? null,
  };
}

/**
 * Get the decrypted API key for a provider from the database.
 */
export async function getProviderApiKey(provider: string): Promise<string | null> {
  const [row] = await db
    .select({ encryptedApiKey: aiProviderSettingsTable.encryptedApiKey })
    .from(aiProviderSettingsTable)
    .where(eq(aiProviderSettingsTable.provider, provider))
    .limit(1);
  if (!row?.encryptedApiKey) return null;
  try {
    return decryptSecret(row.encryptedApiKey);
  } catch {
    return null;
  }
}

/**
 * Get the endpoint URL for a provider from the database.
 */
export async function getProviderEndpointUrl(provider: string): Promise<string | null> {
  const [row] = await db
    .select({ endpointUrl: aiProviderSettingsTable.endpointUrl })
    .from(aiProviderSettingsTable)
    .where(eq(aiProviderSettingsTable.provider, provider))
    .limit(1);
  return row?.endpointUrl ?? null;
}

/**
 * Create a provider instance from the database credentials.
 */
export async function createAiProviderFromDb(name: string): Promise<AiProvider | null> {
  const config = await loadProviderConfig(name);
  if (!config) return null;
  const meta = BUILTIN_PROVIDER_CONFIGS[name];

  let apiKey: string | undefined;
  let endpointUrl: string | undefined;

  if (meta?.needsApiKey) {
    const key = await getProviderApiKey(name);
    if (!key) return null;
    apiKey = key;
  }

  if (meta?.needsEndpointUrl) {
    const url = await getProviderEndpointUrl(name);
    // Ollama: DB row is a mirror of Local AI settings; env/canonical fills gaps
    // so overnight/OCR never hard-fail when clinic_settings was set via env only.
    if (name === "ollama") {
      endpointUrl = (url?.trim().replace(/\/$/, "") || envOllamaEndpoint());
    } else if (!url) {
      return null;
    } else {
      endpointUrl = url;
    }
  }

  return createAiProvider(name, apiKey, endpointUrl);
}

/**
 * Resolve the Ollama base URL the same way generateAiResponse does — clinic
 * runtime (when bound) wins over ai_provider_settings / env / ephemeral loopback.
 */
export async function resolveOllamaInferenceEndpoint(opts?: {
  endpointUrl?: string | null;
}): Promise<{
  endpointUrl: string;
  source: "clinic_runtime" | "candidate" | "env_canonical";
  rejectedCandidate: string | null;
  rejectReason: string | null;
}> {
  let clinicRuntimeUrl: string | null = null;
  if (ollamaRuntimeEndpointResolver) {
    try {
      const rt = await ollamaRuntimeEndpointResolver();
      if (rt?.endpointUrl?.trim()) {
        clinicRuntimeUrl = normalizeOllamaEndpointUrl(rt.endpointUrl);
      }
    } catch {
      /* fall through */
    }
  }
  const override = opts?.endpointUrl?.trim()
    ? normalizeOllamaEndpointUrl(opts.endpointUrl)
    : null;
  let dbUrl: string | null = null;
  try {
    dbUrl = (await getProviderEndpointUrl("ollama"))?.replace(/\/$/, "") || null;
  } catch {
    dbUrl = null;
  }
  return preferClinicOllamaEndpoint({
    clinicOrRuntimeUrl: clinicRuntimeUrl,
    candidateUrl: override || dbUrl,
  });
}

/**
 * Unified generate function that picks the provider from the database and
 * runs the query. Returns the result directly.
 */
export async function generateAiResponse(
  providerName: string,
  prompt: string,
  images?: string[],
  options?: {
    model?: string;
    maxTokens?: number;
    numCtx?: number;
    think?: boolean;
    temperature?: number;
    /** Override endpoint (Local AI runtime) — preferred for Ollama. */
    endpointUrl?: string;
    /** Optional provider HTTP AbortSignal timeout (ms). */
    timeoutMs?: number;
  },
): Promise<AiQueryResult> {
  const imgs = images ?? [];
  const startedAt = new Date().toISOString();
  const totalImageBytes = imgs.reduce((sum, img) => sum + estimateBase64DecodedBytes(img), 0);

  // Fail closed: clinical / PHI-bearing images must not leave the clinic.
  // Local providers (ollama) are allowed; cloud providers are blocked regardless
  // of env keys. Text-only prompts are unchanged.
  if (imgs.length > 0 && providerName !== "ollama") {
    return {
      text: "",
      success: false,
      error: "Clinical images cannot be sent to cloud AI providers. Use local Ollama vision or a text-only request.",
      diagnostics: {
        provider: providerName,
        resolvedEndpoint: null,
        model: options?.model ?? null,
        numberOfImages: imgs.length,
        totalImageBytes,
        promptLength: (prompt ?? "").length,
        startedAt,
        elapsedMs: 0,
        httpStatus: null,
        responseLength: 0,
        finishReason: null,
        errorClass: "PhiImageCloudBlocked",
        errorCode: "PHI_IMAGE_CLOUD_BLOCKED",
        errorMessage: "Clinical images cannot be sent to cloud AI providers.",
        timeoutStage: null,
        timeoutMsConfigured: options?.timeoutMs ?? null,
      },
    };
  }

  let provider: AiProvider | null = null;
  let resolvedEndpoint: string | null = null;
  let runtimeModelHint: string | null = null;

  if (providerName === "ollama") {
    let clinicRuntimeUrl: string | null = null;
    if (ollamaRuntimeEndpointResolver) {
      try {
        const rt = await ollamaRuntimeEndpointResolver();
        if (rt?.endpointUrl?.trim()) {
          clinicRuntimeUrl = normalizeOllamaEndpointUrl(rt.endpointUrl);
        }
        if (rt?.model?.trim()) runtimeModelHint = rt.model.trim();
      } catch {
        // Resolver unavailable (tests / early boot) — fall through to override/DB/env.
      }
    }
    const override = options?.endpointUrl?.trim()
      ? normalizeOllamaEndpointUrl(options.endpointUrl)
      : null;
    let dbUrl: string | null = null;
    try {
      dbUrl = (await getProviderEndpointUrl("ollama"))?.replace(/\/$/, "") || null;
    } catch {
      dbUrl = null;
    }
    const preferred = preferClinicOllamaEndpoint({
      clinicOrRuntimeUrl: clinicRuntimeUrl,
      candidateUrl: override || dbUrl,
    });
    resolvedEndpoint = preferred.endpointUrl;
    provider = await createAiProvider("ollama", undefined, resolvedEndpoint);
  } else {
    provider = await createAiProviderFromDb(providerName);
  }
  if (!provider) {
    return {
      text: "",
      success: false,
      error: `Provider ${providerName} is not configured.`,
      diagnostics: {
        provider: providerName,
        resolvedEndpoint,
        model: options?.model ?? null,
        numberOfImages: imgs.length,
        totalImageBytes,
        promptLength: (prompt ?? "").length,
        startedAt,
        elapsedMs: 0,
        httpStatus: null,
        responseLength: 0,
        finishReason: null,
        errorClass: "ProviderNotConfigured",
        errorCode: "PROVIDER_NOT_CONFIGURED",
        errorMessage: `Provider ${providerName} is not configured.`,
        timeoutStage: null,
        timeoutMsConfigured: options?.timeoutMs ?? null,
      },
    };
  }
  // Model precedence: explicit option → admin-configured stored default →
  // canonical local chat/vision model for Ollama.
  let model = options?.model?.trim() || "";
  if (!model && providerName === "ollama" && runtimeModelHint) {
    model = runtimeModelHint;
  }
  if (!model) {
    const cfg = await loadProviderConfig(providerName);
    model = cfg?.defaultModel ?? "";
  }
  if (!model && providerName === "ollama") {
    model = CANONICAL_LOCAL_CHAT_VISION_MODEL;
  }
  const result = await provider.query({
    model,
    prompt,
    images: imgs,
    maxTokens: options?.maxTokens,
    numCtx: options?.numCtx,
    think: options?.think,
    temperature: options?.temperature,
    timeoutMs: options?.timeoutMs,
  });
  // Ensure diagnostics always carry the resolved endpoint/model for this call.
  if (!result.diagnostics) {
    result.diagnostics = {
      provider: providerName,
      resolvedEndpoint,
      model,
      numberOfImages: imgs.length,
      totalImageBytes,
      promptLength: (prompt ?? "").length,
      startedAt,
      elapsedMs: 0,
      httpStatus: null,
      responseLength: (result.text ?? "").length,
      finishReason: null,
      errorClass: result.success ? null : "ProviderError",
      errorCode: result.success ? null : "PROVIDER_ERROR",
      errorMessage: result.error?.slice(0, 300) ?? null,
      timeoutStage: null,
      timeoutMsConfigured: options?.timeoutMs ?? null,
    };
  } else {
    result.diagnostics.provider = result.diagnostics.provider || providerName;
    result.diagnostics.resolvedEndpoint = result.diagnostics.resolvedEndpoint ?? resolvedEndpoint;
    result.diagnostics.model = result.diagnostics.model ?? model;
  }
  return result;
}

// ─── Model Routing (Phase 4) ─────────────────────────────────────────────────

export interface AiTaskDef {
  key: string;
  label: string;
  description: string;
  /** True if the task may send images to the provider (needs a vision model). */
  vision: boolean;
}

/**
 * Catalog of routable AI tasks. Adding a task here makes it configurable in the
 * Model Routing UI; callers opt in by passing the matching key to
 * generateAiForTask(). Tasks not present here simply use the default provider.
 */
export const AI_TASK_CATALOG: AiTaskDef[] = [
  { key: "radiology_draft", label: "Radiology AI Draft", description: "AI-assisted radiology report drafting from study context/images.", vision: true },
  { key: "report_enhancement", label: "Report Enhancement", description: "Auto-generate findings, impression and measurements for a report.", vision: false },
  { key: "clinical_notes", label: "Clinical Notes", description: "Generate clinical notes from patient demographics and history.", vision: false },
  { key: "billing_insights", label: "Billing Insights", description: "Summarize billing/revenue patterns for a patient or period.", vision: false },
  { key: "patient_communication", label: "Patient Communication", description: "Draft patient-facing messages (reminders, results, follow-ups).", vision: false },
  { key: "dictation_polish", label: "Dictation Polish", description: "Punctuation/formatting-only cleanup of dictated radiology text — never changes clinical meaning. Route to a local (Ollama) model to keep PHI on-prem.", vision: false },
  { key: "report_findings", label: "Radiology Findings", description: "Generate the findings section of a radiology report.", vision: false },
  { key: "report_impression", label: "Radiology Impression", description: "Generate the impression section of a radiology report.", vision: false },
  { key: "echo_draft", label: "Echo Cardiology AI Draft", description: "AI-assisted 2D echocardiography report drafting from measurements and valve assessment.", vision: false },
  { key: "fetal_echo_draft", label: "Fetal Echo AI Draft", description: "AI-assisted fetal echocardiography report drafting from fetal echo parameters.", vision: false },
  { key: "fetal_usg_draft", label: "Fetal USG Level-4 AI Draft", description: "AI-assisted fetal ultrasound report drafting from biometry and anomaly scan data.", vision: false },
  { key: "usg_ai_assistant", label: "USG AI Assistant", description: "Advisory USG reporting suggestions (findings/impression) for the USG Companion workspace. Text-only; runs through the safety filter (never outputs fetal sex, accept-only, draft-only). Route to a local (Ollama) model to keep PHI on-prem.", vision: false },
  { key: "echo_report_delivery", label: "Echo Report Delivery Message", description: "Draft patient-facing message for echo report delivery.", vision: false },
  { key: "fetal_usg_report_delivery", label: "Fetal USG Report Delivery Message", description: "Draft patient-facing message for fetal USG report delivery.", vision: false },
  // Phase 7A: Advanced Multi-AI Tasks
  { key: "image_review_assistant", label: "Image Review Assistant", description: "Structured image review with possible findings, differential, measurements, and follow-up recommendations.", vision: true },
  { key: "missed_finding_detector", label: "Missed Finding Detector", description: "Knowledge-base check for potentially missed critical findings in a report.", vision: false },
  { key: "ai_comparison", label: "AI Comparison", description: "Run the same prompt against multiple AI providers for comparison.", vision: true },
  { key: "prompt_test", label: "Prompt Test", description: "Test any AI prompt against a selected provider for validation.", vision: false },
  // AI Receptionist (see WHATSAPP_SYSTEM_AUDIT.md) — added after discovering
  // generateAiForTask("whatsapp_ai_receptionist", ...) was already being
  // called from routes/whatsapp.ts and WhatsAppBotEngine.ts without this
  // task ever being registered here. The fallback chain in
  // generateAiForTask works correctly regardless (any string key is
  // queryable against ai_model_routes), but without a catalog entry the
  // admin UI (AiModelRouting.tsx) had no way to ever SHOW this task to
  // configure — an admin could not point WhatsApp AI at a different
  // provider (e.g. Ollama) through any screen, only by writing to the
  // database directly. This entry closes that gap.
  { key: "whatsapp_ai_receptionist", label: "WhatsApp AI Receptionist", description: "Knowledge-Base-grounded patient replies on WhatsApp (both the menu bot's free-text fallback and the Meta webhook's AI path).", vision: false },
  // Form F / PCPNDT ID card OCR — was previously hardwired to call Gemini
  // directly (bypassing this registry entirely), which meant it required
  // AI_INTEGRATIONS_GEMINI_API_KEY / a Gemini row in AI Provider Settings
  // even on installs where Ollama is the clinic's actual configured
  // provider. Registered here so it participates in the same task-routing
  // system as everything else (an admin can pin it to a specific provider
  // via the Model Routing UI); when no explicit route exists the OCR
  // resolver in artifacts/api-server/src/lib/ocr applies an Ollama-first,
  // Gemini-fallback policy instead of generateAiForTask's plain
  // single-provider default, since OCR specifically needs to degrade
  // gracefully to manual entry rather than hard-fail.
  { key: "id_card_ocr", label: "ID Card OCR (Form F)", description: "Extract identity fields (name, DOB, gender, address, ID number) from a scanned government ID for PCPNDT Form F.", vision: true },
  { key: "bill_ocr", label: "Expense Bill OCR", description: "Extract vendor, date, amount, GST, category, and payment mode from a photographed bill or receipt. Local Ollama vision — Gemini is not used.", vision: true },
  { key: "bank_statement_ocr", label: "Bank Statement OCR", description: "Extract transaction rows from a photographed or scanned bank statement. Local Ollama vision — Gemini is not used.", vision: true },
  { key: "invoice_ocr", label: "Purchase Invoice OCR", description: "Extract vendor, invoice number, totals, and line items from a supplier invoice image. Local Ollama vision — Gemini is not used.", vision: true },
];

export const AI_TASK_KEYS = AI_TASK_CATALOG.map((t) => t.key);

/**
 * Resolve the default provider name: the explicit global default, else the first
 * enabled provider, else gemini. Centralized here so every caller (legacy AI,
 * radiology, routing) shares one fallback policy.
 */
export async function getDefaultProviderName(): Promise<string> {
  const [global] = await db
    .select({ settingsJson: aiProviderSettingsTable.settingsJson })
    .from(aiProviderSettingsTable)
    .where(eq(aiProviderSettingsTable.provider, "__global__"))
    .limit(1);
  if (global?.settingsJson) {
    try {
      const parsed = JSON.parse(global.settingsJson) as { defaultProvider?: string };
      if (parsed.defaultProvider && BUILTIN_PROVIDER_NAMES.includes(parsed.defaultProvider)) {
        return parsed.defaultProvider;
      }
    } catch {
      /* ignore malformed settings */
    }
  }
  for (const name of BUILTIN_PROVIDER_NAMES) {
    const [p] = await db
      .select({ isEnabled: aiProviderSettingsTable.isEnabled })
      .from(aiProviderSettingsTable)
      .where(eq(aiProviderSettingsTable.provider, name))
      .limit(1);
    if (p?.isEnabled) return name;
  }
  return "gemini";
}

/**
 * Resolve the active route for a task, or null if none is configured.
 */
export async function resolveTaskRoute(
  taskKey: string,
): Promise<{ provider: string; model?: string } | null> {
  const [row] = await db
    .select({ provider: aiModelRoutesTable.provider, model: aiModelRoutesTable.model })
    .from(aiModelRoutesTable)
    .where(and(eq(aiModelRoutesTable.taskKey, taskKey), eq(aiModelRoutesTable.isActive, true)))
    .limit(1);
  if (!row) return null;
  return { provider: row.provider, model: row.model ?? undefined };
}

/**
 * Task-aware generation. Provider/model precedence:
 *   explicit option override → configured task route → global default provider.
 * With no route and no override this is identical to the previous behavior, so
 * it is safe to swap existing callers over to it.
 */
export async function generateAiForTask(
  taskKey: string,
  prompt: string,
  images?: string[],
  options?: {
    provider?: string;
    model?: string;
    maxTokens?: number;
    numCtx?: number;
    think?: boolean;
    temperature?: number;
    endpointUrl?: string;
    timeoutMs?: number;
  },
): Promise<AiQueryResult> {
  const route = options?.provider ? null : await resolveTaskRoute(taskKey);
  const providerName = options?.provider ?? route?.provider ?? (await getDefaultProviderName());
  const model = options?.model ?? route?.model;
  return generateAiResponse(providerName, prompt, images, {
    model,
    maxTokens: options?.maxTokens,
    numCtx: options?.numCtx,
    think: options?.think,
    temperature: options?.temperature,
    endpointUrl: options?.endpointUrl,
    timeoutMs: options?.timeoutMs,
  });
}

// ─── Ollama vision-capability & reachability helpers ────────────────────────
// Ollama has no single API that reliably tells a caller "does this model
// accept images" across all server versions, so this is intentionally a
// two-tier check: prefer the real /api/show capabilities field when the
// server reports one (modern Ollama), fall back to a name-pattern heuristic
// otherwise. Neither tier is guaranteed exhaustive — an unrecognized model
// name resolves to "unknown" rather than a false positive/negative, and
// callers should treat "unknown" as "attempt it, but don't promise vision
// support in the UI."

const KNOWN_VISION_MODEL_PATTERNS = [
  /llava/i, /bakllava/i, /moondream/i, /minicpm-v/i, /pixtral/i,
  /llama3\.2-vision/i, /llama-vision/i, /llama4/i,
  /qwen2(\.5)?-vl/i, /qwen-vl/i, /qwen3-vl/i, /granite3\.2-vision/i, /cogvlm/i,
  /gemma3(?!:1b)/i, // gemma3 family supports vision except the 1b text-only variant
];
const KNOWN_TEXT_ONLY_MODEL_PATTERNS = [
  /gpt-oss/i, /^llama3(\.1)?(?!.*vision)/i, /mistral/i, /mixtral/i,
  /phi-?3/i, /phi-?4/i, /qwen2(\.5)?(?!.*vl)/i, /deepseek/i, /codellama/i,
  /starcoder/i, /gemma2/i, /^gemma(?!3)/i, /command-r/i, /gemma3:1b/i,
];

/** Best-effort, name-based classification — see module doc comment above. */
export function classifyOllamaModelVisionByName(model: string): "vision" | "text-only" | "unknown" {
  const name = (model || "").trim();
  if (!name) return "unknown";
  if (KNOWN_VISION_MODEL_PATTERNS.some((p) => p.test(name))) return "vision";
  if (KNOWN_TEXT_ONLY_MODEL_PATTERNS.some((p) => p.test(name))) return "text-only";
  return "unknown";
}

/**
 * Fast reachability probe — a plain GET /api/tags with a short timeout, NOT
 * a full chat completion (unlike AiProvider.testConnection(), which is
 * correct for an explicit "Test Connection" button click but too slow to
 * run on every OCR request). Returns the model list when reachable so
 * callers can cross-check the configured model is actually pulled.
 */
export async function probeOllamaReachable(
  endpointUrl: string,
  timeoutMs = 3000,
): Promise<{ reachable: boolean; models?: string[]; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${endpointUrl.replace(/\/$/, "")}/api/tags`;
    const resp = await fetch(url, { method: "GET", signal: controller.signal });
    if (!resp.ok) return { reachable: false, error: `Ollama server returned ${resp.status}` };
    const data = (await resp.json()) as { models?: Array<{ name: string }> };
    return { reachable: true, models: data.models?.map((m) => m.name) ?? [] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err.name === "AbortError" ? `Timed out after ${timeoutMs}ms` : err.message) : "Ollama unreachable";
    return { reachable: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Real capability check via Ollama's /api/show, when the server reports a
 * `capabilities` array (Ollama 0.4+). Returns null (not false) when the
 * server doesn't report capabilities at all, so callers fall back to the
 * name-based heuristic instead of concluding "no vision support."
 */
export async function probeOllamaModelVision(
  endpointUrl: string,
  model: string,
  timeoutMs = 3000,
): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${endpointUrl.replace(/\/$/, "")}/api/show`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { capabilities?: string[] };
    if (!Array.isArray(data.capabilities)) return null;
    return data.capabilities.includes("vision");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Phase P2 — AI Gateway / Evaluation (Gates G7/G8) ─────────────────────────
// The AI Gateway is the hardened evolution of this module: it reuses the
// provider routing + generateAiResponse above and adds capability routing,
// resilience, contract enforcement, and evaluation. See gateway.ts.
export * from "./reportContract";
export * from "./circuitLogic";
export * from "./circuitBreaker";
export * from "./capabilityRegistry";
export * from "./gateway";
export * from "./evaluation";
