/**
 * Resolve the Report Composer provider adapter.
 * Default remains Ollama. Cloud providers resolve to fail-closed stubs.
 */
import type { ComposerProviderAdapter, ComposerProviderName } from "./types";
import { OllamaComposerAdapter } from "./ollamaComposerAdapter";
import { DeepSeekComposerAdapter } from "./deepseekComposerAdapter";
import { OpenAiComposerAdapter } from "./openaiComposerAdapter";

const ollama = new OllamaComposerAdapter();
const deepseek = new DeepSeekComposerAdapter();
const openai = new OpenAiComposerAdapter();

export function parseComposerProviderName(raw: string | null | undefined): ComposerProviderName {
  const v = (raw ?? "ollama").trim().toLowerCase();
  if (v === "deepseek" || v === "openai" || v === "ollama") return v;
  return "ollama";
}

export function resolveComposerProvider(
  name: ComposerProviderName | string | null | undefined = "ollama",
): ComposerProviderAdapter {
  const parsed = parseComposerProviderName(typeof name === "string" ? name : "ollama");
  if (parsed === "deepseek") return deepseek;
  if (parsed === "openai") return openai;
  return ollama;
}
