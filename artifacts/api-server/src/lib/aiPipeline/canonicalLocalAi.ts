/**
 * Canonical on-prem Local AI (chat/vision) constants.
 *
 * ONE endpoint + ONE chat/vision model until the architecture is stable.
 * Embeddings (nomic-embed-text) and Paddle OCR remain separate exceptions.
 */

export const CANONICAL_OLLAMA_ENDPOINT = "http://172.16.1.140:11434";
export const CANONICAL_LOCAL_CHAT_VISION_MODEL = "qwen3-vl:8b";
/** Embeddings only — not a chat/vision alternative. */
export const CANONICAL_EMBEDDING_MODEL = "nomic-embed-text";

export function normalizeOllamaBaseUrl(url: string | null | undefined): string {
  const trimmed = (url ?? "").trim().replace(/\/$/, "");
  return trimmed || CANONICAL_OLLAMA_ENDPOINT;
}

export function normalizeLocalChatVisionModel(model: string | null | undefined): string {
  const trimmed = (model ?? "").trim();
  return trimmed || CANONICAL_LOCAL_CHAT_VISION_MODEL;
}
