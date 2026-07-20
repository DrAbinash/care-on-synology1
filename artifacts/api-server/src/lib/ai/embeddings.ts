/**
 * embeddings.ts — text embeddings for the RAG vector store (Phase 9/10).
 *
 * Replaces the previous plaintext-placeholder behaviour (rag_document_embeddings
 * stored no real vector; rag-search fell back to ILIKE with score=null) with
 * real semantic embeddings + cosine similarity.
 *
 * Source: the clinic's own local Ollama (admin-configured provider endpoint),
 * via /api/embeddings with a sentence-embedding model (default
 * "nomic-embed-text"). This keeps report/finding text — which is PHI — on the
 * clinic network, matching the local-STT and local-model discipline elsewhere.
 * When Ollama isn't configured, embedText() returns null and callers fall back
 * to keyword (ILIKE) search, so the feature degrades gracefully rather than
 * breaking.
 *
 * Vectors are persisted as a JSON float array in the existing `embedding` text
 * column (no pgvector dependency); similarity is computed in-process. Fine for
 * a clinic-scale corpus (hundreds–low-thousands of chunks).
 */

import { getProviderEndpointUrl } from "@workspace/ai-providers";
import { logger } from "../logger";

const EMBED_MODEL = process.env.RAG_EMBED_MODEL || "nomic-embed-text";
const EMBED_TIMEOUT_MS = 30_000;
const MAX_CHARS = 8_000; // keep a single embedding request bounded

/** Resolve the admin-configured local Ollama base URL, or null. */
async function ollamaBase(): Promise<string | null> {
  try {
    const url = await getProviderEndpointUrl("ollama");
    if (!url || !/^https?:\/\//i.test(url)) return null;
    return url.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** True when an embedding engine is configured (so search can go semantic). */
export async function isEmbeddingAvailable(): Promise<boolean> {
  return (await ollamaBase()) !== null;
}

/**
 * Embed a single text into a float vector, or null if no engine is configured
 * or the request fails. Never throws — callers treat null as "fall back".
 */
export async function embedText(text: string): Promise<number[] | null> {
  const clean = (text ?? "").trim();
  if (!clean) return null;
  const base = await ollamaBase();
  if (!base) return null;
  try {
    const resp = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: clean.slice(0, MAX_CHARS) }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "embeddings: ollama /api/embeddings non-2xx");
      return null;
    }
    const data = (await resp.json().catch(() => null)) as { embedding?: unknown } | null;
    const vec = data?.embedding;
    if (Array.isArray(vec) && vec.length > 0 && vec.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return vec as number[];
    }
    return null;
  } catch (err) {
    logger.warn({ err }, "embeddings: ollama embed request failed");
    return null;
  }
}

/** Parse a stored JSON-array embedding back to a number[] (null if invalid). */
export function parseEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "number") ? (v as number[]) : null;
  } catch {
    return null;
  }
}

/** Serialise a vector for the `embedding` text column. */
export function serializeEmbedding(vec: number[]): string {
  return JSON.stringify(vec);
}

/** Cosine similarity in [-1, 1]; 0 for mismatched/empty/zero vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
