/**
 * One cached capability reader for the clinic's own Ollama models.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A NEW SUBSYSTEM
 * `AiComparisonWorkspace` needs to say, beside every local model it lists, whether
 * that model can read images, and `/api/ai-comparison/run` needs to say the same
 * thing about the model that actually answered. Those are two consumers of one
 * question, and the answer comes from one place: Ollama's `/api/show`. The reader
 * below is the only thing between those call sites and that probe.
 *
 * It reuses `classifyOllamaModelCapability` from `@workspace/ai-providers` — the same
 * metadata-first classifier the Composer's selected-image gate and the OCR resolver
 * already consult — rather than a second capability rule per surface. That classifier
 * is deliberately conservative: it never calls a model able to read images on its
 * name, and the name table can only ever WITHHOLD confidence. Do not "improve" on it
 * here; if a state is wrong, the classifier is wrong, and both surfaces change.
 *
 * Caching follows `lib/reportComposer/visionCapability.ts`: the same short-TTL
 * in-memory `ttlCache`, the same prefix-invalidation, the same reason — a pulled
 * model is a fact about the clinic's machine that changes when someone runs
 * `ollama pull`, not between page loads.
 */
import {
  classifyOllamaModelCapability,
  lookupBuiltinCapability,
  type OllamaModelCapability,
} from "@workspace/ai-providers";
import { getCached, setCached, invalidateCachedPrefix } from "../ttlCache";

/** Long enough for one screen to list and run without re-probing, short enough
 *  that a model pulled after a mistake shows up on the next look. */
const CAPABILITY_TTL_MS = 60_000;
const CACHE_PREFIX = "aiCapability:ollama:";
/** `/api/show` reads a model's metadata off disk; a cold read can hold a request. */
const PROBE_TIMEOUT_MS = 3000;
/** A machine with forty pulled models must not open forty sockets at once while a
 *  settings screen loads. */
const MAX_CONCURRENT_PROBES = 6;

/** Test-only: drop cached capability readings so a case starts from the probe. */
export function __resetCapabilityCacheForTests(): void {
  invalidateCachedPrefix(CACHE_PREFIX);
}

/**
 * The capability of one local model, as the server reports it, cached per
 * endpoint+model. A failed probe is cached too: "we could not find out" is an
 * answer, and re-probing a wedged Ollama on every page load is how a settings
 * screen turns a stalled model into a stalled clinic.
 */
export async function cachedOllamaModelCapability(
  endpointUrl: string,
  model: string,
): Promise<OllamaModelCapability> {
  const endpoint = (endpointUrl || "").replace(/\/$/, "");
  const name = (model || "").trim();
  if (!endpoint || !name) {
    return {
      state: "unknown",
      evidence: "no_model",
      serverReport: null,
      nameReport: name ? "unknown" : null,
      source: "not_established",
      probedEndpoint: endpoint || null,
      detail: !name
        ? "No model was named, so nothing is known about whether it can read images."
        : "No local endpoint was resolved, so this model's capability was never asked.",
    };
  }

  const key = `${CACHE_PREFIX}${endpoint}:${name}`;
  const cached = getCached<OllamaModelCapability>(key);
  if (cached) return cached;

  const value = await classifyOllamaModelCapability({
    endpointUrl: endpoint,
    model: name,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  setCached(key, value, CAPABILITY_TTL_MS);
  return value;
}

/**
 * Capabilities for a list of models in one call, bounded so a big model library
 * cannot stampede the server. Keyed by the exact tag the caller passed, because
 * that is what it will look up again.
 */
export async function ollamaModelCapabilities(
  endpointUrl: string,
  models: readonly string[],
): Promise<Record<string, OllamaModelCapability>> {
  const out: Record<string, OllamaModelCapability> = {};
  const queue = [...models];
  async function worker(): Promise<void> {
    for (;;) {
      const model = queue.shift();
      if (model === undefined) return;
      out[model] = await cachedOllamaModelCapability(endpointUrl, model);
    }
  }
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_PROBES, queue.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return out;
}

/**
 * What CARE can say about a model it cannot probe — a cloud vendor, or an arm that
 * never named one.
 *
 * There is no capability API to ask a vendor "can this model see", so the only
 * honest sources are CARE's own catalogue row and the truth that nothing was
 * established. `lookupBuiltinCapability` distinguishes "declared not to" from
 * "we have no row", which `modelSupportsVision()` collapses into the same `false`;
 * collapsing them here would print TEXT ONLY for a model nobody has typed anything
 * about at all.
 */
export function declaredCapability(
  provider: string,
  model: string | null,
): OllamaModelCapability {
  if (!model) {
    return {
      state: "unknown",
      evidence: "no_model",
      serverReport: null,
      nameReport: null,
      source: "not_established",
      probedEndpoint: null,
      detail: "The provider reported no model, so nothing can be claimed about image capability.",
    };
  }
  const row = lookupBuiltinCapability(provider, model);
  if (!row) {
    return {
      state: "unknown",
      evidence: "no_record",
      serverReport: null,
      nameReport: null,
      source: "not_established",
      probedEndpoint: null,
      detail: `CARE has no capability record for '${model}' on ${provider}, and no endpoint reports one.`,
    };
  }
  return {
    state: row.supportsVision ? "vision-confirmed" : "text-only",
    evidence: "provider_catalogue",
    serverReport: null,
    nameReport: null,
    source: "provider_catalogue",
    probedEndpoint: null,
    detail: row.supportsVision
      ? `CARE's provider catalogue declares '${row.model}' reads images. It is a typed-in declaration, not a probe.`
      : `CARE's provider catalogue declares '${row.model}' does not read images.`,
  };
}
