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
}

export interface AiQueryResult {
  text: string;
  success: boolean;
  error?: string;
}

export interface AiProvider {
  readonly config: AiProviderConfig;
  query(opts: AiQueryOptions): Promise<AiQueryResult>;
  testConnection(): Promise<{ ok: boolean; message: string; availableModels?: string[] }>;
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
    defaultModels: ["gpt-oss:20b", "gemma3:12b"],
    placeholder: "http://100.79.100.41:11434",
  },
};

export const BUILTIN_PROVIDER_NAMES = Object.keys(BUILTIN_PROVIDER_CONFIGS);

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

  async testConnection(): Promise<{ ok: boolean; message: string; availableModels?: string[] }> {
    try {
      const client = await getOpenAIClient(this.apiKey);
      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini",
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

  async testConnection(): Promise<{ ok: boolean; message: string; availableModels?: string[] }> {
    try {
      const model = await getGeminiModel(this.apiKey, "gemini-1.5-flash");
      const result = await model.generateContent("Reply with exactly the word: CONNECTED");
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

  async testConnection(): Promise<{ ok: boolean; message: string; availableModels?: string[] }> {
    try {
      const client = await getAnthropicClient(this.apiKey);
      const resp = await client.messages.create({
        model: "claude-3-5-haiku-20241022",
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

class OllamaProvider implements AiProvider {
  config = BUILTIN_PROVIDER_CONFIGS.ollama;
  constructor(private endpointUrl: string) {}

  async query(opts: AiQueryOptions): Promise<AiQueryResult> {
    try {
      const client = await getOllamaClient(this.endpointUrl);
      type ContentItem =
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } };
      const content: ContentItem[] = [{ type: "text", text: opts.prompt }];
      for (const img of opts.images) {
        content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}` } });
      }
      const resp = await client.chat.completions.create({
        model: opts.model || "gpt-oss:20b",
        messages: [{ role: "user", content }],
        max_tokens: opts.maxTokens ?? 4096,
      });
      return { text: resp.choices[0]?.message?.content ?? "", success: true };
    } catch (err: unknown) {
      return { text: "", success: false, error: err instanceof Error ? err.message : "Ollama error" };
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string; availableModels?: string[] }> {
    try {
      // List models
      const url = `${this.endpointUrl.replace(/\/$/, "")}/api/tags`;
      const tagsResp = await fetch(url, { method: "GET" });
      if (!tagsResp.ok) {
        return { ok: false, message: `Ollama server returned ${tagsResp.status}` };
      }
      const tagsData = await tagsResp.json() as { models?: Array<{ name: string; size?: number }> };
      const models = tagsData.models?.map((m) => m.name) ?? [];
      // Test chat completion
      const chatResult = await this.query({
        model: "gpt-oss:20b",
        prompt: "Reply with exactly the word: CONNECTED",
        images: [],
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
    if (!url) return null;
    endpointUrl = url;
  }

  return createAiProvider(name, apiKey, endpointUrl);
}

/**
 * Unified generate function that picks the provider from the database and
 * runs the query. Returns the result directly.
 */
export async function generateAiResponse(
  providerName: string,
  prompt: string,
  images?: string[],
  options?: { model?: string; maxTokens?: number }
): Promise<AiQueryResult> {
  const provider = await createAiProviderFromDb(providerName);
  if (!provider) {
    return { text: "", success: false, error: `Provider ${providerName} is not configured.` };
  }
  return provider.query({
    model: options?.model ?? "",
    prompt,
    images: images ?? [],
    maxTokens: options?.maxTokens,
  });
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
  { key: "report_findings", label: "Radiology Findings", description: "Generate the findings section of a radiology report.", vision: false },
  { key: "report_impression", label: "Radiology Impression", description: "Generate the impression section of a radiology report.", vision: false },
  { key: "echo_draft", label: "Echo Cardiology AI Draft", description: "AI-assisted 2D echocardiography report drafting from measurements and valve assessment.", vision: false },
  { key: "fetal_echo_draft", label: "Fetal Echo AI Draft", description: "AI-assisted fetal echocardiography report drafting from fetal echo parameters.", vision: false },
  { key: "fetal_usg_draft", label: "Fetal USG Level-4 AI Draft", description: "AI-assisted fetal ultrasound report drafting from biometry and anomaly scan data.", vision: false },
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
  options?: { provider?: string; model?: string; maxTokens?: number },
): Promise<AiQueryResult> {
  const route = options?.provider ? null : await resolveTaskRoute(taskKey);
  const providerName = options?.provider ?? route?.provider ?? (await getDefaultProviderName());
  const model = options?.model ?? route?.model;
  return generateAiResponse(providerName, prompt, images, {
    model,
    maxTokens: options?.maxTokens,
  });
}
