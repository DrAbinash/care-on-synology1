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

/**
 * Last-resort endpoint when neither `clinic_settings.ollama_base_url` nor
 * `OLLAMA_PRIMARY_URL` / `OLLAMA_BASE_URL` is set. It is reached on a fresh
 * install and during an env-less rebuild, so a value here is a promise the app
 * can actually keep.
 *
 * It previously named the clinic's AI PC on its secondary LAN address. That host
 * no longer answers — the working server is reachable elsewhere and is configured
 * through `deploy/synology/care.env`, where it belongs. A deployment-specific
 * address must not live in shipped source: when it goes stale it silently points
 * every fallback at a dead machine, which is how a correctly configured clinic
 * ends up with an unreachable "local" AI. Loopback is the conventional Ollama
 * default and is correct for the one case this constant can actually describe —
 * Ollama running on the same host as the API.
 */
export const CANONICAL_OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
export const CANONICAL_LOCAL_CHAT_VISION_MODEL = "qwen3-vl:8b";
/** Embeddings only — not a chat/vision alternative. */
export const CANONICAL_EMBEDDING_MODEL = "nomic-embed-text";
