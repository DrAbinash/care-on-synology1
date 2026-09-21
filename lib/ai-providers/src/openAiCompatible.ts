/**
 * Shared OpenAI-compatible chat transport.
 * Used by DeepSeek, Qwen (DashScope), and OpenAI — one implementation, thin configs.
 */
import OpenAI from "openai";

export type CompatibleImagePart = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
};

export type CompatibleChatRequest = {
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  images?: CompatibleImagePart[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
  /**
   * When true, an empty apiKey is allowed and a non-secret placeholder is
   * sent to the OpenAI SDK (required by the client). Used ONLY by local
   * OpenAI-compatible servers that do not require auth. Cloud providers
   * must leave this unset/false.
   */
  allowEmptyApiKey?: boolean;
  /** Provider-specific body extras (e.g. Qwen enable_thinking:false). */
  extraBody?: Record<string, unknown>;
};

export type CompatibleUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type CompatibleChatResult =
  | {
      ok: true;
      text: string;
      provider: string;
      model: string;
      latencyMs: number;
      usage: CompatibleUsage;
    }
  | {
      ok: false;
      provider: string;
      model: string;
      safeError: string;
      latencyMs: number;
      usage: CompatibleUsage;
    };

function emptyUsage(): CompatibleUsage {
  return { promptTokens: null, completionTokens: null, totalTokens: null };
}

function scrubKey(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("[REDACTED_API_KEY]");
}

/**
 * Single shared OpenAI-compatible /chat/completions call.
 * Do not duplicate SDK clients in composer adapters.
 */
export async function openAiCompatibleChat(
  req: CompatibleChatRequest,
): Promise<CompatibleChatResult> {
  const started = Date.now();
  const provider = req.provider;
  const model = (req.model || "").trim();
  const imageCount = req.images?.length ?? 0;

  const apiKeyTrimmed = (req.apiKey ?? "").trim();
  if (!apiKeyTrimmed && !req.allowEmptyApiKey) {
    return {
      ok: false,
      provider,
      model,
      safeError: `${provider}_api_key_not_configured`,
      latencyMs: Date.now() - started,
      usage: emptyUsage(),
    };
  }
  if (!req.baseURL?.trim()) {
    return {
      ok: false,
      provider,
      model,
      safeError: `${provider}_base_url_missing`,
      latencyMs: Date.now() - started,
      usage: emptyUsage(),
    };
  }

  // OpenAI SDK requires a non-empty apiKey string even when the server ignores it.
  const sdkApiKey = apiKeyTrimmed || "not-needed";

  const client = new OpenAI({
    apiKey: sdkApiKey,
    baseURL: req.baseURL.replace(/\/$/, ""),
    timeout: req.timeoutMs ?? 120_000,
  });

  try {
    type ContentPart =
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } };

    const userContent: ContentPart[] = [{ type: "text", text: req.userPrompt }];
    for (const img of req.images ?? []) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
      });
    }

    const messages: Array<{ role: "system" | "user"; content: string | ContentPart[] }> = [];
    if (req.systemPrompt?.trim()) {
      messages.push({ role: "system", content: req.systemPrompt });
    }
    messages.push({
      role: "user",
      content: imageCount > 0 ? userContent : req.userPrompt,
    });

    const body: Record<string, unknown> = {
      model,
      temperature: req.temperature ?? 0.1,
      messages,
      ...(req.maxTokens != null ? { max_tokens: req.maxTokens } : {}),
      ...(req.jsonMode !== false ? { response_format: { type: "json_object" } } : {}),
      ...(req.extraBody ?? {}),
    };

    const resp = await client.chat.completions.create(
      body as unknown as Parameters<typeof client.chat.completions.create>[0],
    );

    const text =
      "choices" in resp && Array.isArray(resp.choices)
        ? (resp.choices[0]?.message?.content ?? "")
        : "";
    const usageRaw = "usage" in resp ? resp.usage : undefined;
    const latencyMs = Date.now() - started;
    const usage: CompatibleUsage = {
      promptTokens: usageRaw?.prompt_tokens ?? null,
      completionTokens: usageRaw?.completion_tokens ?? null,
      totalTokens: usageRaw?.total_tokens ?? null,
    };

    if (!String(text).trim()) {
      return {
        ok: false,
        provider,
        model,
        safeError: "empty_model_response",
        latencyMs,
        usage,
      };
    }

    return { ok: true, text: String(text), provider, model, latencyMs, usage };
  } catch (err: unknown) {
    const latencyMs = Date.now() - started;
    const raw = err instanceof Error ? err.message : String(err);
    const scrubbed = scrubKey(raw, sdkApiKey).slice(0, 180) || `${provider}_request_failed`;
    const safeError = `${provider}_request_failed:${scrubbed.replace(/[^a-zA-Z0-9_.: -]/g, "").slice(0, 80)}`;
    return {
      ok: false,
      provider,
      model,
      safeError,
      latencyMs,
      usage: emptyUsage(),
    };
  }
}

/** Official defaults — verified against vendor docs (not guessed). */
export const COMPATIBLE_PROVIDER_DEFAULTS: Record<
  string,
  {
    baseURL: string;
    envKey: string[];
    envBaseUrl?: string;
    defaultModel: string;
    /** LOCAL OpenAI-compatible servers may omit API keys. */
    allowEmptyApiKey?: boolean;
    /** Execution classification — LOCAL must never be treated as cloud. */
    execution?: "LOCAL" | "CLOUD";
  }
> = {
  deepseek: {
    baseURL: "https://api.deepseek.com",
    envKey: ["DEEPSEEK_API_KEY"],
    envBaseUrl: "DEEPSEEK_BASE_URL",
    defaultModel: "deepseek-v4-pro",
    execution: "CLOUD",
  },
  qwen: {
    // Alibaba Model Studio international OpenAI-compatible endpoint
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    envKey: ["QWEN_API_KEY", "DASHSCOPE_API_KEY"],
    envBaseUrl: "QWEN_BASE_URL",
    defaultModel: "qwen3.7-plus",
    execution: "CLOUD",
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    envKey: ["OPENAI_API_KEY"],
    envBaseUrl: "OPENAI_BASE_URL",
    defaultModel: "gpt-4o",
    execution: "CLOUD",
  },
  /**
   * Vendor-neutral local OpenAI-compatible server (llama.cpp, vLLM, etc.).
   * Initial clinic config points at PrismML Bonsai — but the provider id is
   * NOT Bonsai-specific. Empty baseURL means "must be configured in Settings".
   */
  local_openai_compatible: {
    baseURL: "",
    envKey: ["LOCAL_OPENAI_COMPATIBLE_API_KEY"],
    envBaseUrl: "LOCAL_OPENAI_COMPATIBLE_BASE_URL",
    defaultModel: "bonsai",
    allowEmptyApiKey: true,
    execution: "LOCAL",
  },
};

/** Providers that use OpenAI wire format but run on clinic/local hardware. */
export const LOCAL_OPENAI_COMPATIBLE_PROVIDER = "local_openai_compatible" as const;

export function isLocalOpenAiCompatibleProvider(provider: string): boolean {
  return provider === LOCAL_OPENAI_COMPATIBLE_PROVIDER;
}

/** True for Ollama + local OpenAI-compatible — never subject to cloud vision gates. */
export function isLocalExecutionProvider(provider: string): boolean {
  return provider === "ollama" || isLocalOpenAiCompatibleProvider(provider);
}

export function readEnvApiKey(provider: string): string | null {
  const cfg = COMPATIBLE_PROVIDER_DEFAULTS[provider];
  if (!cfg) return null;
  for (const name of cfg.envKey) {
    const v = (process.env[name] ?? "").trim();
    if (v) return v;
  }
  return null;
}

export function readEnvBaseUrl(provider: string): string | null {
  const cfg = COMPATIBLE_PROVIDER_DEFAULTS[provider];
  if (!cfg) return null;
  if (cfg.envBaseUrl) {
    const v = (process.env[cfg.envBaseUrl] ?? "").trim().replace(/\/$/, "");
    if (v) return v;
  }
  const fallback = (cfg.baseURL ?? "").trim().replace(/\/$/, "");
  return fallback || null;
}

export function isCompatibleProviderConfigured(provider: string): boolean {
  if (isLocalOpenAiCompatibleProvider(provider)) {
    // Local servers are "configured" when a base URL is available (env).
    // DB endpoint is checked by higher layers (createAiProviderFromDb).
    return Boolean(readEnvBaseUrl(provider)?.trim());
  }
  return readEnvApiKey(provider) != null;
}
