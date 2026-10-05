/**
 * Canonical on-prem Local AI (chat/vision) constants.
 *
 * ONE endpoint + ONE chat/vision model until the architecture is stable.
 * Embeddings (nomic-embed-text) and Paddle OCR remain separate exceptions.
 *
 * The values themselves are defined once, in @workspace/ai-providers, so the
 * provider layer and this pipeline layer cannot drift. This module keeps the
 * normalisation helpers and re-exports the constants for existing importers.
 */

import {
  CANONICAL_OLLAMA_ENDPOINT,
  CANONICAL_LOCAL_CHAT_VISION_MODEL,
} from "@workspace/ai-providers/canonical";

export {
  CANONICAL_OLLAMA_ENDPOINT,
  CANONICAL_LOCAL_CHAT_VISION_MODEL,
  CANONICAL_EMBEDDING_MODEL,
} from "@workspace/ai-providers/canonical";

/**
 * Stale clinic_settings / UI values from before the single-model lock.
 * Map them to the canonical chat/vision model so Verify / overnight / OCR
 * do not keep asking for `ollama pull qwen3:8b` when `qwen3-vl:8b` is installed.
 */
const LEGACY_LOCAL_CHAT_VISION_ALIASES: Record<string, string> = {
  "qwen3:8b": CANONICAL_LOCAL_CHAT_VISION_MODEL,
  "qwen3:8b-instruct": CANONICAL_LOCAL_CHAT_VISION_MODEL,
  "qwen2.5-vl:7b": CANONICAL_LOCAL_CHAT_VISION_MODEL,
  "qwen2-vl:7b": CANONICAL_LOCAL_CHAT_VISION_MODEL,
};

export function normalizeOllamaBaseUrl(url: string | null | undefined): string {
  const trimmed = (url ?? "").trim().replace(/\/$/, "");
  return trimmed || CANONICAL_OLLAMA_ENDPOINT;
}

export function normalizeLocalChatVisionModel(model: string | null | undefined): string {
  const trimmed = (model ?? "").trim();
  if (!trimmed) return CANONICAL_LOCAL_CHAT_VISION_MODEL;
  const mapped = LEGACY_LOCAL_CHAT_VISION_ALIASES[trimmed];
  return mapped || trimmed;
}
