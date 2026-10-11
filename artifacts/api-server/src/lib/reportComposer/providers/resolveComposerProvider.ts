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

/**
 * Parse a provider NAME that someone chose — the workspace session selector, a
 * Model Routing row, the Test Lab, an admin-entered settings value.
 *
 * Returns `null` for a name CARE has no composer adapter for. It used to return
 * `"ollama"`, which meant a request for `gemini` or a typo like `open_ai`
 * silently ran on the clinic's local model while every screen, job row and audit
 * record still said the requested provider. For a system whose purpose is
 * knowing which model wrote a sentence, and whose local/cloud split decides
 * whether patient text leaves the hospital, guessing is not a fallback — it is a
 * privacy decision made on the radiologist's behalf. Callers must refuse.
 *
 * `null` is also what `assertComposerProviderPolicy` and `assertGatewayPrivacy`
 * already refuse by name (`composer_provider_not_supported`); this closes the
 * last door that let an unrecognised name reach them as "ollama".
 */
export function parseComposerProviderName(
  raw: string | null | undefined,
): ComposerProviderName | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (
    v === "deepseek" ||
    v === "openai" ||
    v === "ollama" ||
    v === "qwen" ||
    v === "local_openai_compatible"
  ) {
    return v;
  }
  return null;
}

/** The composer's default when NOBODY named a provider: the local model. */
export const DEFAULT_COMPOSER_PROVIDER: ComposerProviderName = "ollama";

export function unsupportedComposerProviderMessage(raw: unknown): string {
  return (
    `Provider "${String(raw ?? "").slice(0, 64) || "(empty)"}" has no Report Composer adapter. `
    + "Supported: ollama, local_openai_compatible, openai, qwen, deepseek. "
    + "Nothing was sent to any model."
  );
}

/**
 * Resolve the adapter. With no name (or a name that is not a provider CARE
 * knows) this returns the local Ollama adapter, which is the clinic default and
 * is NOT a silent substitution: every caller that has a name in hand must pass a
 * name `parseComposerProviderName` accepted.
 */
export function resolveComposerProvider(
  name: ComposerProviderName | string | null | undefined = DEFAULT_COMPOSER_PROVIDER,
): ComposerProviderAdapter {
  const parsed = parseComposerProviderName(typeof name === "string" ? name : null);
  if (parsed === "deepseek") return deepseek;
  if (parsed === "openai") return openai;
  if (parsed === "qwen") return qwen;
  if (parsed === "local_openai_compatible") return localOpenAi;
  return ollama;
}
