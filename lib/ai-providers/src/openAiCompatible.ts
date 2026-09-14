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

  if (!req.apiKey?.trim()) {
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

  const client = new OpenAI({
    apiKey: req.apiKey,
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
    const scrubbed = scrubKey(raw, req.apiKey).slice(0, 180) || `${provider}_request_failed`;
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
  { baseURL: string; envKey: string[]; envBaseUrl?: string; defaultModel: string }
> = {
  deepseek: {
    baseURL: "https://api.deepseek.com",
    envKey: ["DEEPSEEK_API_KEY"],
    envBaseUrl: "DEEPSEEK_BASE_URL",
    defaultModel: "deepseek-v4-pro",
  },
  qwen: {
    // Alibaba Model Studio international OpenAI-compatible endpoint
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    envKey: ["QWEN_API_KEY", "DASHSCOPE_API_KEY"],
    envBaseUrl: "QWEN_BASE_URL",
    defaultModel: "qwen3.7-plus",
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    envKey: ["OPENAI_API_KEY"],
    envBaseUrl: "OPENAI_BASE_URL",
    defaultModel: "gpt-4o",
  },
};

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
  return cfg.baseURL;
}

export function isCompatibleProviderConfigured(provider: string): boolean {
  return readEnvApiKey(provider) != null;
}
