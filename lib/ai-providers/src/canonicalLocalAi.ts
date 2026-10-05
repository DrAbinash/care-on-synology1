/**
 * Canonical on-prem Local AI constants — the ONE definition in the repository.
 *
 * `artifacts/api-server/src/lib/aiPipeline/canonicalLocalAi.ts` re-exports these
 * instead of re-declaring them, so the provider layer and the pipeline layer can
 * never drift apart. Values are the clinic's current production defaults; change
 * them only together with the corresponding deployment env.
 *
 * Embeddings (nomic-embed-text) and Paddle OCR remain separate exceptions.
 */

export const CANONICAL_OLLAMA_ENDPOINT = "http://172.16.1.140:11434";
export const CANONICAL_LOCAL_CHAT_VISION_MODEL = "qwen3-vl:8b";
/** Embeddings only — not a chat/vision alternative. */
export const CANONICAL_EMBEDDING_MODEL = "nomic-embed-text";
