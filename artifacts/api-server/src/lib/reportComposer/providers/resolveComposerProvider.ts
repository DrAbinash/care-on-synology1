/**
 * Resolve the Report Composer provider adapter.
 * Default remains Ollama when no task route / override is set.
 * Local OpenAI-Compatible is a first-class LOCAL provider (not cloud).
 */
import type { ComposerProviderAdapter, ComposerProviderName } from "./types";
import { OllamaComposerAdapter } from "./ollamaComposerAdapter";
import { DeepSeekComposerAdapter } from "./deepseekComposerAdapter";
import { OpenAiComposerAdapter } from "./openaiComposerAdapter";
import { QwenComposerAdapter } from "./qwenComposerAdapter";
import { LocalOpenAiCompatibleComposerAdapter } from "./localOpenAiCompatibleComposerAdapter";

const ollama = new OllamaComposerAdapter();
const deepseek = new DeepSeekComposerAdapter();
const openai = new OpenAiComposerAdapter();
const qwen = new QwenComposerAdapter();
const localOpenAi = new LocalOpenAiCompatibleComposerAdapter();

export function parseComposerProviderName(raw: string | null | undefined): ComposerProviderName {
  const v = (raw ?? "ollama").trim().toLowerCase();
  if (
    v === "deepseek" ||
    v === "openai" ||
    v === "ollama" ||
    v === "qwen" ||
    v === "local_openai_compatible"
  ) {
    return v;
  }
  return "ollama";
}

export function resolveComposerProvider(
  name: ComposerProviderName | string | null | undefined = "ollama",
): ComposerProviderAdapter {
  const parsed = parseComposerProviderName(typeof name === "string" ? name : "ollama");
  if (parsed === "deepseek") return deepseek;
  if (parsed === "openai") return openai;
  if (parsed === "qwen") return qwen;
  if (parsed === "local_openai_compatible") return localOpenAi;
  return ollama;
}
